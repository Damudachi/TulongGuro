import { useCallback, useRef, useState } from 'react';
import { Eraser, Loader2, Undo2, X } from 'lucide-react';
import { API_URL, apiFetch } from '../config';

/**
 * Drag black boxes over a submitted photo, then burn them in.
 *
 * Students photograph their work with their name written across the top,
 * because that is what paper has always asked of them. This is the teacher's
 * way to take it back off before it goes any further.
 *
 * ── Why the boxes are sent as numbers rather than drawn here ──
 * The obvious build exports a canvas: draw the image, draw the boxes, upload
 * the result. It cannot work. The photo is served from Supabase, another
 * origin, so drawing it into a canvas taints the canvas and toBlob() throws —
 * after the teacher has already done the work of marking the page up. So this
 * only ever measures: it sends rectangles as fractions of the image, and the
 * server composites them against the real pixels at full resolution.
 *
 * Fractions, not pixels, because the boxes were dragged against whatever size
 * the photo happened to render at inside this dialog on this screen.
 */
export default function RedactTool({ submissionId, imageUrl, onClose, onRedacted }) {
  const [rects, setRects] = useState([]);
  const [drawing, setDrawing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const frameRef = useRef(null);

  // Every coordinate is measured against the rendered image box, so a box the
  // teacher drew over a word stays over that word at any zoom or screen size.
  const pointIn = useCallback((e) => {
    const box = frameRef.current?.getBoundingClientRect();
    if (!box || !box.width || !box.height) return null;
    return {
      x: Math.min(Math.max((e.clientX - box.left) / box.width, 0), 1),
      y: Math.min(Math.max((e.clientY - box.top) / box.height, 0), 1),
    };
  }, []);

  const start = (e) => {
    if (saving) return;
    const p = pointIn(e);
    if (!p) return;
    // Pointer capture, so a drag that leaves the image still finishes here
    // rather than being abandoned mid-box.
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDrawing({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
  };

  const move = (e) => {
    if (!drawing) return;
    const p = pointIn(e);
    if (!p) return;
    setDrawing((d) => ({ ...d, x1: p.x, y1: p.y }));
  };

  const end = () => {
    if (!drawing) return;
    const r = {
      x: Math.min(drawing.x0, drawing.x1),
      y: Math.min(drawing.y0, drawing.y1),
      w: Math.abs(drawing.x1 - drawing.x0),
      h: Math.abs(drawing.y1 - drawing.y0),
    };
    setDrawing(null);
    // A click with no drag is someone steadying their hand, not an instruction
    // to redact a point. The server drops these too; dropping them here keeps
    // invisible slivers out of the count the button shows.
    if (r.w > 0.005 && r.h > 0.005) setRects((prev) => [...prev, r]);
  };

  const apply = async () => {
    if (!rects.length || saving) return;
    setSaving(true);
    setError('');
    try {
      const res = await apiFetch(`${API_URL}/api/teacher/submissions/${submissionId}/redact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rects }),
      });
      const data = await res.json();
      if (!data.success) { setError(data.error || 'That did not work. Please try again.'); return; }
      onRedacted?.(data.imageUrl);
      onClose?.();
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const box = (r, i, live) => (
    <div key={live ? 'live' : i}
      className={live ? 'absolute bg-black/70 border-2 border-white/70' : 'absolute bg-black'}
      style={{
        left: `${r.x * 100}%`, top: `${r.y * 100}%`,
        width: `${r.w * 100}%`, height: `${r.h * 100}%`,
      }} />
  );

  const live = drawing && {
    x: Math.min(drawing.x0, drawing.x1),
    y: Math.min(drawing.y0, drawing.y1),
    w: Math.abs(drawing.x1 - drawing.x0),
    h: Math.abs(drawing.y1 - drawing.y0),
  };

  return (
    <div className="fixed inset-0 z-50 bg-ink-900/80 flex items-center justify-center p-3 sm:p-6">
      <div className="bg-white rounded-2xl w-full max-w-4xl max-h-full flex flex-col overflow-hidden">
        <div className="flex items-start justify-between gap-3 p-4 border-b border-slate-200">
          <div>
            <h2 className="font-bold text-slate-800 flex items-center gap-2">
              <Eraser className="w-4 h-4" /> Hide part of this photo
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Drag a box over anything that should not be visible — a name, a section, a face.
            </p>
          </div>
          <button type="button" onClick={onClose} disabled={saving}
            className="shrink-0 p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 disabled:opacity-40">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-auto bg-slate-200 p-3">
          <div ref={frameRef}
            onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerCancel={end}
            className="relative mx-auto w-fit touch-none cursor-crosshair select-none">
            {/* draggable=false: otherwise the browser's own image drag starts
                instead of a box, which on a touchpad is most attempts. */}
            <img src={imageUrl} alt="Submitted work" draggable={false}
              className="block max-w-full h-auto pointer-events-none" />
            {rects.map((r, i) => box(r, i, false))}
            {live && box(live, -1, true)}
          </div>
        </div>

        {error && <p className="px-4 pt-3 text-xs text-red-600">{error}</p>}

        <div className="p-4 border-t border-slate-200 flex flex-wrap items-center gap-2">
          <p className="text-xs text-slate-500 flex-1 min-w-[12rem]">
            {rects.length === 0
              ? 'Nothing marked yet.'
              : `${rects.length} area${rects.length === 1 ? '' : 's'} will be blacked out.`}
            {/* Said before the click, not after: this rewrites the photo every
                other screen shows, and a teacher should know that going in. */}
            {rects.length > 0 && ' This replaces the photo everyone sees.'}
          </p>
          <button type="button" onClick={() => setRects((p) => p.slice(0, -1))}
            disabled={!rects.length || saving}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 text-slate-600 text-sm font-bold hover:bg-slate-50 disabled:opacity-40">
            <Undo2 className="w-3.5 h-3.5" /> Undo
          </button>
          <button type="button" onClick={apply} disabled={!rects.length || saving}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-ink-900 text-white text-sm font-bold hover:bg-ink-800 disabled:opacity-40">
            {saving ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Hiding…</> : 'Hide these areas'}
          </button>
        </div>
      </div>
    </div>
  );
}
