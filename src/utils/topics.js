/**
 * How an activity records the curriculum topics it covers.
 *
 * One activity commonly covers more than one competency — a single essay can be
 * marked for summarising a text *and* for using the right figures of speech —
 * so Activity.topic holds a comma-separated list of DepEd topic ids rather than
 * one id. That is deliberately the same column a single id was stored in: an
 * activity tagged before this change reads back as a one-item list, so nothing
 * already saved needs migrating or re-tagging. Topic ids are slugs
 * ("t1-02-hyperbole-irony") and never contain a comma.
 *
 * The server keeps its own copy of these two functions in depedTopics.js —
 * shared code across the client/server boundary would need a build step this
 * app doesn't have. The pair must stay in step; server/tests/activity-topics
 * .test.js holds the rules both are expected to follow.
 */

/** Ids in the order first seen, blanks and duplicates dropped. */
function normalize(list) {
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    const id = String(raw ?? '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** The topic ids on an activity, from either the stored string or an array. */
export function parseTopicIds(value) {
  if (Array.isArray(value)) return normalize(value);
  if (!value) return [];
  return normalize(String(value).split(','));
}

/** The stored form of a list of topic ids. Empty means "no topic". */
export function formatTopicIds(ids) {
  return parseTopicIds(ids).join(',');
}

/**
 * Curriculum lessons as topic tags.
 *
 * The DepEd map is Grade 6 English and nothing else, so on any other class it
 * has no rows and the competency control used to disappear altogether —
 * leaving that teacher a single-select lesson dropdown and no way to say an
 * activity covered more than one week. Every subject has a curriculum; only
 * one of them has a competency map shipped in this repo.
 *
 * So a lesson from the class's own uploaded scope-and-sequence is taggable the
 * same way a competency is, written as `lesson:<id>` in the same column. The
 * prefix keeps the two apart: DepEd ids are slugs that never contain a colon.
 *
 * Mirrors server/depedTopics.js — see the note above about the two copies.
 */
export const LESSON_TOPIC_PREFIX = 'lesson:';

/** Whether a topic id names a curriculum lesson rather than a DepEd competency. */
export function isLessonTopicId(id) {
  return String(id || '').startsWith(LESSON_TOPIC_PREFIX);
}

/** The topic id for a curriculum lesson. */
export function lessonTopicId(lessonId) {
  return `${LESSON_TOPIC_PREFIX}${lessonId}`;
}

/** The ClassLesson id inside a lesson topic id, or null if it isn't one. */
export function lessonIdFromTopicId(id) {
  return isLessonTopicId(id) ? String(id).slice(LESSON_TOPIC_PREFIX.length) : null;
}

/**
 * The Learning Competencies stored on a curriculum lesson, as a plain array.
 *
 * Stored as a JSON array of strings, extracted from the Learning Competencies
 * column of the school's own curriculum guide. Null or unparseable is an empty
 * list, never a throw: a lesson with no competencies is a normal thing (the
 * document may not have listed any), and it still contributes its title and
 * description to what the AI is told.
 *
 * Mirrors readCompetencies in server/server.js.
 */
export function readCompetencies(stored) {
  if (!stored) return [];
  if (Array.isArray(stored)) return stored.filter(c => typeof c === 'string' && c.trim());
  try {
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed.filter(c => typeof c === 'string' && c.trim()) : [];
  } catch {
    return [];
  }
}

/**
 * A curriculum lesson's name, with its week number said once.
 *
 * A lesson carries a week number and a title, and every screen that lists one
 * writes "Week 3: " in front of the title. Extracted curriculum documents
 * routinely put the week in the title too — the row in the school's own guide
 * reads "Week 3: Figures of Speech" — so the two combined into "Week 3: Week 3:
 * Figures of Speech" everywhere a lesson appeared.
 *
 * The leading week is dropped only when it is the same number the lesson
 * records. "Week 1: Week 2 review" is not a duplicate: it is a week-1 lesson
 * about week 2, and rewriting it would change what it says.
 *
 * Mirrors lessonDisplayName in server/depedTopics.js.
 */
export function lessonDisplayName(lesson) {
  const title = String(lesson?.title ?? '').trim();
  const week = parseInt(lesson?.weekNumber, 10);
  if (!Number.isFinite(week) || week < 1) return title;
  // (?![0-9]) so "Week 1" does not match the start of "Week 12", which would
  // leave a title of "2: ..." behind.
  const stripped = title
    .replace(new RegExp(`^week\\s*0*${week}(?![0-9])\\s*[:.)\\-–—]*\\s*`, 'i'), '')
    .trim();
  return stripped ? `Week ${week}: ${stripped}` : `Week ${week}`;
}

/**
 * Where a term ends, in school weeks — mirrors server/depedTopics.js.
 *
 * Only needed for curriculum lessons, which record a week number and no term.
 * A best guess, shown as one and always overridable; nothing is stored from it.
 */
export function termForWeek(week) {
  const n = parseInt(week, 10);
  if (!Number.isFinite(n) || n < 1) return null;
  if (n <= 13) return 1;
  if (n <= 26) return 2;
  return 3;
}
