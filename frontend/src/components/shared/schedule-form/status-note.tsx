import type { StatusNote as StatusNoteData } from '@/lib/expense-pay-state';
import { cn } from '@/lib/utils';

const TONE_CLASS = {
  good: 'text-neon-green',
  warn: 'text-neon-amber',
  muted: 'text-muted-foreground',
} as const;

/** Small status line shown under an item's name in lists. */
export function StatusNote({
  note,
  className,
}: {
  note: StatusNoteData | null;
  className?: string;
}) {
  if (!note) return null;
  return (
    <span className={cn('block text-xs', TONE_CLASS[note.tone], className)}>
      {note.text}
    </span>
  );
}
