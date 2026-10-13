import { CreditCard, Wallet } from 'lucide-react';

import { formatCurrency } from '@/lib/format';
import type { AuthUser } from '@/types/auth';

type ProfileSummaryProps = {
  user: AuthUser | null;
  cardCount: number;
  totalLimit: number;
  totalCommitted: number;
};

export function ProfileSummary({
  user,
  cardCount,
  totalLimit,
  totalCommitted,
}: ProfileSummaryProps) {
  return (
    <section className='relative overflow-hidden rounded-2xl border border-border bg-card/40'>
      <div className='pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,rgba(255,184,0,0.12),transparent_45%),radial-gradient(ellipse_at_bottom_right,rgba(52,211,153,0.1),transparent_40%)]' />
      <div className='relative grid gap-5 p-4 sm:grid-cols-[1.2fr_1fr] sm:items-end sm:gap-6 sm:p-6'>
        <div className='space-y-2'>
          <p className='text-sm text-muted-foreground'>Bem-vindo de volta</p>
          <h2 className='text-2xl font-semibold tracking-tight sm:text-3xl'>
            {user?.name || 'Usuário'}
          </h2>
          <p className='max-w-md text-sm text-muted-foreground'>
            {user?.notes?.trim()
              ? user.notes
              : 'Configure salário e cartões para acompanhar o mês com mais clareza.'}
          </p>
        </div>

        <div className='grid gap-3 sm:grid-cols-2'>
          <div className='rounded-xl border border-border bg-black/25 p-4'>
            <div className='flex items-center gap-2 text-muted-foreground'>
              <Wallet className='size-4 text-neon-green' />
              <span className='text-xs'>Salário mensal</span>
            </div>
            <p className='mt-2 text-xl font-semibold tracking-tight text-neon-green'>
              {formatCurrency(user?.salary ?? 0)}
            </p>
          </div>
          <div className='rounded-xl border border-border bg-black/25 p-4'>
            <div className='flex items-center gap-2 text-muted-foreground'>
              <CreditCard className='size-4 text-neon-amber' />
              <span className='text-xs'>Limite dos cartões</span>
            </div>
            <p className='mt-2 text-xl font-semibold tracking-tight text-neon-amber'>
              {totalLimit > 0 ? formatCurrency(totalLimit) : '—'}
            </p>
            <p className='mt-1 text-xs text-muted-foreground'>
              {cardCount} cartão
              {cardCount === 1 ? '' : 'ões'}
              {totalLimit > 0
                ? ` · ${formatCurrency(totalCommitted)} em uso`
                : ''}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
