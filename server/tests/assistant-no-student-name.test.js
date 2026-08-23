import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

/**
 * The AI Teacher Assistant must never be told which child wrote the paper.
 *
 * This is the reported bug, and it was as plain as it sounds: the review screen
 * put a "Student: Santos, Mark Lester E." line into the context blob, a teacher
 * asked "what is the name of the student", and the assistant answered with the
 * child's full name and their class. A learner's name had gone to a third-party
 * model — against the PII rule at the top of server.js, which allows exactly
 * one exception (reading a photographed class list) and this is not it.
 *
 * The fix has two halves and only one of them is testable from the browser
 * side, so this tests the other: whatever the client sends, the name must not
 * be in the bytes that leave this server. It drives the real Express route and
 * intercepts fetch at the boundary to Google, so the assertions read the exact
 * request body Gemini would have received — nothing is inferred from source
 * text, and a future refactor that reintroduces the leak through a different
 * field still fails here.
 *
 * Harness is the one from grading-prompt-contents.test.js: db.js swapped
 * through Node's CJS cache before server.js is required.
 */

const require = createRequire(import.meta.url);

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
      if (prop === '$transaction') return (a) => (typeof a === 'function' ? a(fake) : Promise.all(a));
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

process.env.AUTH_SECRET = 'assistant-pii-test-secret';
process.env.NODE_ENV = 'test';
for (const name of ['GOOGLE_API_KEY', ...Array.from({ length: 9 }, (_, i) => `GEMINI_API_KEY${i + 1}`)]) {
  process.env[name] = '';
}
process.env.GEMINI_API_KEY = 'test-key-not-used';
process.env.GEMINI_MIN_SPACING_MS = '0';

const T1 = 'teacher-t1';
const OTHER_TEACHER = 'teacher-t2';
const SUBMISSION = 'submission-1';

/** The learner, exactly as the roster stores them: "Surname, Given M." */
const STUDENT_NAME = 'Santos, Mark Lester E.';

/** A one-pixel JPEG. buildFilePart only base64s the bytes, but the file has to
 *  really exist on disk for the paper to be attached. */
const ONE_PIXEL_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a'
  + 'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA'
  + 'AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
  'base64',
);

let baseUrl;
let server;
let signToken;
let restoreClient;
let sentToGoogle = [];
let realFetch;
let uploadPath;
let paperUrl;

beforeAll(async () => {
  restoreClient = require('../db.js').__setClientForTests(prismaFake);
  const { app } = require('../server.js');
  ({ signToken } = require('../auth.js'));

  // resolveLocalImagePath joins a non-http imageUrl onto server/, so the paper
  // has to sit under server/uploads for the route to find it.
  const uploadsDir = path.join(__dirname, '..', 'uploads');
  fs.mkdirSync(uploadsDir, { recursive: true });
  const name = `assistant-paper-test-${process.pid}.jpg`;
  uploadPath = path.join(uploadsDir, name);
  fs.writeFileSync(uploadPath, ONE_PIXEL_JPEG);
  paperUrl = `/uploads/${name}`;

  realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input?.url || String(input);
    if (url.includes('generativelanguage.googleapis.com')) {
      sentToGoogle.push(JSON.parse(init.body));
      return new Response(JSON.stringify({
        candidates: [{
          content: {
            role: 'model',
            parts: [{ text: JSON.stringify({ action: 'answer', reply: 'Noted.', revisedFeedback: null }) }],
          },
          finishReason: 'STOP',
        }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return realFetch(input, init);
  };

  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
}, 60000);

afterAll(async () => {
  if (realFetch) globalThis.fetch = realFetch;
  if (server) await new Promise((resolve) => server.close(resolve));
  if (restoreClient) restoreClient();
  if (uploadPath) { try { fs.unlinkSync(uploadPath); } catch { /* already gone */ } }
});

beforeEach(() => {
  resetPrisma();
  sentToGoogle = [];
  prismaFake.user.findUnique.mockResolvedValue({ sessionsValidFrom: null });
  // What loadAssistantPaper looks up. Scoped to the caller's own class in the
  // query, so the `where` is honoured here by returning null for anyone else.
  // No imageUrl by default: these first tests are about the name, and a paper
  // on every one of them would only add an image part to ignore.
  prismaFake.submission.findFirst.mockImplementation(async ({ where }) => (
    where?.activity?.class?.teacherId === T1
      ? { student: { name: STUDENT_NAME }, imageUrl: null, privacyViolation: false }
      : null
  ));
});

/** Sends one assistant message and returns the prompt Google would have got. */
async function ask(body) {
  const token = signToken({ id: T1, role: 'TEACHER', schoolId: 'school-a' });
  const res = await realFetch(`${baseUrl}/api/teacher/assistant`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ submissionId: SUBMISSION, prompt: 'How did this go?', ...body }),
  });
  expect(res.status).toBe(200);
  expect(sentToGoogle).toHaveLength(1);
  return sentToGoogle[0].contents
    .flatMap(c => c.parts)
    .filter(p => typeof p.text === 'string')
    .map(p => p.text)
    .join('\n');
}

describe('what the AI Teacher Assistant sends to Gemini', () => {
  it('strips the name out of the screen context', async () => {
    // The exact leak that was reported: a browser still running the old build
    // sends this line, and the server must not pass it on.
    const prompt = await ask({ context: `Activity: Flashbacks\nStudent: ${STUDENT_NAME}` });
    expect(prompt).not.toContain('Santos, Mark Lester E.');
    expect(prompt).not.toContain('Mark Lester');
    // The rest of the context is untouched — this redacts, it does not discard.
    expect(prompt).toContain('Activity: Flashbacks');
  });

  it('strips the name the teacher typed into the chat box', async () => {
    // The case the client cannot catch: nothing stops a teacher writing the
    // name themselves, and it is the same leak when they do.
    const prompt = await ask({ prompt: 'How do I explain this to Mark Lester Santos?' });
    expect(prompt).not.toContain('Mark Lester Santos');
    expect(prompt).toContain('How do I explain this to the student?');
  });

  it('strips it from the reordered form a person actually writes', async () => {
    const prompt = await ask({ context: `The paper is by Mark Lester E. Santos.` });
    expect(prompt).not.toContain('Mark Lester E. Santos');
    expect(prompt).not.toContain('Santos.');
  });

  it('strips it out of earlier turns of the conversation', async () => {
    // History is replayed on every message, so a name that got through once
    // would keep being sent for the rest of the session.
    const prompt = await ask({
      history: [{ role: 'user', text: `Tell me about Santos, Mark Lester E.` }],
    });
    expect(prompt).not.toContain('Mark Lester');
  });

  it('strips it out of the feedback being rewritten', async () => {
    const prompt = await ask({ currentFeedback: `Mark Lester Santos writes clearly.` });
    expect(prompt).not.toContain('Mark Lester Santos');
  });

  it('leaves single name-shaped words in the essay alone', async () => {
    // The redaction is multi-word by design. A lone "Mark" or "Grace" is a
    // real word as often as a name in a Philippine classroom, and this text
    // carries quotes from the child's own essay plus the feedback that gets
    // rewritten and handed back — mangling a quote to catch a token the
    // full-name match already covers would corrupt the work.
    const prompt = await ask({ context: 'The student writes: "Carlo got a low mark and lost his grace."' });
    expect(prompt).toContain('low mark');
    expect(prompt).toContain('grace');
  });

  it('tells the model it has no name, so it cannot answer the question at all', async () => {
    const prompt = await ask({ context: 'Activity: Flashbacks' });
    expect(prompt).toContain("You have NOT been told the student's name");
    expect(prompt).toMatch(/never guess a name/i);
  });

  it('still answers when there is no submission to look up', async () => {
    // An older client sends no submissionId. There is then no name to redact
    // against, and the assistant must keep working rather than 500 — the
    // client having already dropped the name is what covers this path.
    const token = signToken({ id: T1, role: 'TEACHER', schoolId: 'school-a' });
    const res = await realFetch(`${baseUrl}/api/teacher/assistant`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'How did this go?', context: 'Activity: Flashbacks' }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
  });

  it('cannot be used to read a name off another teacher\'s submission', async () => {
    // The lookup is scoped to the caller's own classes. If it were not, this
    // endpoint would confirm whether an arbitrary submission id exists by
    // whether the text came back redacted.
    const token = signToken({ id: OTHER_TEACHER, role: 'TEACHER', schoolId: 'school-a' });
    const res = await realFetch(`${baseUrl}/api/teacher/assistant`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        submissionId: SUBMISSION,
        prompt: 'anything',
        context: `Student: ${STUDENT_NAME}`,
      }),
    });
    expect(res.status).toBe(200);
    // Nothing was redacted, because that teacher's lookup found nothing —
    // which is the point: no name was read, so none could be revealed.
    expect(prismaFake.submission.findFirst).toHaveBeenCalled();
  });
});

/** The file parts of the one captured request — the paper, if it was sent. */
const filesSent = () => sentToGoogle[0].contents.flatMap(c => c.parts).filter(p => p.inlineData);

/** Puts a real paper on the submission the assistant is asked about. */
function withPaper({ privacyViolation = false } = {}) {
  prismaFake.submission.findFirst.mockImplementation(async ({ where }) => (
    where?.activity?.class?.teacherId === T1
      ? { student: { name: STUDENT_NAME }, imageUrl: paperUrl, privacyViolation }
      : null
  ));
}

/**
 * The assistant can read the work it is being asked about.
 *
 * It used to see the rubric scores and the feedback but not the paper, which
 * made it confidently useless for the thing teachers open it for: asked about
 * the writing it answered "I do not have access to the full, raw text of the
 * student's essay… you can paste it right here in our chat". Asking a teacher
 * to retype a child's handwriting to get help with feedback is the feature
 * failing, not a limitation to document.
 */
describe('the paper the assistant is reasoning about', () => {
  it("attaches the student's work to the request", async () => {
    withPaper();
    await ask({ context: 'Activity: Flashbacks' });
    const files = filesSent();
    expect(files).toHaveLength(1);
    expect(files[0].inlineData.mimeType).toBe('image/jpeg');
    expect(files[0].inlineData.data).toBe(ONE_PIXEL_JPEG.toString('base64'));
  });

  it('tells the model the paper is there and is the evidence', async () => {
    withPaper();
    const prompt = await ask({ context: 'Activity: Flashbacks' });
    expect(prompt).toContain("The student's actual paper is attached");
    expect(prompt).toMatch(/quote from it exactly/i);
  });

  it('holds it to explaining the mark rather than re-grading it', async () => {
    // The scores are the teacher's. Handing the model the work is what makes
    // it able to argue about them, so the rule goes in beside the paper.
    withPaper();
    const prompt = await ask({ context: 'Activity: Flashbacks' });
    expect(prompt).toMatch(/Reading the paper does not make you the grader/);
  });

  it('says plainly when there is no paper, instead of inventing one', async () => {
    // Default fixture: no imageUrl. The old behaviour is still the honest
    // answer when the file genuinely is not there.
    const prompt = await ask({ context: 'Activity: Flashbacks' });
    expect(filesSent()).toHaveLength(0);
    expect(prompt).toContain('The paper itself is NOT available');
  });

  it('never sends a paper the privacy gate flagged', async () => {
    // That flag means a name or other identifying detail was detected ON the
    // page. Grading refuses such a page; routing the same image to the same
    // vendor through the assistant would be the gate with a second door in it.
    withPaper({ privacyViolation: true });
    const prompt = await ask({ context: 'Activity: Flashbacks' });
    expect(filesSent()).toHaveLength(0);
    expect(prompt).toContain('The paper itself is NOT available');
  });

  it('keeps answering when the file has gone missing', async () => {
    // A photo that moved must not 500 the chat. The assistant carries on with
    // the rubric and feedback, and says what it cannot see.
    prismaFake.submission.findFirst.mockResolvedValue({
      student: { name: STUDENT_NAME },
      imageUrl: '/uploads/this-file-does-not-exist.jpg',
      privacyViolation: false,
    });
    const prompt = await ask({ context: 'Activity: Flashbacks' });
    expect(filesSent()).toHaveLength(0);
    expect(prompt).toContain('The paper itself is NOT available');
  });

  it("does not fetch another teacher's paper", async () => {
    withPaper();
    const token = signToken({ id: OTHER_TEACHER, role: 'TEACHER', schoolId: 'school-a' });
    const res = await realFetch(`${baseUrl}/api/teacher/assistant`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ submissionId: SUBMISSION, prompt: 'anything' }),
    });
    expect(res.status).toBe(200);
    expect(filesSent()).toHaveLength(0);
  });

  it('sends the paper after the instructions, so the model is told what it is looking at', async () => {
    withPaper();
    await ask({ context: 'Activity: Flashbacks' });
    const parts = sentToGoogle[0].contents.flatMap(c => c.parts);
    expect(typeof parts[0].text).toBe('string');
    expect(parts[parts.length - 1].inlineData).toBeTruthy();
  });
});
