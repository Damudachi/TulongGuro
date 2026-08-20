import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createRequire } from 'node:module';

/**
 * DELETE /api/teacher/submissions/:id/pages/:pageIndex — pulling one page out
 * of stitched multi-page work.
 *
 * The geometry is the whole risk here. Pages are flattened into one tall image
 * on upload and the only record of where each one ended is a list of fractions
 * on the row; if the crop is derived from them wrongly the teacher does not get
 * an error, they get a submission holding the bottom half of one page and the
 * top half of the next — a child's answer silently cut in half. So these tests
 * drive the real route over real HTTP with real images and then measure the
 * pixels that come back, rather than asserting on a status code.
 *
 * Bootstrapped exactly like route-wiring.test.js: a fake Prisma installed
 * through db.js's swap hook before server.js is required, no database.
 * SUPABASE_URL is blanked first so uploadToCloud stores into the local uploads
 * directory instead of reaching for the network.
 */

const require = createRequire(import.meta.url);
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

function makePrismaFake() {
  const models = new Map();
  const defaults = {
    findUnique: null, findFirst: null, findMany: [], count: 0,
    create: {}, createMany: { count: 0 }, update: {}, updateMany: { count: 0 },
    delete: {}, deleteMany: { count: 0 },
    aggregate: {}, groupBy: [], upsert: {},
  };
  const makeModel = () => {
    const model = {};
    for (const [method, value] of Object.entries(defaults)) {
      model[method] = vi.fn().mockResolvedValue(value);
    }
    return model;
  };
  const fake = new Proxy({}, {
    get(_t, prop) {
      if (typeof prop !== 'string') return undefined;
      if (prop === 'then') return undefined;
      if (prop === '$transaction') return (arg) => (typeof arg === 'function' ? arg(fake) : Promise.all(arg));
      if (prop.startsWith('$')) return () => Promise.resolve(undefined);
      if (!models.has(prop)) models.set(prop, makeModel());
      return models.get(prop);
    },
  });
  const reset = () => {
    for (const model of models.values()) {
      for (const [method, value] of Object.entries(defaults)) {
        model[method].mockReset().mockResolvedValue(value);
      }
    }
  };
  return { fake, reset };
}

const { fake: prismaFake, reset: resetPrisma } = makePrismaFake();

process.env.AUTH_SECRET = 'page-removal-test-secret';
process.env.NODE_ENV = 'test';
// Set before server.js (and its dotenv call, which never overwrites an existing
// key) reads them: with these blank, uploadToCloud writes to ./uploads and
// nothing in this file touches Supabase.
process.env.SUPABASE_URL = '';
process.env.SUPABASE_KEY = '';

const T1 = 'teacher-t1';
const T2 = 'teacher-t2';
const ACTIVITY = 'activity-1';
const SUBMISSION = 'submission-1';

const WIDTH = 60;
/** Three pages of different heights, so a crop that assumes equal bands fails. */
const PAGE_HEIGHTS = [40, 70, 30];
/** One flat colour per page, which is how a returned band is identified. */
const PAGE_COLORS = [
  { r: 255, g: 0, b: 0 },
  { r: 0, g: 255, b: 0 },
  { r: 0, g: 0, b: 255 },
];

let baseUrl;
let server;
let signToken;
let restoreClient;
let uploadsDir;
/** Everything this file wrote into ./uploads, cleaned up at the end. */
const written = [];

/** A stitched composite of the three pages, and the pageBreaks describing it. */
async function makeStitchedImage() {
  const total = PAGE_HEIGHTS.reduce((a, b) => a + b, 0);
  const pages = [];
  const breaks = [];
  let top = 0;
  for (let i = 0; i < PAGE_HEIGHTS.length; i++) {
    const buffer = await sharp({
      create: { width: WIDTH, height: PAGE_HEIGHTS[i], channels: 3, background: PAGE_COLORS[i] },
    }).png().toBuffer();
    pages.push({ input: buffer, top, left: 0 });
    top += PAGE_HEIGHTS[i];
    breaks.push(top / total);
  }
  breaks[breaks.length - 1] = 1;

  const filename = `test-stitched-${Date.now()}-${Math.floor(Math.random() * 10000)}.jpg`;
  const filePath = path.join(uploadsDir, filename);
  await sharp({ create: { width: WIDTH, height: total, channels: 3, background: { r: 255, g: 255, b: 255 } } })
    .composite(pages)
    .jpeg({ quality: 100 })
    .toFile(filePath);
  written.push(filePath);
  return { imageUrl: `/uploads/${filename}`, pageBreaks: JSON.stringify(breaks), totalHeight: total };
}

/** Which colour dominates one row of pixels, as 'r' | 'g' | 'b'. */
async function rowColorAt(filePath, y) {
  const { data, info } = await sharp(filePath).raw().toBuffer({ resolveWithObject: true });
  const offset = (y * info.width + Math.floor(info.width / 2)) * info.channels;
  const [r, g, b] = [data[offset], data[offset + 1], data[offset + 2]];
  if (r > g && r > b) return 'r';
  if (g > r && g > b) return 'g';
  return 'b';
}

beforeAll(async () => {
  restoreClient = require('../db.js').__setClientForTests(prismaFake);
  const { app } = require('../server.js');
  ({ signToken } = require('../auth.js'));
  uploadsDir = path.join(__dirname, '..', 'uploads');
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
}, 60000);

afterAll(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (restoreClient) restoreClient();
  for (const f of written) { try { fs.unlinkSync(f); } catch { /* already gone */ } }
});

beforeEach(() => {
  resetPrisma();
  prismaFake.user.findUnique.mockResolvedValue({ sessionsValidFrom: null });
  prismaFake.activity.findUnique.mockResolvedValue({
    id: ACTIVITY,
    class: { teacherId: T1 },
    classLesson: null,
  });
});

const tokenFor = (id) => signToken({ id, role: 'TEACHER', schoolId: null });

const removePage = (index, token) =>
  fetch(`${baseUrl}/api/teacher/submissions/${SUBMISSION}/pages/${index}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });

const submissionRow = (overrides = {}) => ({
  id: SUBMISSION,
  activityId: ACTIVITY,
  releasedAt: null,
  ...overrides,
});

const captureUpdate = () => {
  prismaFake.submission.update.mockImplementation(({ data }) => Promise.resolve({ id: SUBMISSION, ...data }));
};

const updatedData = () => prismaFake.submission.update.mock.calls[0][0].data;

describe('removing one page from stitched work', () => {
  it('keeps the other pages, in order, at their own heights', async () => {
    const { imageUrl, pageBreaks, totalHeight } = await makeStitchedImage();
    prismaFake.submission.findUnique.mockResolvedValue(submissionRow({ imageUrl, pageBreaks }));
    captureUpdate();

    // The middle page — the case a "crop off the end" implementation gets
    // wrong without ever failing loudly.
    const res = await removePage(1, tokenFor(T1));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.pagesRemaining).toBe(2);

    const newPath = path.join(uploadsDir, path.basename(updatedData().imageUrl));
    written.push(newPath);

    const meta = await sharp(newPath).metadata();
    expect(meta.width).toBe(WIDTH);
    // Exactly the two surviving pages: nothing of the removed one left behind,
    // and no white filler where it used to be.
    expect(meta.height).toBe(totalHeight - PAGE_HEIGHTS[1]);

    // Page 1 on top, page 3 below it — the green band is gone entirely.
    expect(await rowColorAt(newPath, 5)).toBe('r');
    expect(await rowColorAt(newPath, PAGE_HEIGHTS[0] - 3)).toBe('r');
    expect(await rowColorAt(newPath, PAGE_HEIGHTS[0] + 5)).toBe('b');
    expect(await rowColorAt(newPath, meta.height - 3)).toBe('b');
  });

  it('rewrites pageBreaks to describe what is left', async () => {
    const { imageUrl, pageBreaks } = await makeStitchedImage();
    prismaFake.submission.findUnique.mockResolvedValue(submissionRow({ imageUrl, pageBreaks }));
    captureUpdate();

    await removePage(0, tokenFor(T1));

    const newPath = path.join(uploadsDir, path.basename(updatedData().imageUrl));
    written.push(newPath);

    const breaks = JSON.parse(updatedData().pageBreaks);
    expect(breaks).toHaveLength(2);
    expect(breaks[breaks.length - 1]).toBe(1);
    // Page 2 (70px) above page 3 (30px) in a 100px image.
    expect(breaks[0]).toBeCloseTo(0.7, 2);
  });

  it('clears the grade, which was given for a document that no longer exists', async () => {
    const { imageUrl, pageBreaks } = await makeStitchedImage();
    prismaFake.submission.findUnique.mockResolvedValue(submissionRow({ imageUrl, pageBreaks }));
    captureUpdate();

    await removePage(2, tokenFor(T1));

    const data = updatedData();
    written.push(path.join(uploadsDir, path.basename(data.imageUrl)));
    expect(data.aiScore).toBeNull();
    expect(data.hitlScore).toBeNull();
    expect(data.aiFeedback).toBeNull();
    expect(data.hitlFeedback).toBeNull();
    expect(data.status).toBe('PENDING');
  });

  it('refuses a submission whose page boundaries were never recorded', async () => {
    const { imageUrl } = await makeStitchedImage();
    prismaFake.submission.findUnique.mockResolvedValue(submissionRow({ imageUrl, pageBreaks: null }));

    const res = await removePage(0, tokenFor(T1));

    expect(res.status).toBe(400);
    expect(prismaFake.submission.update).not.toHaveBeenCalled();
  });

  it('refuses a page index that is not in the document', async () => {
    const { imageUrl, pageBreaks } = await makeStitchedImage();
    prismaFake.submission.findUnique.mockResolvedValue(submissionRow({ imageUrl, pageBreaks }));

    for (const index of [3, -1, 'x']) {
      const res = await removePage(index, tokenFor(T1));
      expect(res.status).toBe(400);
    }
    expect(prismaFake.submission.update).not.toHaveBeenCalled();
  });

  it('refuses once the result has been released to the student', async () => {
    const { imageUrl, pageBreaks } = await makeStitchedImage();
    prismaFake.submission.findUnique.mockResolvedValue(
      submissionRow({ imageUrl, pageBreaks, releasedAt: new Date() }));

    const res = await removePage(1, tokenFor(T1));

    expect(res.status).toBe(400);
    expect(prismaFake.submission.update).not.toHaveBeenCalled();
  });

  it('refuses a teacher who does not own the class', async () => {
    const { imageUrl, pageBreaks } = await makeStitchedImage();
    prismaFake.submission.findUnique.mockResolvedValue(submissionRow({ imageUrl, pageBreaks }));

    const res = await removePage(1, tokenFor(T2));

    expect(res.status).toBe(403);
    expect(prismaFake.submission.update).not.toHaveBeenCalled();
  });
});
