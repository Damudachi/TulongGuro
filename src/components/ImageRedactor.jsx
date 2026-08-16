import { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { ShieldCheck, Eraser, Check, X, RotateCcw, ZoomIn, ZoomOut, Maximize2, Hand, Pencil } from 'lucide-react';

function cn(...cls) { return cls.filter(Boolean).join(' '); }

/**
 * ImageRedactor — A built-in PII redaction tool.
 * Lets users draw black rectangles over sensitive areas (names)
 * before the image ever leaves the browser.
 *
 * Props:
 *   imageSrc (string)   — object URL or base64 of the image
 *   onConfirm (fn)      — called with the redacted Blob when done
 *   onCancel (fn)       — called when user cancels
 *   perspective (string)— 'teacher' (default) or 'student'. Students are
 *                         redacting their own paper, so they get first-person copy.
 */
export default function ImageRedactor({ imageSrc, onConfirm, onCancel, perspective = 'teacher' }) {
  const isStudent = perspective === 'student';
  const copy = isStudent
    ? { title: 'Redact Your Name', subtitle: 'Draw a box over your name to block it out', tip: 'Draw a rectangle over your name to redact it' }
    : { title: 'Redact Student Name', subtitle: 'Draw a box over the name to block it out', tip: "Draw a rectangle over the student's name to redact it" };
  const canvasRef = useRef(null);
  const viewportRef = useRef(null);
  const [img, setImg] = useState(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [startPos, setStartPos] = useState(null);
  const [rects, setRects] = useState([]);       // { x, y, w, h }[]
  const [currentRect, setCurrentRect] = useState(null);
  const [scale, setScale] = useState(1);
  // The scale at which the whole page fits the viewport. Zoom is expressed
  // against this rather than against the image's own pixel size: a phone photo
  // fits at ~0.2, so a fixed 0.3 floor on "zoom out" was *above* the starting
  // scale — pressing zoom out made the page bigger. That is the "zoom out
  // doesn't work" bug, and it only ever showed up on a phone.
  const [fitScale, setFitScale] = useState(1);
  // Whether the current scale is still the fitted one. A resize (or a phone
  // being turned sideways) re-fits only while the user hasn't zoomed
  // themselves, so their chosen zoom is never yanked out from under them.
  const [isFitted, setIsFitted] = useState(true);
  // Touch can either draw or scroll, not both — the canvas has to swallow touch
  // events to draw at all. On a zoomed-in page that left no way to reach the
  // rest of the paper, so panning is a mode you can switch to.
  const [mode, setMode] = useState('draw');   // 'draw' | 'pan'

  /** How much room the canvas actually has, measured rather than assumed. */
  const viewportSize = () => {
    const el = viewportRef.current;
    // 32px of padding, and a floor so a first paint before layout can't fit to zero.
    if (!el) return { w: Math.max(window.innerWidth - 32, 200), h: Math.max(window.innerHeight - 220, 200) };
    return { w: Math.max(el.clientWidth - 32, 200), h: Math.max(el.clientHeight - 32, 200) };
  };

  /**
   * Everything drawn on the previous page is cleared the moment a new one
   * arrives.
   *
   * Without this, the component kept its `rects` when only `imageSrc` changed —
   * and every caller redacts a multi-page upload by swapping that one prop in
   * place rather than remounting. So a box drawn over the name on page 1 stayed
   * in state, was re-drawn over page 2 at the same coordinates, and got burned
   * into page 2 on confirm: a black bar across text nobody had asked to hide,
   * on every page after the first.
   *
   * Done while rendering (React's own "adjusting state when a prop changes"
   * pattern) rather than in an effect, so there is never a frame where the old
   * boxes are painted over the new page.
   */
  const [pageSrc, setPageSrc] = useState(imageSrc);
  if (pageSrc !== imageSrc) {
    setPageSrc(imageSrc);
    setRects([]);
    setCurrentRect(null);
    setIsDrawing(false);
    setStartPos(null);
    setImg(null);
    setIsFitted(true);
    setMode('draw');
  }

  // Load the image and fit it to the viewport.
  useEffect(() => {
    let cancelled = false;
    const image = new Image();
    image.onload = () => {
      // A page that was swapped out mid-load must not overwrite the new one.
      if (cancelled) return;
      setImg(image);
      const { w, h } = viewportSize();
      // Fit both ways. Fitting on width alone left a tall page running off the
      // bottom with the confirm button below the fold.
      const fit = Math.min(w / image.width, h / image.height, 1);
      setFitScale(fit);
      setScale(fit);
    };
    image.src = imageSrc;
    return () => { cancelled = true; };
  }, [imageSrc]);

  // Re-fit when the window changes shape — rotating a phone is the common case.
  useEffect(() => {
    if (!img) return;
    const onResize = () => {
      const { w, h } = viewportSize();
      const fit = Math.min(w / img.width, h / img.height, 1);
      setFitScale(fit);
      setScale(prev => (isFitted ? fit : prev));
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, [img, isFitted]);

  // Zoom bounds, relative to the fitted scale so they mean the same thing on a
  // phone and on a laptop: half the fitted size out, four times it in.
  const minScale = fitScale * 0.5;
  const maxScale = Math.max(fitScale * 4, 1);
  const clampScale = (s) => Math.min(Math.max(s, minScale), maxScale);
  const zoomBy = (factor) => {
    setIsFitted(false);
    setScale(s => clampScale(s * factor));
  };
  const zoomToFit = () => { setIsFitted(true); setScale(fitScale); };

  // Draw canvas
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !img) return;
    const ctx = canvas.getContext('2d');
    const displayW = img.width * scale;
    const displayH = img.height * scale;
    canvas.width = displayW;
    canvas.height = displayH;
    ctx.drawImage(img, 0, 0, displayW, displayH);
    // Draw saved redaction rectangles
    ctx.fillStyle = 'rgba(0, 0, 0, 1)';
    rects.forEach(r => ctx.fillRect(r.x * scale, r.y * scale, r.w * scale, r.h * scale));
    // Draw current (in-progress) rectangle
    if (currentRect) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
      ctx.fillRect(currentRect.x * scale, currentRect.y * scale, currentRect.w * scale, currentRect.h * scale);
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 2;
      ctx.strokeRect(currentRect.x * scale, currentRect.y * scale, currentRect.w * scale, currentRect.h * scale);
    }
  }, [img, rects, currentRect, scale]);

  // Painted before the browser paints, so the scroll adjustment below measures
  // a canvas that is already its new size.
  useLayoutEffect(() => { draw(); }, [draw]);

  /**
   * Keep the middle of the view still while zooming.
   *
   * Without it, growing the canvas pushes the page down and to the right and
   * the part being worked on slides off screen — on a phone, straight out of
   * view. Runs as a layout effect so the scroll lands in the same frame as the
   * resize rather than a visible jump after it.
   */
  const prevScaleRef = useRef(scale);
  useLayoutEffect(() => {
    const vp = viewportRef.current;
    const prev = prevScaleRef.current;
    prevScaleRef.current = scale;
    if (!vp || !prev || prev === scale) return;
    const ratio = scale / prev;
    vp.scrollLeft = (vp.scrollLeft + vp.clientWidth / 2) * ratio - vp.clientWidth / 2;
    vp.scrollTop = (vp.scrollTop + vp.clientHeight / 2) * ratio - vp.clientHeight / 2;
  }, [scale]);

  const getCanvasCoords = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return {
      x: (clientX - rect.left) / scale,
      y: (clientY - rect.top) / scale,
    };
  };

  /** Where a mouse or the first finger is, in screen coordinates. */
  const clientPoint = (e) => (e.touches?.[0]
    ? { x: e.touches[0].clientX, y: e.touches[0].clientY }
    : { x: e.clientX, y: e.clientY });
  /**
   * Stop the browser's own handling of a drag — but only for the mouse.
   *
   * React registers touchstart/touchmove passively at the root, so
   * preventDefault() there does nothing except log a warning; what actually
   * holds the touch gestures back is `touch-action: none` on the canvas and its
   * scroll container. For the mouse it still matters: without it a drag across
   * the canvas starts a native image/text drag instead of a redaction box.
   */
  const suppressNativeDrag = (e) => { if (!e.touches) e.preventDefault(); };
  const pinchDistance = (touches) => Math.hypot(
    touches[0].clientX - touches[1].clientX,
    touches[0].clientY - touches[1].clientY,
  );

  // Panning and pinching are done here rather than handed to the browser.
  //
  // Letting the browser have the gesture (touch-action: auto) is what made a
  // pinch zoom the entire app — header, buttons, the review panel behind it —
  // instead of the scan. The canvas now swallows every touch in both modes and
  // moves the scan itself: one finger drags it, two fingers scale it. Nothing
  // outside this overlay ever changes size.
  const panRef = useRef(null);      // { x, y, scrollLeft, scrollTop }
  const pinchRef = useRef(null);    // { distance, scale }
  const [isPanning, setIsPanning] = useState(false);

  const handleStart = (e) => {
    suppressNativeDrag(e);
    // Two fingers means zoom, in either mode — a teacher shouldn't have to
    // switch tools to look closer at what they are about to black out.
    if (e.touches?.length === 2) {
      pinchRef.current = { distance: pinchDistance(e.touches), scale };
      panRef.current = null;
      setIsDrawing(false);
      setCurrentRect(null);
      setStartPos(null);
      return;
    }
    if (mode === 'pan') {
      const p = clientPoint(e);
      const vp = viewportRef.current;
      panRef.current = { x: p.x, y: p.y, scrollLeft: vp?.scrollLeft || 0, scrollTop: vp?.scrollTop || 0 };
      setIsPanning(true);
      return;
    }
    const coords = getCanvasCoords(e);
    setIsDrawing(true);
    setStartPos(coords);
  };

  const handleMove = (e) => {
    if (pinchRef.current && e.touches?.length === 2) {
      const distance = pinchDistance(e.touches);
      if (pinchRef.current.distance > 0) {
        setIsFitted(false);
        setScale(clampScale(pinchRef.current.scale * (distance / pinchRef.current.distance)));
      }
      return;
    }
    if (mode === 'pan') {
      if (!panRef.current) return;
      suppressNativeDrag(e);
      const vp = viewportRef.current;
      if (!vp) return;
      const p = clientPoint(e);
      vp.scrollLeft = panRef.current.scrollLeft - (p.x - panRef.current.x);
      vp.scrollTop = panRef.current.scrollTop - (p.y - panRef.current.y);
      return;
    }
    if (!isDrawing || !startPos) return;
    suppressNativeDrag(e);
    const coords = getCanvasCoords(e);
    setCurrentRect({
      x: Math.min(startPos.x, coords.x),
      y: Math.min(startPos.y, coords.y),
      w: Math.abs(coords.x - startPos.x),
      h: Math.abs(coords.y - startPos.y),
    });
  };

  const handleEnd = (e) => {
    pinchRef.current = null;
    if (mode === 'pan') {
      panRef.current = null;
      setIsPanning(false);
      return;
    }
    if (!isDrawing || !currentRect) {
      setIsDrawing(false);
      setStartPos(null);
      return;
    }
    suppressNativeDrag(e);
    // Only save rectangles that are reasonably sized (not accidental clicks)
    if (currentRect.w > 5 && currentRect.h > 5) {
      setRects(prev => [...prev, currentRect]);
    }
    setCurrentRect(null);
    setIsDrawing(false);
    setStartPos(null);
  };

  const undoLast = () => setRects(prev => prev.slice(0, -1));

  const handleConfirm = () => {
    // Draw the final image at FULL resolution (not scaled)
    const outCanvas = document.createElement('canvas');
    outCanvas.width = img.width;
    outCanvas.height = img.height;
    const ctx = outCanvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    ctx.fillStyle = 'rgba(0, 0, 0, 1)';
    rects.forEach(r => ctx.fillRect(r.x, r.y, r.w, r.h));
    outCanvas.toBlob(blob => {
      if (blob) onConfirm(blob);
    }, 'image/jpeg', 0.92);
  };

  if (!img) {
    return (
      <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-900/80 backdrop-blur-sm">
        <div className="w-6 h-6 border-2 border-brand-green border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const zoomPercent = Math.round((scale / (fitScale || 1)) * 100);

  return (
    <div className="fixed inset-0 z-[110] flex flex-col bg-slate-900/80 backdrop-blur-sm">
      {/* Header. Wraps on a phone rather than squeezing the tool buttons off
          the edge, and every button is a fingertip target rather than a
          cursor-sized one. */}
      <div className="bg-white border-b border-slate-200 px-3 py-2.5 flex flex-wrap items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <ShieldCheck className="w-5 h-5 text-red-500 shrink-0" />
          <div className="min-w-0">
            <h3 className="font-bold text-brand-slate text-sm truncate">{copy.title}</h3>
            <p className="text-[10px] text-slate-400 truncate">{copy.subtitle}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 ml-auto">
          {/* Draw / move. On a phone the canvas has to swallow touches to draw,
              so without this a zoomed-in page could not be scrolled at all. */}
          <div className="flex rounded-lg border border-slate-200 overflow-hidden mr-1">
            <button type="button" onClick={() => setMode('draw')} title="Draw a redaction box"
              aria-pressed={mode === 'draw'}
              className={cn('p-2.5', mode === 'draw' ? 'bg-brand-navy text-white' : 'bg-white text-slate-600 hover:bg-slate-100')}>
              <Pencil className="w-4 h-4" />
            </button>
            <button type="button" onClick={() => setMode('pan')} title="Move around the page"
              aria-pressed={mode === 'pan'}
              className={cn('p-2.5 border-l border-slate-200', mode === 'pan' ? 'bg-brand-navy text-white' : 'bg-white text-slate-600 hover:bg-slate-100')}>
              <Hand className="w-4 h-4" />
            </button>
          </div>
          <button type="button" onClick={() => zoomBy(1 / 1.25)} disabled={scale <= minScale + 0.0001}
            className="p-2.5 bg-slate-100 rounded-lg hover:bg-slate-200 disabled:opacity-30" title="Zoom out">
            <ZoomOut className="w-4 h-4 text-slate-600" />
          </button>
          <button type="button" onClick={zoomToFit} title="Fit the whole page on screen"
            className="px-2.5 py-2 bg-slate-100 rounded-lg hover:bg-slate-200 text-[11px] font-bold text-slate-600 flex items-center gap-1 tabular-nums">
            <Maximize2 className="w-3.5 h-3.5" /> {zoomPercent}%
          </button>
          <button type="button" onClick={() => zoomBy(1.25)} disabled={scale >= maxScale - 0.0001}
            className="p-2.5 bg-slate-100 rounded-lg hover:bg-slate-200 disabled:opacity-30" title="Zoom in">
            <ZoomIn className="w-4 h-4 text-slate-600" />
          </button>
          <button type="button" onClick={undoLast} disabled={rects.length === 0}
            className="p-2.5 bg-slate-100 rounded-lg hover:bg-slate-200 disabled:opacity-30" title="Undo the last box">
            <RotateCcw className="w-4 h-4 text-slate-600" />
          </button>
        </div>
      </div>

      {/* Canvas area. The canvas is centred with `mx-auto` rather than by
          flex-centring the scroll container: a flex-centred child that
          overflows both sides cannot be scrolled back to its left edge, which
          is exactly the half of a zoomed-in page a name usually sits on.

          `touch-none` on the container as well as the canvas: a pinch that
          starts on the padding beside the page would otherwise be the
          browser's, and the browser zooms the whole app rather than the scan. */}
      <div ref={viewportRef} className="flex-1 overflow-auto p-4 min-h-0 touch-none overscroll-contain">
        <canvas
          ref={canvasRef}
          className={cn('rounded-lg shadow-lg block mx-auto touch-none select-none',
            mode === 'pan' ? (isPanning ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-crosshair')}
          onMouseDown={handleStart}
          onMouseMove={handleMove}
          onMouseUp={handleEnd}
          onMouseLeave={handleEnd}
          onTouchStart={handleStart}
          onTouchMove={handleMove}
          onTouchEnd={handleEnd}
          onTouchCancel={handleEnd}
        />
      </div>

      {/* Tip + info */}
      <div className="bg-red-50 border-t border-red-200 px-4 py-2 text-center shrink-0">
        <p className="text-xs text-red-700 font-medium">
          <Eraser className="w-3 h-3 inline mr-1" />
          {mode === 'pan'
            ? 'Move mode — drag the page around, or pinch to zoom it. Switch back to draw to cover a name.'
            : rects.length === 0
              ? copy.tip
              : `${rects.length} area(s) redacted. Add more or confirm below.`
          }
        </p>
      </div>

      {/* Footer buttons */}
      <div className="bg-white border-t border-slate-200 px-4 py-3 flex gap-3 shrink-0">
        <button onClick={onCancel}
          className="flex-1 py-3 border-2 border-slate-200 rounded-xl font-bold text-slate-600 hover:bg-slate-50 transition-colors flex items-center justify-center gap-2">
          <X className="w-4 h-4" /> Cancel
        </button>
        <button onClick={handleConfirm}
          className="flex-1 py-3 bg-brand-green text-white rounded-xl font-bold hover:bg-emerald-600 transition-colors shadow-lg shadow-emerald-500/20 flex items-center justify-center gap-2">
          <Check className="w-4 h-4" /> {rects.length > 0 ? 'Confirm Redaction' : isStudent ? 'Skip (My Name Is Not Shown)' : 'Skip (No Name Found)'}
        </button>
      </div>
    </div>
  );
}
