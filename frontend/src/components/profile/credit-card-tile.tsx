import { CreditCard, Pencil, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { getCardTone } from '@/lib/card-tone';
import { formatCurrency, formatPercent } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Card } from '@/types/finance';

type CreditCardTileProps = {
  card: Card;
  committed: number;
  deleting?: boolean;
  onEdit: () => void;
  onDelete: () => void;
};

export function CreditCardTile({
  card,
  committed,
  deleting = false,
  onEdit,
  onDelete,
}: CreditCardTileProps) {
  const tone = getCardTone(card);
  const hasLimit = card.limit != null && card.limit > 0;
  const percent = hasLimit ? (committed / (card.limit as number)) * 100 : 0;
  const barWidth = Math.min(percent, 100);

  return (
    <article
      className={cn(
        'group relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]',
        tone.panel,
      )}
    >
      <div
        className='pointer-events-none absolute -right-8 -top-10 size-36 rounded-full blur-2xl'
        style={{ backgroundColor: `${tone.fill}22` }}
      />

      <div className='relative flex items-start justify-between gap-3'>
        <div className='flex items-center gap-3'>
          <div
            className={cn(
              'flex size-10 items-center justify-center rounded-xl',
              tone.chip,
            )}
          >
            <CreditCard className={cn('size-5', tone.accent)} />
          </div>
          <div>
            <h3 className='text-base font-semibold tracking-tight'>
              {card.name}
            </h3>
            <p className='text-xs text-muted-foreground'>
              {hasLimit
                ? `Limite ${formatCurrency(card.limit as number)}`
                : 'Sem limite cadastrado'}
            </p>
          </div>
        </div>

        <div className='flex gap-1 opacity-80 transition-opacity group-hover:opacity-100'>
          <Button variant='ghost' size='icon-sm' onClick={onEdit}>
            <Pencil className='size-4' />
          </Button>
          <Button
            variant='ghost'
            size='icon-sm'
            disabled={deleting}
            onClick={onDelete}
          >
            <Trash2 className='size-4' />
          </Button>
        </div>
      </div>

      <div className='relative mt-6 grid grid-cols-2 gap-3 text-sm'>
        <div className='rounded-xl border border-border/70 bg-black/20 px-3 py-2'>
          <p className='text-xs text-muted-foreground'>Fechamento</p>
          <p className='mt-0.5 font-medium'>
            {card.closingDay ? `Dia ${card.closingDay}` : '—'}
          </p>
        </div>
        <div className='rounded-xl border border-border/70 bg-black/20 px-3 py-2'>
          <p className='text-xs text-muted-foreground'>Vencimento</p>
          <p className='mt-0.5 font-medium'>
            {card.dueDay ? `Dia ${card.dueDay}` : '—'}
          </p>
        </div>
      </div>

      {hasLimit ? (
        <div className='relative mt-5 space-y-2'>
          <div className='flex items-center justify-between text-xs'>
            <span className='text-muted-foreground'>Comprometido</span>
            <span className={cn('font-medium', tone.accent)}>
              {formatPercent(percent / 100)} · {formatCurrency(committed)}
            </span>
          </div>
          <div className='h-1.5 overflow-hidden rounded-full bg-white/10'>
            <div
              className='h-full rounded-full transition-all'
              style={{ width: `${barWidth}%`, backgroundColor: tone.fill }}
            />
          </div>
        </div>
      ) : null}
    </article>
  );
}
