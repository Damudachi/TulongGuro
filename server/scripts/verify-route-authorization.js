/**
 * Walks every /api/teacher/* route actually registered in server.js and
 * checks it against a hand-maintained manifest of which ones need an
 * in-handler ownership check beyond what authorizePath() gives them for free.
 *
 * Why this exists: authorizePath() (auth.js) confirms a caller is *a*
 * teacher, but for any route whose second path segment is listed in
 * TEACHER_ROUTE_SEGMENTS, it deliberately defers "does this teacher own the
 * specific resource in the URL/body" to the route handler — see auth.js's
 * own comment on that set. AI-1 was exactly this: three handlers (grade,
 * analyze, teacher/upload) fell through that gap and let any teacher act on
 * any other teacher's submissions. Fixing AI-1 closed those three; auditing
 * for this script turned up several more of the same shape (classes/:id
 * lessons + parse-curriculum, activities/:activityId scores/update/delete,
 * demo-data/:classId) that were fixed alongside it.
 *
 * This is deliberately a *manifest* check, not a heuristic one: every
 * currently-registered /api/teacher/ route must appear here with an explicit
 * needsCheck decision, and any new route that shows up in server.js without a
 * matching entry fails the run. That forces a human decision at the moment a
 * route is added, rather than relying on someone remembering to add a check.
 *
 * Run after any change to server.js's /api/teacher/ routes:
 *   node scripts/verify-route-authorization.js
 */
const fs = require('fs');
const path = require('path');

const SERVER_SRC = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
// Read from auth.js itself rather than restated here, for the same reason
// auth.js exports it: a second copy of this set is a second thing to forget.
const { TEACHER_ROUTE_SEGMENTS } = require('../auth');

// Idioms this codebase actually uses to prove "the caller owns this resource".
// Keep in sync with teacherOwnsActivity/teacherOwnsClass/requireOwnTemplate
// and the inline `x.teacherId !== req.auth.sub` checks used alongside them.
const OWNERSHIP_IDIOMS = [
  /teacherOwnsActivity\(/,
  /teacherOwnsClass\(/,
  /requireOwnTemplate\(/,
  /staffOwnsActivitySchool\(/,
  /\.teacherId\s*!==\s*(req\.auth\.sub|teacherId)/,
  /teacherId:\s*req\.auth\.sub/,
];

/**
 * true  -> this route addresses a specific existing resource (by URL param or
 *          body field) and MUST prove ownership of it in the handler.
 * false -> either authorizePath already proves ownership (a bare :teacherId
 *          segment, or the special-cased GET rubric-templates/:teacherId),
 *          or the route creates a brand-new resource / touches no
 *          teacher-owned resource at all (no existing thing to own).
 */
const ROUTE_MANIFEST = {
  'GET /api/teacher/:teacherId/curriculum-suggestion': { needsCheck: false, note: 'authorizePath: seg[2] is the teacherId itself' },
  'GET /api/teacher/:teacherId/setup-status': { needsCheck: false, note: 'authorizePath: seg[2] is the teacherId itself' },
  'POST /api/teacher/quick-setup': { needsCheck: false, note: 'creates new section+class for the caller' },
  'DELETE /api/teacher/demo-data/:classId': { needsCheck: true },
  'GET /api/teacher/:teacherId/sections': { needsCheck: false, note: 'authorizePath: seg[2] is the teacherId itself' },
  'POST /api/teacher/extract-students': { needsCheck: false, note: 'stateless file->names extraction, no resource id' },
  'POST /api/teacher/sections': { needsCheck: false, note: 'creates a new section for the caller' },
  'PUT /api/teacher/sections/:sectionId/students/:studentId': { needsCheck: true },
  'PUT /api/teacher/sections/:sectionId/students/:studentId/password': { needsCheck: true },
  'GET /api/teacher/:teacherId/classes': { needsCheck: false, note: 'authorizePath: seg[2] is the teacherId itself' },
  'POST /api/teacher/classes': { needsCheck: false, note: 'creates a new class for the caller' },
  'POST /api/teacher/classes/:id/parse-curriculum': { needsCheck: true },
  'GET /api/teacher/classes/:id/lessons': { needsCheck: true },
  'POST /api/teacher/activities/:activityId/scores': { needsCheck: true },
  // Creates a new activity, but hangs it off an existing class named in the
  // body — so the class, at least, has to be proved the caller's.
  'POST /api/teacher/activities': { needsCheck: true },
  'PUT /api/teacher/activities/:activityId': { needsCheck: true },
  'DELETE /api/teacher/activities/:activityId': { needsCheck: true },
  // Teacher-authored badges. The list and the create take no resource id — both
  // are scoped to req.auth.sub — while update and delete address a badge id and
  // prove ownership with `teacherId: req.auth.sub` in the where clause.
  'GET /api/teacher/badges': { needsCheck: false, note: 'lists the caller\'s own badges; scoped to req.auth.sub' },
  'POST /api/teacher/badges': { needsCheck: false, note: 'creates a new badge for the caller' },
  'PUT /api/teacher/badges/:badgeId': { needsCheck: true },
  'DELETE /api/teacher/badges/:badgeId': { needsCheck: true },
  'GET /api/teacher/rubric-templates/:teacherId': { needsCheck: false, note: 'authorizePath special-cases this exact GET shape directly' },
  'POST /api/teacher/rubric-templates': { needsCheck: false, note: 'creates a new template for the caller' },
  'PUT /api/teacher/rubric-templates/:id': { needsCheck: true },
  'DELETE /api/teacher/rubric-templates/:id': { needsCheck: true },
  'POST /api/teacher/rubric/extract': { needsCheck: false, note: 'stateless file->rubric extraction, no resource id' },
  'POST /api/teacher/submissions/:id/analyze': { needsCheck: true },
  'GET /api/teacher/activities/:activityId/ai-check': { needsCheck: true },
  'POST /api/teacher/activities/:activityId/ai-check': { needsCheck: true },
  'GET /api/teacher/ai-jobs/:jobId': { needsCheck: true },
  'DELETE /api/teacher/ai-jobs/:jobId': { needsCheck: true },
  'GET /api/teacher/ai-capacity': { needsCheck: false, note: 'global capacity snapshot, no teacher-owned resource' },
  'GET /api/teacher/activities/:activityId/release': { needsCheck: true },
  'POST /api/teacher/activities/:activityId/release': { needsCheck: true },
  'POST /api/teacher/submissions/:id/release': { needsCheck: true },
  'POST /api/teacher/submissions/excuse': { needsCheck: true },
  'GET /api/teacher/submissions/:id/history': { needsCheck: true },
  'POST /api/teacher/assistant': { needsCheck: false, note: 'chats about / rewrites feedback text passed in the body, no resource id' },
  // Legacy path for the same handler, kept while older frontend builds are
  // still loaded in browsers. Same reasoning: nothing is read by id.
  'POST /api/teacher/refine': { needsCheck: false, note: 'legacy alias of POST /api/teacher/assistant' },
  'PUT /api/teacher/submissions/:id/grade': { needsCheck: true },
  'GET /api/teacher/:teacherId/analytics': { needsCheck: false, note: 'authorizePath: seg[2] is the teacherId itself' },
  'GET /api/teacher/student/:studentId/analytics': { needsCheck: true },
  'GET /api/teacher/:teacherId/skill-progress': { needsCheck: false, note: 'authorizePath: seg[2] is the teacherId itself' },
  'GET /api/teacher/:teacherId/section/:sectionId/skill-progress': { needsCheck: false, note: 'authorizePath: seg[2] is the teacherId itself' },
  'GET /api/teacher/:teacherId/gradebook': { needsCheck: false, note: 'authorizePath: seg[2] is the teacherId itself' },
  'GET /api/teacher/:teacherId/student/:studentId/gradebook': { needsCheck: false, note: 'authorizePath: seg[2] is the teacherId itself' },
  'POST /api/teacher/upload': { needsCheck: true },
  'GET /api/teacher/:teacherId/gradebook/export': { needsCheck: false, note: 'authorizePath: seg[2] is the teacherId itself' },
  // Outside /api/teacher/, but the exact same drift risk (no TEACHER_ROUTE_SEGMENTS
  // gate at all) — tracked here rather than widening this script's route scan.
  'GET /api/classes/:classId': { needsCheck: true },
  // Same drift risk again: no TEACHER_ROUTE_SEGMENTS gate, and until the fix
  // alongside this manifest entry, no in-handler check either — any staff
  // account on the platform could read another school's activity/submissions
  // by id. See staffOwnsActivitySchool().
  'GET /api/activities/:activityId': { needsCheck: true },
  'GET /api/activities/:activityId/submissions': { needsCheck: true },
};

// Ordered list of every `app.METHOD('path', ...)` registered at column 0 —
// this codebase's routes are all top-level, so a line-start anchor is enough
// and avoids matching route strings that appear inside comments or handler bodies.
const ROUTE_RE = /^app\.(get|post|put|delete|patch)\(\s*(['"])((?:(?!\2).)+)\2/gm;
const matches = [...SERVER_SRC.matchAll(ROUTE_RE)];

function handlerBody(index) {
  const start = matches[index];
  const end = matches[index + 1];
  const from = start.index;
  const to = end ? end.index : SERVER_SRC.length;
  return SERVER_SRC.slice(from, to);
}

const TRACKED_PREFIX = '/api/teacher/';
const TRACKED_EXTRA = new Set([
  'GET /api/classes/:classId',
  'GET /api/activities/:activityId',
  'GET /api/activities/:activityId/submissions',
]);

let pass = 0, fail = 0;
const seen = new Set();

/**
 * True if authorizePath will actually let this route through to its handler.
 *
 * Only /api/teacher/<literal>/... routes can fail here: a route whose second
 * segment is a `:param` is addressing the caller's own id, which is the case
 * authorizePath is built around. Anything outside /api/teacher/ is not gated
 * by TEACHER_ROUTE_SEGMENTS at all.
 */
function checkReachable(key, routePath) {
  if (!routePath.startsWith(TRACKED_PREFIX)) return true;
  const seg = routePath.split('/').filter(Boolean)[2];   // ['api','teacher',<seg>]
  if (!seg || seg.startsWith(':')) return true;
  if (seg === 'rubric-templates') return true;           // special-cased in authorizePath
  if (TEACHER_ROUTE_SEGMENTS.has(seg)) return true;
  fail++;
  console.error(`  FAIL ${key}: '${seg}' is not in TEACHER_ROUTE_SEGMENTS (auth.js), so authorizePath 403s every call to this route before the handler runs.`);
  return false;
}

matches.forEach((m, i) => {
  const method = m[1].toUpperCase();
  const routePath = m[3];
  const key = `${method} ${routePath}`;
  const isTracked = routePath.startsWith(TRACKED_PREFIX) || TRACKED_EXTRA.has(key);
  if (!isTracked) return;

  seen.add(key);
  const manifestEntry = ROUTE_MANIFEST[key];
  if (!manifestEntry) {
    fail++;
    console.error(`  FAIL ${key}: not in ROUTE_MANIFEST — classify it as needsCheck true/false before shipping.`);
    return;
  }

  // Reachability, checked before ownership. A /api/teacher/<literal> route
  // whose literal is not in TEACHER_ROUTE_SEGMENTS is not "unprotected" — it
  // is unreachable: authorizePath reads that segment as a teacher id, finds it
  // is not the caller's, and 403s every request with "You can only access your
  // own classes." That is how POST /api/teacher/assistant shipped dead while
  // this script reported 51/51 passing — it only ever asked whether handlers
  // prove ownership, never whether the route can be called at all.
  if (!checkReachable(key, routePath)) return;

  if (!manifestEntry.needsCheck) {
    pass++;
    return;
  }

  const body = handlerBody(i);
  const hasIdiom = OWNERSHIP_IDIOMS.some((re) => re.test(body));
  if (hasIdiom) {
    pass++;
  } else {
    fail++;
    console.error(`  FAIL ${key}: marked needsCheck but no ownership idiom found in its handler.`);
  }
});

// A manifest entry for a route that no longer exists is stale, not a failure
// on its own — but worth surfacing so the manifest stays a true mirror of
// server.js instead of silently accumulating dead entries.
const stale = Object.keys(ROUTE_MANIFEST).filter((k) => {
  const [, p] = k.split(/ (.+)/, 2);
  const tracked = p.startsWith(TRACKED_PREFIX) || TRACKED_EXTRA.has(k);
  return tracked && !seen.has(k);
});
if (stale.length) {
  console.warn(`\n  ${stale.length} manifest entr${stale.length === 1 ? 'y is' : 'ies are'} stale (route no longer registered):`);
  stale.forEach((k) => console.warn(`    - ${k}`));
}

console.log(`\n${pass} passed, ${fail} failed (${seen.size} /api/teacher/ routes scanned)`);
process.exit(fail === 0 ? 0 : 1);
