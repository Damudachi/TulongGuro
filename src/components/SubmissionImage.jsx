import { useState } from 'react';
import { ImageOff } from 'lucide-react';
import { resolveUploadUrl, isEphemeralUpload } from '../utils/uploads';

function cn(...cls) { return cls.filter(Boolean).join(' '); }

/**
 * A student's uploaded work.
 *
 * Renders an explanation instead of the browser's broken-image icon when the
 * file can't be fetched — which happens when the API stored it on local disk
 * and that disk has since been recycled (no object storage configured).
 */
export default function SubmissionImage({ url, alt = 'Submitted work', className, wrapperClassName, compact = false }) {
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

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}
