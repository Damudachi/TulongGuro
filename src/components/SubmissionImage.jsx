import { useState } from 'react';
import { ImageOff, FileText } from 'lucide-react';
import { resolveUploadUrl, isEphemeralUpload } from '../utils/uploads';

function cn(...cls) { return cls.filter(Boolean).join(' '); }

/** Submissions are stored under their original extension, so the URL is enough
 *  to know how to display one. Query strings on signed storage URLs are ignored. */
function fileKind(url) {
  const clean = String(url || '').split('?')[0].toLowerCase();
  if (clean.endsWith('.pdf')) return 'pdf';
  if (clean.endsWith('.docx') || clean.endsWith('.doc')) return 'docx';
  return 'image';
}

/**
 * A student's uploaded work.
 *
 * Renders an explanation instead of the browser's broken-image icon when the
 * file can't be fetched — which happens when the API stored it on local disk
 * and that disk has since been recycled (no object storage configured).
 */
export default function SubmissionImage({ url, alt = 'Submitted work', className, wrapperClassName, compact = false, onImageLoad }) {
  const [failed, setFailed] = useState(false);
  const src = resolveUploadUrl(url);

  if (!src || failed) {
    const message = src ? "This photo isn't available" : 'No photo uploaded';
    // Thumbnail slots have no room for the explanation — the icon plus a title
    // attribute is all that fits, and the full copy is on the detail view.
    if (compact) {
      return (
        <div title={message}
          className={cn('w-full h-full flex items-center justify-center bg-slate-50 text-slate-400', wrapperClassName)}>
          <ImageOff className="w-5 h-5 opacity-60" />
          <span className="sr-only">{message}</span>
        </div>
      );
    }
    return (
      <div className={cn('flex flex-col items-center justify-center text-center gap-2 p-6 bg-slate-50 text-slate-400 min-h-[160px]', wrapperClassName)}>
        <ImageOff className="w-8 h-8 opacity-50" />
        <p className="text-sm font-semibold text-slate-500">{message}</p>
        {src && isEphemeralUpload(url) && (
          <p className="text-xs max-w-xs leading-relaxed">
            It was saved to the server's temporary disk and has since been cleared.
            Ask your teacher to re-upload it.
          </p>
        )}
      </div>
    );
  }

  // Work handed in as a file rather than photographed. An <img> cannot render
  // either, so a PDF gets an inline viewer and a Word file gets a download —
  // browsers have no built-in .docx renderer, and offering a broken preview is
  // worse than offering the file itself.
  const kind = fileKind(url);
  if (kind !== 'image') {
    if (compact) {
      return (
        <div title={kind === 'pdf' ? 'PDF submission' : 'Word submission'}
          className={cn('w-full h-full flex flex-col items-center justify-center gap-1 bg-slate-50 text-slate-500', wrapperClassName)}>
          <FileText className="w-5 h-5" />
          <span className="text-[9px] font-bold uppercase tracking-wide">{kind}</span>
        </div>
      );
    }
    if (kind === 'pdf') {
      return (
        <object data={src} type="application/pdf" className={cn('w-full h-full min-h-[400px]', className)} aria-label={alt}>
          <div className="flex flex-col items-center justify-center gap-3 p-6 text-center bg-slate-50 h-full">
            <FileText className="w-8 h-8 text-slate-400" />
            <p className="text-sm text-slate-500">This browser can&apos;t show the PDF inline.</p>
            <a href={src} target="_blank" rel="noreferrer"
              className="text-xs font-bold bg-brand-navy text-white px-4 py-2 rounded-lg hover:bg-blue-900">
              Open the PDF
            </a>
          </div>
        </object>
      );
    }
    return (
      <div className={cn('flex flex-col items-center justify-center gap-3 p-6 text-center bg-slate-50 h-full min-h-[200px]', wrapperClassName)}>
        <FileText className="w-8 h-8 text-slate-400" />
        <p className="text-sm font-semibold text-slate-600">Word document</p>
        <p className="text-xs text-slate-500 max-w-xs">The AI read the text inside it. Open the file to see the pupil&apos;s original formatting.</p>
        <a href={src} target="_blank" rel="noreferrer"
          className="text-xs font-bold bg-brand-navy text-white px-4 py-2 rounded-lg hover:bg-blue-900">
          Open the document
        </a>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      loading="lazy"
      onError={() => setFailed(true)}
      // The natural size, for callers that need to know the shape of what
      // arrived — a stitched multi-page scan is only recognisable by how tall
      // it is relative to its width.
      onLoad={onImageLoad ? (e) => onImageLoad({
        naturalWidth: e.currentTarget.naturalWidth,
        naturalHeight: e.currentTarget.naturalHeight,
      }) : undefined}
    />
  );
}
