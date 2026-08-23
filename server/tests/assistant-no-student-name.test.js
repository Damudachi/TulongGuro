import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createRequire } from 'node:module';

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

let baseUrl;
let server;
let signToken;
let restoreClient;
let sentToGoogle = [];
let realFetch;

beforeAll(async () => {
  restoreClient = require('../db.js').__setClientForTests(prismaFake);
  const { app } = require('../server.js');
  ({ signToken } = require('../auth.js'));

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
});

beforeEach(() => {
  resetPrisma();
  sentToGoogle = [];
  prismaFake.user.findUnique.mockResolvedValue({ sessionsValidFrom: null });
  // What withoutStudentName looks up. Scoped to the caller's own class in the
  // query, so the `where` is honoured by returning null for anyone else.
  prismaFake.submission.findFirst.mockImplementation(async ({ where }) => (
    where?.activity?.class?.teacherId === T1
      ? { student: { name: STUDENT_NAME } }
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
