/**
 * The first-run checklist a teacher works through, derived from their own rows.
 *
 * Kept apart from the component that draws it for two reasons: a file that
 * exports both a component and a helper breaks React fast refresh, and this is
 * the part worth reading on its own — the order of these four steps is the
 * opinion. Roster first, because every later step needs student records to
 * hang off; releasing last, because that is the moment a learner sees anything.
 *
 * ── Two of the four are no longer the teacher's to do ──
 *
 * Block sections, their rosters and the course shells are created in the admin
 * console. They stay on this list rather than being dropped from it, because a
 * teacher who cannot yet make an activity is owed the reason: without these
 * rows there is nothing to attach one to, and the answer is "your admin has
 * not set it up yet", not "you have not got round to it". A step that is
 * waiting on somebody else carries `blockedBy` and no route, so the card shows
 * a note where a button would be — the same treatment a step blocked by an
 * earlier one already gets.
 *
 * Nothing here reads a stored step number. `done` is a fact about the
 * database, so the checklist is right on any device and cannot claim a teacher
 * has done something their dashboard shows they have not.
 *
 * @param {{sections:number, students:number, classes:number, activities:number, graded:number, released:number, gradeTarget?:{activityId:string, classId:string}|null}} setup
 */
export function buildSteps(setup) {
  const { sections = 0, students = 0, classes = 0, activities = 0, graded = 0, released = 0, gradeTarget = null } = setup || {};

  // The upload/release screen is addressed by activity — without one it opens
  // on an empty roster, which is where "Release checked work" used to land.
  // The server picks the activity the step is actually about: the one holding
  // checked work, or the most recently published one when there is none.
  const gradeRoute = gradeTarget?.activityId
    ? `/teacher/batch-upload?activityId=${encodeURIComponent(gradeTarget.activityId)}` +
      (gradeTarget.classId ? `&classId=${encodeURIComponent(gradeTarget.classId)}` : '')
    : '/teacher/batch-upload';

  return [
    {
      id: 'roster',
      title: 'Your block section and its class list',
      body: 'Your school admin creates the block sections and enrols the learners, so each child gets an account and a Student ID to sign in with. You will see every section in your school here.',
      done: students > 0,
      progress: students > 0
        ? `${students} student${students === 1 ? '' : 's'} enrolled in ${sections} section${sections === 1 ? '' : 's'}`
        : sections > 0
          ? `${sections} section${sections === 1 ? '' : 's'} set up — no learners on the list yet`
          : null,
      // Only offered once there is something to look at. A link to an empty
      // list is a dead end dressed up as the next thing to do.
      to: sections > 0 ? '/teacher/sections' : null,
      cta: 'View your block sections',
      blockedBy: students === 0 ? 'Your school admin sets up sections and class lists' : null,
    },
    {
      id: 'class',
      title: 'Your classes',
      body: 'A class is one subject taught to one block section — "English 6 – Sampaguita", for example. Your school admin creates these and assigns them to you, with the school\'s curriculum already applied where there is one.',
      done: classes > 0,
      progress: classes > 0 ? `${classes} class${classes === 1 ? '' : 'es'} assigned to you` : null,
      // No route: the classes are on the dashboard this checklist sits on, so
      // the only link there could be is to the page already open.
      cta: 'Assigned by your school admin',
      blockedBy: classes === 0 ? 'Your school admin assigns your classes' : null,
    },
    {
      id: 'activity',
      title: 'Create your first activity',
      body: 'An activity is one piece of work you will grade — an essay, a worksheet, a quiz. Set what it is worth and how you want it marked.',
      done: activities > 0,
      progress: activities > 0 ? `${activities} activit${activities === 1 ? 'y' : 'ies'} created` : null,
      to: '/teacher/activity/new',
      cta: 'Create an activity',
      // There is nothing to attach an activity to until a class exists, and a
      // teacher cannot make one — so this names who can, rather than telling
      // them to do something the app will not let them do.
      blockedBy: classes === 0 ? 'Waiting for a class from your school admin' : null,
    },
    {
      id: 'grade',
      title: 'Grade a paper and release it',
      body: 'Upload a photo of a learner\'s work and let the AI read it. You see its suggested score and feedback first — nothing reaches a learner until you have checked it and pressed Release.',
      // Deliberately not "done" at `graded`: work that is marked but unreleased
      // is invisible to the learner, which is exactly the state a teacher is
      // most likely to stop in without realising.
      done: released > 0,
      progress: released > 0
        ? `${released} paper${released === 1 ? '' : 's'} released to learners`
        : graded > 0
          ? `${graded} paper${graded === 1 ? '' : 's'} checked — not released to learners yet`
          : null,
      to: gradeRoute,
      cta: graded > 0 ? 'Release checked work' : 'Upload a paper',
      blockedBy: activities === 0 ? 'Create an activity first' : null,
    },
  ];
}
