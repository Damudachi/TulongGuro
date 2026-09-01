import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

/**
 * The AI Teacher Assistant — the chat drawer on the review screen.
 *
 * It used to be the "AI Co-Pilot", and it could do exactly one thing: take
 * whatever the teacher typed as an instruction to rewrite the feedback. Two
 * consequences, both of which these tests pin shut:
 *
 *   1. A question got a rewrite. "Why did Organization land on 3?" came back
 *      as a fresh paragraph of student feedback, because there was no path
 *      through the endpoint that did not end in rewritten feedback.
 *   2. On a structured paper the rewrite *was* the chat message, and structured
 *      feedback is JSON — so the teacher read `{"strengths": "The essay...`
 *      in the bubble, with an Apply button under it.
 *
 * The fix is a separation the model cannot collapse: `reply` is prose for the
 * teacher, `revisedFeedback` is the payload the Apply button writes into the
 * form, and an answer carries no revision at all. parseAssistantTurn is where
 * that separation is enforced, whatever the model returns.
 */

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const readSource = (rel) => fs.readFileSync(path.join(here, '..', rel), 'utf8');
const SERVER_SRC = readSource('server.js');

// server.js opens a database connection and starts listening on import, which
// this suite avoids. parseAssistantTurn is pure, so it is lifted out of the
// source and evaluated on its own — same approach as lesson-competencies.
function lift(name) {
  const start = SERVER_SRC.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`${name} not found in server.js`);
  // The signature destructures its options argument, so the first `{` after
  // the name belongs to the parameter list, not to the body. Walk the parens
  // first, then balance braces from the one that opens the body.
  let parens = 0, sigEnd = -1;
  for (let j = SERVER_SRC.indexOf('(', start); j < SERVER_SRC.length; j++) {
    if (SERVER_SRC[j] === '(') parens++;
    else if (SERVER_SRC[j] === ')' && --parens === 0) { sigEnd = j; break; }
  }
  let depth = 0, end = -1;
  for (let j = SERVER_SRC.indexOf('{', sigEnd); j < SERVER_SRC.length; j++) {
    if (SERVER_SRC[j] === '{') depth++;
    else if (SERVER_SRC[j] === '}' && --depth === 0) { end = j + 1; break; }
  }
  return new Function(`${SERVER_SRC.slice(start, end)}; return ${name};`)();
}
const parseAssistantTurn = lift('parseAssistantTurn');

describe('parseAssistantTurn — a question is answered, not rewritten', () => {
  it('returns the answer as prose and offers nothing to apply', () => {
    const turn = parseAssistantTurn(JSON.stringify({
      action: 'answer',
      reply: 'Organization is at 3 because the middle two paragraphs both open on the same claim.',
      revisedFeedback: null,
    }), { isStructured: true });

    expect(turn.action).toBe('answer');
    expect(turn.reply).toContain('same claim');
    // The whole point: nothing here is applyable, so the UI shows no button
    // and the teacher cannot paste an answer into a student's feedback.
    expect(turn.revisedFeedback).toBeNull();
  });

  it('drops a revision the model attached to an answer', () => {
    // Asked a question, handed back a rewrite anyway. The teacher gets the
    // answer; the unrequested rewrite is not offered.
    const turn = parseAssistantTurn(JSON.stringify({
      action: 'answer',
      reply: 'Reteach topic sentences before the next essay.',
      revisedFeedback: { strengths: 'Rewritten without being asked.' },
    }), { isStructured: true });

    expect(turn.action).toBe('answer');
    expect(turn.revisedFeedback).toBeNull();
  });
});

describe('parseAssistantTurn — a rewrite is described, not printed', () => {
  it('keeps the revision out of what the teacher reads', () => {
    const turn = parseAssistantTurn(JSON.stringify({
      action: 'revise',
      reply: 'Shortened the growth notes and kept both quotes as they were.',
      revisedFeedback: {
        strengths: 'The argument is stated in the first paragraph.',
        areasForGrowth: [{ studentQuote: 'it was very fun', explanation: 'States a reaction, not a reason.' }],
        actionableSteps: ['Add one reason after each opinion.'],
      },
    }), { isStructured: true });

    expect(turn.action).toBe('revise');
    // This is the bug the separation exists for: the bubble must not contain
    // the serialized feedback.
    expect(turn.reply).toBe('Shortened the growth notes and kept both quotes as they were.');
    expect(turn.reply).not.toContain('{');
    expect(turn.reply).not.toContain('strengths');

    // And the payload is the form's own shape, ready for the Apply button.
    const applied = JSON.parse(turn.revisedFeedback);
    expect(applied.strengths).toContain('first paragraph');
    expect(applied.areasForGrowth[0].studentQuote).toBe('it was very fun');
    expect(applied.actionableSteps).toHaveLength(1);
  });

  it('passes a legacy paper its rewrite as plain text', () => {
    const turn = parseAssistantTurn(JSON.stringify({
      action: 'revise',
      reply: 'Cut it to three sentences.',
      revisedFeedback: 'The essay states a position and supports it once.',
    }), { isStructured: false });

    expect(turn.action).toBe('revise');
    expect(turn.revisedFeedback).toBe('The essay states a position and supports it once.');
  });

  it('refuses a structured revision that is not the form\'s shape', () => {
    // A bare string cannot be merged into strengths/growth/steps without
    // guessing which field it belongs to. Guessing is how a rewrite lands in
    // the wrong half of a student's feedback, so it is not offered at all.
    const turn = parseAssistantTurn(JSON.stringify({
      action: 'revise',
      reply: 'Here is a softer version.',
      revisedFeedback: 'A softer version as one loose string.',
    }), { isStructured: true });

    expect(turn.revisedFeedback).toBeNull();
    expect(turn.action).toBe('answer');
    // The teacher still reads what it said — only the unusable payload is gone.
    expect(turn.reply).toBe('Here is a softer version.');
  });

  it('downgrades a revise turn that produced no revision', () => {
    const turn = parseAssistantTurn(JSON.stringify({
      action: 'revise',
      reply: 'Which paragraph did you want tightened?',
      revisedFeedback: null,
    }), { isStructured: true });

    expect(turn.action).toBe('answer');
    expect(turn.revisedFeedback).toBeNull();
  });
});

describe('parseAssistantTurn — malformed output', () => {
  it('treats bare prose as an answer', () => {
    // Asked for JSON, given a sentence. That is a formatting slip, not a
    // failure — and it is certainly not a rewrite to apply.
    const turn = parseAssistantTurn('Mark it against the rubric you published, not the draft one.', { isStructured: true });

    expect(turn.action).toBe('answer');
    expect(turn.reply).toBe('Mark it against the rubric you published, not the draft one.');
    expect(turn.revisedFeedback).toBeNull();
  });

  it('strips a markdown code fence before parsing', () => {
    const turn = parseAssistantTurn('```json\n{"action":"answer","reply":"Two run-ons, both in paragraph 3."}\n```', { isStructured: true });

    expect(turn.reply).toBe('Two run-ons, both in paragraph 3.');
    expect(turn.reply).not.toContain('```');
  });

  it('never returns a revision from output it could not parse', () => {
    for (const raw of ['', '   ', '{"action":"revise"', 'null', '[1,2,3]']) {
      expect(parseAssistantTurn(raw, { isStructured: true }).revisedFeedback).toBeNull();
    }
  });
});

describe('the endpoint the drawer talks to', () => {
  it('is registered at /api/teacher/assistant, with the old path kept as an alias', () => {
    // The frontend (Vercel) and this server (Render) deploy separately, so a
    // tab still running the previous build posts to /refine until it reloads.
    expect(SERVER_SRC).toContain("app.post('/api/teacher/assistant', teacherAssistantHandler)");
    expect(SERVER_SRC).toContain("app.post('/api/teacher/refine', teacherAssistantHandler)");
  });

  // Registering the route is only half of reaching it. authorizePath() reads
  // the segment after /api/teacher/ as a teacher id unless it is listed as a
  // route segment, so a route named 'assistant' that is not in that set 403s
  // every call with "You can only access your own classes." — which is exactly
  // what the rename shipped, with the route registration test above passing
  // the whole time. The alias is asserted too: it was already listed, and
  // dropping it would break the tabs the alias exists for.
  it('is reachable — both paths are listed as teacher route segments', () => {
    const { TEACHER_ROUTE_SEGMENTS } = require('../auth');
    expect(TEACHER_ROUTE_SEGMENTS.has('assistant')).toBe(true);
    expect(TEACHER_ROUTE_SEGMENTS.has('refine')).toBe(true);
  });

  it('refuses an empty message before spending a model call', () => {
    const handler = SERVER_SRC.slice(SERVER_SRC.indexOf('const teacherAssistantHandler'));
    const guard = handler.indexOf('Ask the assistant something first');
    const modelCall = handler.indexOf('if (assistPool.length)');
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(modelCall);
  });

  it('tells the model it may answer as well as rewrite', () => {
    const handler = SERVER_SRC.slice(
      SERVER_SRC.indexOf('const teacherAssistantHandler'),
      SERVER_SRC.indexOf("app.post('/api/teacher/assistant'"),
    );
    expect(handler).toContain('"action": "answer"');
    expect(handler).toContain('"action": "revise"');
    // The grader's tone rule still binds the student-facing half, so a teacher
    // cannot undo it by asking for a wording tweak.
    expect(handler).toMatch(/objective, clinical and measured/);
  });
});

describe('the review screen drawer', () => {
  const SRC = new URL('../../src/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  const workspace = fs.readFileSync(path.join(SRC, 'pages/teacher/HITLWorkspace.jsx'), 'utf8');

  it('is called the AI Teacher Assistant, not the Co-Pilot', () => {
    expect(workspace).toContain('AI Teacher Assistant');
    expect(workspace).not.toMatch(/Co-Pilot/i);
  });

  it('applies the revision payload, never the message text', () => {
    // applyFeedback(msg.text, …) is what put a chat reply into the feedback
    // form. It takes the separate revision now.
    expect(workspace).toContain('applyFeedback(idx, msg.revision');
    expect(workspace).not.toContain('applyFeedback(msg.text');
  });

  it('only offers a proposal on a message that carries a rewrite', () => {
    expect(workspace).toMatch(/msg\.role === 'ai' && !msg\.failed && msg\.preview/);
  });

  it('shows the proposed feedback before there is anything to accept', () => {
    // The whole point of the preview: a teacher approving a rewrite of a
    // student's feedback has to be able to read it first. If the accept button
    // ever moves out of RevisionPreview, or the card stops rendering the
    // proposed text, this is what notices.
    expect(workspace).toContain('function RevisionPreview');
    expect(workspace).toContain('Proposed feedback');
    expect(workspace).toContain('<RevisionPreview');
    // "Use this" lives inside the card, under the text it applies.
    const card = workspace.slice(
      workspace.indexOf('function RevisionPreview'),
      workspace.indexOf('export default function HITLWorkspace'),
    );
    expect(card).toContain('onApply');
    expect(card).toContain('onDismiss');
    expect(card).toMatch(/field\.after/);
  });

  it('computes the preview when the reply arrives, not at render time', () => {
    // A preview recomputed on every render re-baselines against edits the
    // teacher made after the reply, so a field about to be overwritten can
    // read as "unchanged".
    const send = workspace.slice(
      workspace.indexOf('const handleChatSubmit'),
      workspace.indexOf('const applyFeedback'),
    );
    expect(send).toContain('describeRevision(');
    expect(send).toContain('preview,');
  });

  it('says so when a rewrite cannot be shown, instead of offering to apply it', () => {
    // describeRevision and applyFeedback refuse the same payloads, so a card
    // must never appear for one the form cannot take.
    expect(workspace).toContain('previewUnavailable');
  });

  it('sends the paper and the conversation so far as context', () => {
    expect(workspace).toContain('const assistantContext');
    expect(workspace).toContain('context: assistantContext');
    expect(workspace).toContain('history,');
  });
});

/**
 * The transcription cache — why a follow-up is fast.
 *
 * The model is stateless, so the paper used to go up as an image on every
 * message of the conversation: a multi-megabyte upload and a full vision pass
 * to answer "why?". The first message now transcribes the paper alongside its
 * answer and every message after it sends that text instead.
 *
 * Two things have to hold for that to be safe rather than merely fast, and
 * both are pinned below: a transcription must never outlive the page it was
 * read from, and the store must not grow without bound in a long-lived
 * process.
 */
describe('the transcription cache', () => {
  // The three helpers share one Map and its constants, so they are lifted as
  // one block rather than individually the way parseAssistantTurn is.
  function liftCache() {
    const start = SERVER_SRC.indexOf('const ASSIST_TRANSCRIPT_TTL_MS');
    const tail = SERVER_SRC.indexOf('function writeAssistTranscript(');
    if (start === -1 || tail === -1) throw new Error('transcription cache not found in server.js');
    let depth = 0, end = -1;
    for (let j = SERVER_SRC.indexOf('{', tail); j < SERVER_SRC.length; j++) {
      if (SERVER_SRC[j] === '{') depth++;
      else if (SERVER_SRC[j] === '}' && --depth === 0) { end = j + 1; break; }
    }
    return new Function('process', `${SERVER_SRC.slice(start, end)};
      return { assistTranscriptKey, readAssistTranscript, writeAssistTranscript, assistantTranscripts };`
    )({ env: {} });
  }

  it('keys on the stored image, so a redaction cannot serve the old reading', () => {
    // The whole point of redacting is that what was covered is gone. A cache
    // keyed on the submission alone would have kept quoting the name that had
    // just been painted out, because the id does not change when the page does.
    const c = liftCache();
    const before = c.assistTranscriptKey('sub-1', 'papers/original.jpg');
    const after = c.assistTranscriptKey('sub-1', 'papers/redacted-1730000000.jpg');
    expect(before).not.toBe(after);

    c.writeAssistTranscript(before, 'My name is written at the top.');
    expect(c.readAssistTranscript(after)).toBeNull();
    expect(c.readAssistTranscript(before)).toBe('My name is written at the top.');
  });

  it('expires an entry rather than serving it forever', () => {
    const c = liftCache();
    const key = c.assistTranscriptKey('sub-2', 'papers/a.jpg');
    c.writeAssistTranscript(key, 'The boy learns that lying makes people lose trust in you.');
    expect(c.readAssistTranscript(key)).toContain('lying makes people');

    // Age the entry past the TTL in place, rather than waiting six hours.
    c.assistantTranscripts.get(key).at = Date.now() - (7 * 60 * 60 * 1000);
    expect(c.readAssistTranscript(key)).toBeNull();
    expect(c.assistantTranscripts.has(key)).toBe(false);
  });

  it('evicts the least recently read paper, not the one written longest ago', () => {
    // A teacher working down a class list comes back to the paper they are
    // arguing about. Evicting by write order would drop exactly that one.
    const c = liftCache();
    const keys = [];
    for (let i = 0; i < 300; i++) {
      const k = c.assistTranscriptKey(`sub-${i}`, `papers/${i}.jpg`);
      keys.push(k);
      c.writeAssistTranscript(k, `paper ${i}`);
    }
    expect(c.assistantTranscripts.size).toBe(300);

    // Touch the oldest, then push the store over its ceiling.
    expect(c.readAssistTranscript(keys[0])).toBe('paper 0');
    c.writeAssistTranscript(c.assistTranscriptKey('sub-300', 'papers/300.jpg'), 'paper 300');

    expect(c.assistantTranscripts.size).toBe(300);
    expect(c.readAssistTranscript(keys[0])).toBe('paper 0');   // read, so kept
    expect(c.readAssistTranscript(keys[1])).toBeNull();        // untouched, so dropped
  });

  it('ignores an empty transcription instead of caching a blank paper', () => {
    // A model that returned "" would otherwise poison every later message in
    // the conversation with a paper that has nothing in it.
    const c = liftCache();
    const key = c.assistTranscriptKey('sub-3', 'papers/b.jpg');
    c.writeAssistTranscript(key, '   ');
    expect(c.readAssistTranscript(key)).toBeNull();
  });
});

describe('parseAssistantTurn — the transcription rides along', () => {
  it('surfaces a transcription without letting it reach the teacher', () => {
    const turn = parseAssistantTurn(JSON.stringify({
      action: 'answer',
      reply: 'Length landed on 2 because the closing paragraph is one sentence.',
      revisedFeedback: null,
      transcription: 'Once upon a time there was a boy who told lies.',
    }));
    expect(turn.transcription).toBe('Once upon a time there was a boy who told lies.');
    // It is a cache payload, not part of the conversation.
    expect(turn.reply).not.toContain('Once upon a time');
    expect(turn.action).toBe('answer');
  });

  it('is null when the model did not send one', () => {
    const turn = parseAssistantTurn(JSON.stringify({
      action: 'answer', reply: 'Yes.', revisedFeedback: null,
    }));
    expect(turn.transcription).toBeNull();
  });

  it('is null when the reply was not JSON at all', () => {
    const turn = parseAssistantTurn('The rubric weights organization at 20 points.');
    expect(turn.transcription).toBeNull();
    expect(turn.reply).toContain('organization');
  });
});

describe('the assistant handler asks for a transcription only when it needs one', () => {
  const handler = SERVER_SRC.slice(
    SERVER_SRC.indexOf('const teacherAssistantHandler'),
    SERVER_SRC.indexOf("app.post('/api/teacher/assistant'"),
  );

  it('only transcribes when an image is actually attached', () => {
    // A cached paper, a typed submission and a paper that could not be opened
    // all have nothing to read; asking for a transcription would buy output
    // tokens for text that already exists or does not.
    expect(handler).toContain('const wantsTranscription = Boolean(paperFilePart && paper.key)');
  });

  it('sends the cached text in place of the image', () => {
    expect(handler).toContain('const paperText = paper.cachedText');
    expect(handler).toContain('scrub(paperText)');
  });

  it('scrubs the name out of a transcription before storing it', () => {
    // The prompt asks the model to leave a name off the page out of its
    // transcription. This is the layer that does not depend on it obeying.
    expect(handler).toContain('writeAssistTranscript(paper.key, scrub(turn.transcription))');
  });
});
