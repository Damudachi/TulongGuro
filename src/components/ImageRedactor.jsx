import { useState, useRef, useEffect, useCallback } from 'react';
import { ShieldCheck, Eraser, Check, X, RotateCcw, ZoomIn, ZoomOut } from 'lucide-react';

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
  const [img, setImg] = useState(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [startPos, setStartPos] = useState(null);
  const [rects, setRects] = useState([]);       // { x, y, w, h }[]
  const [currentRect, setCurrentRect] = useState(null);
  const [scale, setScale] = useState(1);

  // Load image, and fit it to the viewport as it arrives. The auto-fit is done
  // here in onload rather than in an effect keyed on `img` because the zoom
  // buttons own this state too — it is a starting point, not a derived value.
  useEffect(() => {
    const image = new Image();
    image.onload = () => {
      setImg(image);
      const maxW = Math.min(window.innerWidth - 48, 600);
      setScale(Math.min(maxW / image.width, 1));
    };
    image.src = imageSrc;
  }, [imageSrc]);

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

  useEffect(() => { draw(); }, [draw]);

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

  const handleStart = (e) => {
    e.preventDefault();
    const coords = getCanvasCoords(e);
    setIsDrawing(true);
    setStartPos(coords);
  };

  const handleMove = (e) => {
    if (!isDrawing || !startPos) return;
    e.preventDefault();
    const coords = getCanvasCoords(e);
    setCurrentRect({
      x: Math.min(startPos.x, coords.x),
      y: Math.min(startPos.y, coords.y),
      w: Math.abs(coords.x - startPos.x),
      h: Math.abs(coords.y - startPos.y),
    });
  };

  const handleEnd = (e) => {
    if (!isDrawing || !currentRect) {
      setIsDrawing(false);
      setStartPos(null);
      return;
    }
    e.preventDefault();
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
      <div className="flex items-center justify-center py-12">
        <div className="w-6 h-6 border-2 border-brand-green border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[110] flex flex-col bg-slate-900/80 backdrop-blur-sm">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-red-500" />
          <div>
            <h3 className="font-bold text-brand-slate text-sm">{copy.title}</h3>
            <p className="text-[10px] text-slate-400">{copy.subtitle}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setScale(s => Math.min(s + 0.15, 2))} className="p-1.5 bg-slate-100 rounded-lg hover:bg-slate-200" title="Zoom in">
            <ZoomIn className="w-4 h-4 text-slate-600" />
          </button>
          <button onClick={() => setScale(s => Math.max(s - 0.15, 0.3))} className="p-1.5 bg-slate-100 rounded-lg hover:bg-slate-200" title="Zoom out">
            <ZoomOut className="w-4 h-4 text-slate-600" />
          </button>
          <button onClick={undoLast} disabled={rects.length === 0} className="p-1.5 bg-slate-100 rounded-lg hover:bg-slate-200 disabled:opacity-30" title="Undo">
            <RotateCcw className="w-4 h-4 text-slate-600" />
          </button>
        </div>
      </div>

      {/* Canvas area */}
      <div className="flex-1 overflow-auto flex items-start justify-center p-4">
        <canvas
          ref={canvasRef}
          className="rounded-lg shadow-lg cursor-crosshair touch-none"
          onMouseDown={handleStart}
          onMouseMove={handleMove}
          onMouseUp={handleEnd}
          onMouseLeave={handleEnd}
          onTouchStart={handleStart}
          onTouchMove={handleMove}
          onTouchEnd={handleEnd}
        />
      </div>

      {/* Tip + info */}
      <div className="bg-red-50 border-t border-red-200 px-4 py-2 text-center shrink-0">
        <p className="text-xs text-red-700 font-medium">
          <Eraser className="w-3 h-3 inline mr-1" />
          {rects.length === 0
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
