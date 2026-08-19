import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, HelpCircle, Info, XCircle } from 'lucide-react';
import { currentDialog, settleDialog, subscribeToDialogs } from '../utils/dialog';

/**
 * The one on-screen home for `showAlert` / `showConfirm` / `showPrompt`.
 *
 * Mounted once, at the top of App.jsx, outside the router — a dialog raised by a
 * handler that then navigates away (delete a section, go back to the list) must
 * not be unmounted by the navigation it is reporting.
 *
 * See utils/dialog.js for why these exist at all: the native dialogs were
 * titled with the deployment's hostname and painted by the OS, which is the one
 * thing in the product a school cannot be walked through.
 */

/** Icon, tint and default heading per variant. `info` is what an unlabelled call gets. */
const VARIANTS = {
  info:    { Icon: Info,          ring: 'bg-royal-50 text-royal-500',  title: 'Notice' },
  success: { Icon: CheckCircle2,  ring: 'bg-aqua-50 text-aqua-600',    title: 'Done' },
  warning: { Icon: AlertTriangle, ring: 'bg-sun-100 text-sun-600',     title: 'Please check' },
  error:   { Icon: XCircle,       ring: 'bg-red-50 text-red-600',      title: 'Something went wrong' },
  ask:     { Icon: HelpCircle,    ring: 'bg-royal-50 text-royal-500',  title: 'Please confirm' },
};

export default function DialogHost() {
  const [request, setRequest] = useState(null);
  const inputRef = useRef(null);
  const confirmRef = useRef(null);
  const [draft, setDraft] = useState('');

  useEffect(() => subscribeToDialogs(() => setRequest(currentDialog())), []);

  const id = request?.id ?? null;
  const kind = request?.kind;

  // Reset the text box per REQUEST, not per render: a queued prompt that opens
  // behind another one must start from its own defaultValue rather than inherit
  // whatever was typed into the dialog before it. Adjusted during render rather
  // than in an effect — React's own answer for state derived from a prop-like
  // change, and the one that doesn't cost a second paint with the stale value
  // visible in between.
  const [draftFor, setDraftFor] = useState(null);
  if (id !== draftFor) {
    setDraftFor(id);
    setDraft(request?.kind === 'prompt' ? (request.defaultValue ?? '') : '');
  }

  // Focus what the keyboard should act on. Without this the focus stays on the
  // button that opened the dialog, so Enter re-fires the action underneath.
  useEffect(() => {
    if (!id) return;
    const t = setTimeout(() => (kind === 'prompt' ? inputRef.current : confirmRef.current)?.focus(), 0);
    return () => clearTimeout(t);
  }, [id, kind]);

  // Hold the page still underneath. The native dialogs froze the document while
  // they were up; without this the list behind a "Delete this section?" scrolls
  // away under the scrim on a phone, and the teacher answers a question about
  // something they can no longer see.
  useEffect(() => {
    if (!id) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [id]);

  if (!request) return null;

  const variant = VARIANTS[request.variant] || (request.kind === 'alert' ? VARIANTS.info : VARIANTS.ask);
  const { Icon } = variant;
  const title = request.title || variant.title;

  /** Escape, the scrim and Cancel all give the answer the native call gave. */
  const dismiss = () => settleDialog(request.id, request.kind === 'prompt' ? null : false);
  const accept = () => settleDialog(request.id, request.kind === 'prompt' ? draft : true);

  const onKeyDown = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); dismiss(); }
    // Enter submits everywhere except a textarea, which there isn't one of —
    // spelled out anyway so a future multi-line prompt doesn't lose its newlines.
    if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') { e.preventDefault(); accept(); }
  };

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-ink-900/50 backdrop-blur-sm"
      onMouseDown={e => { if (e.target === e.currentTarget) dismiss(); }}
      onKeyDown={onKeyDown}
      role="presentation"
    >
      {/* dvh, and only the message scrolls: a long message (a list of rows that
          failed to import) must never push the buttons under a phone's system
          bar, which is how the privacy notice became unagreeable. */}
      <div
        role={request.kind === 'alert' ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        aria-labelledby={`tg-dialog-title-${request.id}`}
        aria-describedby={`tg-dialog-body-${request.id}`}
        className="bg-white rounded-[2rem] w-full max-w-md shadow-card-lg animate-pop-in
                   flex flex-col max-h-[calc(100dvh-2rem)] overflow-hidden"
      >
        <div className="px-6 pt-6 pb-2 flex items-start gap-3.5 shrink-0">
          <div className={`w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 ${variant.ring}`}>
            <Icon className="w-6 h-6" />
          </div>
          <h2 id={`tg-dialog-title-${request.id}`} className="font-display text-lg font-extrabold text-navy-700 pt-1.5">
            {title}
          </h2>
        </div>

        <div className="px-6 pb-4 overflow-y-auto overscroll-contain min-h-0">
          {/* whitespace-pre-line because the messages these replaced were written
              for a dialog that honoured "\n" — several list their details a line
              each, and collapsing them would run the list into one paragraph. */}
          <p id={`tg-dialog-body-${request.id}`} className="text-sm text-navy-600 leading-relaxed whitespace-pre-line">{request.message}</p>

          {request.kind === 'prompt' && (
            <input
              ref={inputRef}
              type="text"
              value={draft}
              placeholder={request.placeholder || ''}
              onChange={e => setDraft(e.target.value)}
              className="tg-input mt-4"
            />
          )}
        </div>

        <div className="px-6 pb-6 pt-3 flex flex-col-reverse sm:flex-row gap-2.5 shrink-0 border-t-2 border-cream-100">
          {request.kind !== 'alert' && (
            <button type="button" onClick={dismiss} className="tg-btn-ghost flex-1">
              {request.cancelLabel || 'Cancel'}
            </button>
          )}
          <button
            ref={confirmRef}
            type="button"
            onClick={accept}
            className={`flex-1 inline-flex items-center justify-center gap-2 rounded-full px-6 py-3 font-bold text-sm
                        text-white shadow-pop transition-all duration-150 active:translate-y-1 active:shadow-none
                        ${request.danger ? 'bg-red-600 hover:bg-red-700' : 'bg-royal-500 hover:bg-royal-600'}`}
          >
            {request.confirmLabel || (request.kind === 'alert' ? 'OK' : 'Confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
