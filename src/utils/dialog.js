/**
 * In-app replacements for `alert()`, `confirm()` and `prompt()`.
 *
 * The browser's own dialogs render outside the page, so on the deployed build
 * every one of them was titled "tulong-guro.vercel.app says" — a URL a teacher
 * has no reason to recognise, in system chrome that looks nothing like the rest
 * of the app, and on a phone it is a grey OS sheet. Roughly 130 of them carried
 * real messages ("This paper has already been validated", "Delete this section?"),
 * so the app's most important sentences were the only ones not written in the
 * app's own voice.
 *
 * This is the store behind `<DialogHost />`, which is mounted once in App.jsx.
 * Kept apart from the component so the API can be imported from a plain module
 * (no hook, no provider, no prop drilling) — a call site changes from
 * `alert(msg)` to `showAlert(msg)` and nothing else about it moves.
 *
 * Requests QUEUE rather than replace each other. The native dialogs blocked the
 * thread, so code that fires two in a row — a validation loop reporting three
 * bad rows — got three dialogs. A store that held only the newest would have
 * shown the last one and silently dropped the rest, which is a behaviour change
 * dressed up as a restyle.
 */

let seq = 0;
/** Every unanswered request, oldest first. The head is what is on screen. */
const queue = [];
/** The mounted DialogHost's re-render callback, or null before it mounts. */
let notify = null;

function push(request) {
  return new Promise(resolve => {
    queue.push({ ...request, id: ++seq, resolve });
    notify?.();
  });
}

/** DialogHost subscribes on mount. One host only — a second would fight it. */
export function subscribeToDialogs(fn) {
  notify = fn;
  fn();
  return () => { if (notify === fn) notify = null; };
}

/** The request currently on screen, or null when the queue is empty. */
export function currentDialog() {
  return queue[0] || null;
}

/**
 * Answer one request and move the queue on.
 *
 * Addressed by id rather than by position: a dialog can be dismissed by Escape
 * at the same moment its own button is clicked, and settling by position would
 * then answer whichever request had just slid into the head.
 */
export function settleDialog(id, value) {
  const i = queue.findIndex(r => r.id === id);
  if (i === -1) return;
  const [request] = queue.splice(i, 1);
  request.resolve(value);
  notify?.();
}

/**
 * Say something. Resolves when it is dismissed; callers that do not care can
 * ignore the promise, which is what makes the alert sites a one-word change.
 *
 * `options`: { title, variant: 'info' | 'success' | 'warning' | 'error', confirmLabel }
 */
export const showAlert = (message, options = {}) => push({ kind: 'alert', message, ...options });

/**
 * Ask a yes/no question. Resolves true only if the confirming button is pressed
 * — Escape, the cancel button and a click on the scrim all resolve false, the
 * same answers `confirm()` gave.
 *
 * `options` adds { cancelLabel, danger } to the alert set. `danger: true` paints
 * the confirming button red; use it wherever the native call was guarding a
 * delete.
 */
export const showConfirm = (message, options = {}) => push({ kind: 'confirm', message, ...options });

/**
 * Ask for a line of text. Resolves the string, or null if cancelled — again the
 * same contract `prompt()` had, including that an empty string is a real answer
 * and not a cancellation.
 *
 * `options` adds { defaultValue, placeholder } to the confirm set.
 */
export const showPrompt = (message, options = {}) => push({ kind: 'prompt', message, ...options });
