import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * One activity, several topics.
 *
 * A piece of work is routinely set against more than one competency — a
 * reflection essay marked for summarising a text *and* for the figures of
 * speech in it — and the form only ever let a teacher tag one. The rest were
 * lost from the analytics breakdown and from what the AI was told to look for.
 *
 * The storage rule these tests hold: Activity.topic is a comma-separated list
 * of topic ids in the same column a single id used to occupy, so every activity
 * tagged before this change reads back as a one-item list and nothing needed
 * migrating. Topic ids are slugs and never contain a comma.
 *
 * Loaded through createRequire for the same reason route-wiring.test.js does:
 * these modules are CommonJS.
 */

const require = createRequire(import.meta.url);
const { parseTopicIds, formatTopicIds, getTopicsAIGuidance, DEPED_GRADE6_ENGLISH_TOPICS } = require('../depedTopics.js');

const [FIRST, SECOND] = DEPED_GRADE6_ENGLISH_TOPICS;

describe('parseTopicIds — reading what an activity is tagged with', () => {
  it('reads an activity tagged before topics could be multiple', () => {
    expect(parseTopicIds(FIRST.id)).toEqual([FIRST.id]);
  });

  it('reads several topics out of the stored string', () => {
    expect(parseTopicIds(`${FIRST.id},${SECOND.id}`)).toEqual([FIRST.id, SECOND.id]);
  });

  it('treats no topic, an empty string and whitespace alike as untagged', () => {
    expect(parseTopicIds(null)).toEqual([]);
    expect(parseTopicIds('')).toEqual([]);
    expect(parseTopicIds('   ')).toEqual([]);
    expect(parseTopicIds(undefined)).toEqual([]);
  });

  it('survives the shapes a hand-edited value arrives in', () => {
    // Trailing separators and padding come from a teacher typing a list into
    // the quick-edit box. An empty id would become its own analytics bucket.
    expect(parseTopicIds(` ${FIRST.id} , ,${SECOND.id},`)).toEqual([FIRST.id, SECOND.id]);
  });

  it('drops repeats, which would otherwise count one paper twice', () => {
    expect(parseTopicIds(`${FIRST.id},${FIRST.id}`)).toEqual([FIRST.id]);
  });

  it('accepts an array, which is the shape the form holds', () => {
    expect(parseTopicIds([FIRST.id, '', SECOND.id])).toEqual([FIRST.id, SECOND.id]);
  });

  it('keeps the order they were picked in', () => {
    expect(parseTopicIds([SECOND.id, FIRST.id])).toEqual([SECOND.id, FIRST.id]);
  });
});

describe('formatTopicIds — what actually gets stored', () => {
  it('writes the list back in the shape the column holds', () => {
    expect(formatTopicIds([FIRST.id, SECOND.id])).toBe(`${FIRST.id},${SECOND.id}`);
  });

  it('gives an empty string for no topics, which the routes store as null', () => {
    expect(formatTopicIds([])).toBe('');
    expect(formatTopicIds(null)).toBe('');
  });

  it('round-trips: what is stored reads back as what was picked', () => {
    const picked = [SECOND.id, FIRST.id];
    expect(parseTopicIds(formatTopicIds(picked))).toEqual(picked);
  });

  it('normalizes a free-typed list rather than storing it as it was typed', () => {
    expect(formatTopicIds(` ${FIRST.id} ,${FIRST.id}, `)).toBe(FIRST.id);
  });
});

describe('getTopicsAIGuidance — what the grader is told to look for', () => {
  it('gives the guidance for a single topic, as before', () => {
    const guidance = getTopicsAIGuidance(FIRST.id);

    expect(guidance).toContain(FIRST.name);
    expect(guidance).toContain(FIRST.aiGuidance);
  });

  it('gives every tagged topic, not just the first', () => {
    // The whole point: grading against topic one and ignoring topic two marks
    // the paper for half of what it was set for.
    const guidance = getTopicsAIGuidance(`${FIRST.id},${SECOND.id}`);

    expect(guidance).toContain(FIRST.name);
    expect(guidance).toContain(SECOND.name);
  });

  it('says nothing for an untagged activity, so the prompt omits the rule', () => {
    expect(getTopicsAIGuidance(null)).toBe('');
    expect(getTopicsAIGuidance('')).toBe('');
  });

  it('ignores tags that are not competencies rather than inventing guidance', () => {
    // Free text typed into the quick-edit box is a label, not a competency —
    // there is no description of it to hand the model.
    expect(getTopicsAIGuidance('Noli Me Tangere')).toBe('');
    expect(getTopicsAIGuidance(`Noli Me Tangere,${FIRST.id}`)).toContain(FIRST.name);
  });
});

/**
 * The browser has its own copy of these two functions — there is no module
 * shared across the client/server boundary in this app — and an activity saved
 * by a form that splits differently from the server that reads it is tagged
 * with topics nobody can see. This is the guard on the pair drifting.
 */
describe('the browser copy of the storage rule', () => {
  const clientSource = fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'utils', 'topics.js'),
    'utf8'
  );

  it('exists and exports the same two functions the server uses', () => {
    expect(clientSource).toMatch(/export function parseTopicIds/);
    expect(clientSource).toMatch(/export function formatTopicIds/);
  });

  it('splits on the same separator', () => {
    expect(clientSource).toContain("split(',')");
    expect(clientSource).toContain("join(',')");
  });
});
