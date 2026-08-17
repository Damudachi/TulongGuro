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
