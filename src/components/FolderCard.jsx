import { ChevronUp } from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs) { return twMerge(clsx(inputs)); }

/* Tints live in ../constants/folderTints.js — see the note there on why. */

/**
 * A folder-shaped container: a small tab notch centred on the top edge, joined
 * to a generously rounded body.
 *
 * The tab is a separate absolutely-positioned block that shares the body's fill
 * and tucks a few pixels *behind* it, so the two read as a single cut shape
 * rather than a card with a hat. `pt-4` on the wrapper reserves the tab's room
 * so neighbouring cards in a grid still align on their bodies.
 */
export default function FolderCard({
  fill = 'bg-royal-200',
  as: Tag = 'div',
  showTab = true,   // a fill-less card (e.g. the dashed "add" tile) has no tab
  className,
  bodyClassName,
  children,
  ...rest
}) {
  return (
    <Tag className={cn('group relative block pt-4 h-full', className)} {...rest}>
      {showTab && (
        <span
          aria-hidden="true"
          className={cn(
            'absolute top-0 left-1/2 -translate-x-1/2 w-28 h-5 rounded-t-2xl flex items-start justify-center pt-0.5',
            fill
          )}
        >
          <ChevronUp className="w-4 h-4 text-navy-700/40" strokeWidth={3} />
        </span>
      )}

      {/* h-full so folders sharing a grid row end flush at the bottom. */}
      <div
        className={cn(
          'relative h-full rounded-[1.75rem] p-5 transition-all duration-150',
          'group-hover:-translate-y-1 group-active:translate-y-0',
          fill,
          bodyClassName
        )}
      >
        {children}
      </div>
    </Tag>
  );
}
