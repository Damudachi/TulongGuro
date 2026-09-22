import { Paperclip, FileText, Image as ImageIcon, FileType2, Download } from 'lucide-react';

function cn(...cls) { return cls.filter(Boolean).join(' '); }

/**
 * The files a teacher attached to an activity, as the class sees them.
 *
 * These were collected by Activity Builder's "Additional Materials" panel —
 * whose own copy has always said they are "for students and AI grading
 * context" — and for a long while only the second half of that was true: the
 * checker read them and no screen in the app ever rendered them. A learner
 * asked to answer questions "about the passage" had no passage, and the only
 * way to get one was to ask the teacher for it outside the app.
 *
 * The server sends `materials`: name and URL for the attachments marked
 * visible, and nothing at all for the ones kept back as marking context. So
 * there is no filtering to do here — whatever arrives is meant to be opened.
 *
 * Two skins, because the two student screens that show this were written
 * against different generations of the palette and a card that matched one
 * would read as pasted-in on the other. `variant` picks between them; the
 * markup is identical.
 */
const SKINS = {
  plain: {
    shell: 'bg-white border border-slate-200 rounded-2xl p-5 shadow-sm',
    heading: 'text-sm font-bold text-brand-slate',
    icon: 'text-brand-navy',
    note: 'text-xs text-slate-500',
    name: 'text-sm font-medium text-brand-slate',
  },
  card: {
    shell: 'tg-card p-6',
    heading: 'font-display font-extrabold text-navy-700',
    icon: 'text-royal-500',
    note: 'text-xs text-navy-500',
    name: 'text-sm font-semibold text-navy-700',
  },
};

export default function ActivityMaterials({ materials, variant = 'plain', className }) {
  if (!materials?.length) return null;
  const skin = SKINS[variant] || SKINS.plain;

  return (
    <div className={cn(skin.shell, className)}>
      <h2 className={cn(skin.heading, 'mb-1 flex items-center gap-2')}>
        <Paperclip className={cn('w-4 h-4', skin.icon)} /> Materials from your teacher
      </h2>
      <p className={cn(skin.note, 'mb-3')}>
        Open these before you start — they are part of the work.
      </p>

      <ul className="space-y-2">
        {materials.map((file, i) => {
          const Icon = iconFor(file.name);
          return (
            /* A real link, not an onClick: a phone's browser then offers to open
               or save a PDF the way it does everywhere else, and a slow school
               connection can retry it without losing the page. Opened in a new
               tab so a half-written submission on the screen behind is still
               there when the reading is closed. */
            <li key={file.url || i}>
              <a href={file.url} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-3 p-3 rounded-xl border border-slate-200 hover:border-brand-green hover:bg-green-50/40 transition-colors group">
                <span className="bg-blue-50 text-brand-navy p-2 rounded-lg shrink-0">
                  <Icon className="w-4 h-4" />
                </span>
                <span className={cn(skin.name, 'truncate flex-1 min-w-0')}>{file.name}</span>
                <Download className="w-4 h-4 text-slate-300 group-hover:text-brand-green transition-colors shrink-0" />
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** A hint at what will open, from the only thing we know about the file. */
function iconFor(name) {
  const ext = String(name || '').split('.').pop()?.toLowerCase();
  if (['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'].includes(ext)) return ImageIcon;
  if (ext === 'pdf') return FileType2;
  return FileText;
}
