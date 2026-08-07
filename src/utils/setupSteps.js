/**
 * The first-run checklist a teacher works through, derived from their own rows.
 *
 * Kept apart from the component that draws it for two reasons: a file that
 * exports both a component and a helper breaks React fast refresh, and this is
 * the part worth reading on its own — the order of these four steps is the
 * opinion. Roster first, because every later step needs student records to
 * hang off; releasing last, because that is the moment a learner sees anything.
 *
 * Nothing here reads a stored step number. `done` is a fact about the
 * database, so the checklist is right on any device and cannot claim a teacher
 * has done something their dashboard shows they have not.
 *
 * @param {{sections:number, students:number, classes:number, activities:number, graded:number, released:number}} setup
 */
export function buildSteps(setup) {
  const { sections = 0, students = 0, classes = 0, activities = 0, graded = 0, released = 0 } = setup || {};

  return [
    {
      id: 'roster',
      title: 'Add your block section and its class list',
      body: 'Type or paste your learners\' names — last name first. TulongGuro makes an account for each of them and gives you a printable list of their sign-in details.',
      done: students > 0,
      progress: students > 0
        ? `${students} student${students === 1 ? '' : 's'} enrolled in ${sections} section${sections === 1 ? '' : 's'}`
        : sections > 0
          ? `${sections} section${sections === 1 ? '' : 's'} created — no learners on the list yet`
          : null,
      to: '/teacher/sections',
      cta: sections > 0 ? 'Add learners' : 'Create a block section',
    },
    {
      id: 'class',
      title: 'Create your first class',
      body: 'A class is one subject taught to one block section — "English 6 – Sampaguita", for example. Your school\'s curriculum is filled in for you where there is one.',
      done: classes > 0,
      progress: classes > 0 ? `${classes} class${classes === 1 ? '' : 'es'} created` : null,
      // No `to`: the class form is a modal on the dashboard itself, so the
      // component supplies the handler instead of a route.
      cta: 'Create a class',
    },
    {
      id: 'activity',
      title: 'Create your first activity',
      body: 'An activity is one piece of work you will grade — an essay, a worksheet, a quiz. Set what it is worth and how you want it marked.',
      done: activities > 0,
      progress: activities > 0 ? `${activities} activit${activities === 1 ? 'y' : 'ies'} created` : null,
      to: '/teacher/activity/new',
      cta: 'Create an activity',
      // There is nothing to attach an activity to until a class exists. Said
      // here rather than letting the teacher find out on the next screen.
      blockedBy: classes === 0 ? 'Create a class first' : null,
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
      to: '/teacher/batch-upload',
      cta: graded > 0 ? 'Release checked work' : 'Upload a paper',
      blockedBy: activities === 0 ? 'Create an activity first' : null,
    },
  ];
}
