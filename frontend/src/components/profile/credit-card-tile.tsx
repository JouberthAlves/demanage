import { useState } from 'react';
import { CreditCard, Pencil, RefreshCw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useUpdateCard } from '@/hooks/use-cards';
import { getApiErrorMessage } from '@/lib/api-error';
import { getCardTone } from '@/lib/card-tone';
import {
  applyCardExpiryInput,
  CARD_EXPIRY_ERROR,
  cardExpiryError,
  formatCardExpiry,
  formatCurrency,
  formatPercent,
  parseCardExpiryInput,
} from '@/lib/format';
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
  const updateCard = useUpdateCard();
  const expired = Boolean(card.expired);
  const limit = card.limit != null && card.limit > 0 ? card.limit : null;
  const percent = limit ? (committed / limit) * 100 : 0;
  const barWidth = Math.min(percent, 100);

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [renewOpen, setRenewOpen] = useState(false);
  const [expiry, setExpiry] = useState(formatCardExpiry(card.expiresAt));
  const [expiryError, setExpiryError] = useState<string | null>(null);

  async function handleRenew(event: React.FormEvent) {
    event.preventDefault();
    const parsed = parseCardExpiryInput(expiry);
    if (!parsed) {
      setExpiryError(CARD_EXPIRY_ERROR);
      toast.error(CARD_EXPIRY_ERROR);
      return;
    }

    try {
      await updateCard.mutateAsync({
        id: card.id,
        payload: { expiresAt: parsed.toISOString() },
      });
      toast.success('Cartão renovado');
      setRenewOpen(false);
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Não foi possível renovar'));
    }
  }

  return (
    <>
      <article
        className={cn(
          'group relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]',
          tone.panel,
          expired && 'opacity-75',
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
                {limit !== null
                  ? `Limite ${formatCurrency(limit)}`
                  : 'Sem limite'}
              </p>
            </div>
          </div>

          <div className='flex gap-1 opacity-80 transition-opacity group-hover:opacity-100'>
            <Button
              variant='ghost'
              size='icon-sm'
              aria-label={`Editar cartão ${card.name}`}
              onClick={onEdit}
            >
              <Pencil className='size-4' />
            </Button>
            <Button
              variant='ghost'
              size='icon-sm'
              aria-label={`Remover cartão ${card.name}`}
              disabled={deleting}
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 className='size-4' />
            </Button>
          </div>
        </div>

        {expired ? (
          <div className='relative mt-4 flex flex-col gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-3'>
            <p className='text-sm text-rose-300'>
              Cartão vencido — inutilizável até renovar.
            </p>
            <Button
              size='sm'
              variant='secondary'
              className='w-fit rounded-lg'
              onClick={() => {
                setExpiry(formatCardExpiry(card.expiresAt));
                setExpiryError(null);
                setRenewOpen(true);
              }}
            >
              <RefreshCw className='size-4' />
              Renovar
            </Button>
          </div>
        ) : null}

        <div className='relative mt-6 grid grid-cols-2 gap-3 text-sm'>
          <div className='rounded-xl border border-border/70 bg-black/20 px-3 py-2'>
            <p className='text-xs text-muted-foreground'>Fechamento</p>
            <p className='mt-0.5 font-medium'>
              {card.closingDay
                ? `Dia ${String(card.closingDay).padStart(2, '0')}`
                : '—'}
            </p>
            {card.pendingClosingDay != null ? (
              <p className='mt-1 text-xs text-muted-foreground'>
                Próximo ciclo: dia{' '}
                {String(card.pendingClosingDay).padStart(2, '0')}
              </p>
            ) : null}
          </div>
          <div className='rounded-xl border border-border/70 bg-black/20 px-3 py-2'>
            <p className='text-xs text-muted-foreground'>Validade</p>
            <p className='mt-0.5 font-medium'>
              {formatCardExpiry(card.expiresAt) || '—'}
            </p>
          </div>
        </div>

        {limit !== null ? (
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

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover cartão?</AlertDialogTitle>
            <AlertDialogDescription>
              &quot;{card.name}&quot; deixará de receber novas cobranças. As
              compras, faturas e o histórico existentes serão preservados.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              variant='destructive'
              onClick={() => {
                onDelete();
                setConfirmDelete(false);
              }}
            >
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={renewOpen} onOpenChange={setRenewOpen}>
        <DialogContent className='rounded-xl sm:max-w-sm'>
          <DialogHeader>
            <DialogTitle>Renovar cartão</DialogTitle>
            <DialogDescription>
              Informe a nova validade no formato MM/AA.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(event) => void handleRenew(event)}
            className='flex flex-col gap-4'
          >
            <div className='flex flex-col gap-2'>
              <Label htmlFor={`renew-${card.id}`}>Nova validade</Label>
              <Input
                id={`renew-${card.id}`}
                inputMode='numeric'
                value={expiry}
                onChange={(event) => {
                  setExpiry(applyCardExpiryInput(event.target.value).value);
                  setExpiryError(null);
                }}
                onBlur={() => setExpiryError(cardExpiryError(expiry))}
                aria-invalid={expiryError ? true : undefined}
                aria-describedby={
                  expiryError ? `renew-${card.id}-error` : undefined
                }
                placeholder='MM/AA'
                className='rounded-lg'
              />
              {expiryError ? (
                <p
                  id={`renew-${card.id}-error`}
                  className='text-xs text-destructive'
                >
                  {expiryError}
                </p>
              ) : null}
            </div>
            <DialogFooter>
              <Button
                type='button'
                variant='outline'
                className='rounded-lg'
                onClick={() => setRenewOpen(false)}
              >
                Cancelar
              </Button>
              <Button
                type='submit'
                className='rounded-lg'
                disabled={updateCard.isPending}
              >
                Renovar
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
