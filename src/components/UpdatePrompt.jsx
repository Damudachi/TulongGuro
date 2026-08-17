import { useState, useEffect } from 'react';
import { RefreshCw } from 'lucide-react';
import { registerSW } from '../utils/registerSW';

/**
 * "A new version is ready" — shown once new code has finished downloading in
 * the background.
 *
 * Deliberately a prompt and not an automatic reload: a teacher may be halfway
 * through marking a paper, and pulling the page out from under them would
 * lose whatever is in the feedback box. They reload when they are ready.
 */
export default function UpdatePrompt() {
  // `apply` doubles as the flag: it is null until a new worker is actually
  // waiting, and holds the function that hands over to it once one is.
  const [apply, setApply] = useState(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Wrapped in an arrow because setState treats a bare function argument as
    // an updater and would call it instead of storing it.
    registerSW((fn) => setApply(() => fn));
  }, []);

  if (!apply || dismissed) return null;

  return (
    <div className="fixed bottom-24 md:bottom-4 left-1/2 -translate-x-1/2 z-50 px-4 w-full max-w-md">
      <div className="bg-brand-chrome text-white rounded-2xl shadow-card-lg px-4 py-3 flex items-center gap-3">
        <RefreshCw className="w-4 h-4 shrink-0 text-royal-200" />
        <p className="text-sm font-bold flex-1 leading-snug">
          A new version of TulongGuro is ready.
        </p>
        <button
          type="button"
          onClick={() => apply()}
          className="shrink-0 px-3 py-1.5 rounded-xl bg-white text-royal-900 text-xs font-extrabold hover:bg-cream-100 transition-colors"
        >
          Reload
        </button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss"
          className="shrink-0 px-2 py-1.5 text-white/50 text-xs font-bold hover:text-white transition-colors"
        >
          Later
        </button>
      </div>
    </div>
  );
}
