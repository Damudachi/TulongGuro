/**
 * Output types a teacher can assign to an activity.
 *
 * The gradebook groups columns by Activity.type, so every kind of output that
 * should be averaged separately (e.g. Survey/Form vs Essay) needs an entry here.
 * Keep this list in sync with the outputType values the curriculum parser may
 * return in server/server.js.
 */
export const ACTIVITY_TYPES = [
  'Essay',
  'Short Answer',
  'Journal',
  'Reflection',
  'Creative Writing',
  'Research Paper',
  'Survey/Form',
  'Outline',
  'Report',
  'Letter',
  'Poem',
  'Speech',
  'Summary',
  'Quiz',
];
