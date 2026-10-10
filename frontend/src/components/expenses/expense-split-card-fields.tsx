import { FieldError } from '@/components/shared/schedule-form/field-error';
import { fieldErrorProps } from '@/components/shared/schedule-form/field-error-props';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  checkCardLimit,
  EXPENSE_FIELD_IDS,
  NO_CARD,
} from '@/lib/expense-form';
import { formatCurrency } from '@/lib/format';
import type { Card } from '@/types/finance';

import type { ExpenseFormApi } from './use-expense-form';

const {
  error: ERROR_ID,
  card1: CARD1_ID,
  card2: CARD2_ID,
  percent: PERCENT_ID,
} = EXPENSE_FIELD_IDS;

function CardPicker({
  f,
  id,
  label,
  value,
  cards,
  onChange,
}: {
  f: ExpenseFormApi;
  id: string;
  label: string;
  value: string;
  cards: Card[];
  onChange: (cardId: string) => void;
}) {
  return (
    <div className='flex flex-col gap-2'>
      <Label id={`${id}-label`} htmlFor={id}>
        {label}
      </Label>
      <Select
        value={value}
        onValueChange={(cardId) => {
          if (cardId) onChange(cardId);
        }}
      >
        <SelectTrigger
          id={id}
          aria-labelledby={`${id}-label`}
          {...fieldErrorProps(f.error, id, ERROR_ID)}
          className='rounded-lg'
        >
          <SelectValue placeholder='Selecione' />
        </SelectTrigger>
        <SelectContent>
          {cards.map((card) => (
            <SelectItem key={card.id} value={card.id}>
              {card.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <FieldError error={f.error} fieldId={id} errorId={ERROR_ID} />
    </div>
  );
}

function CardLimitHint({
  f,
  cardId,
  share,
}: {
  f: ExpenseFormApi;
  cardId: string;
  share: number;
}) {
  if (cardId === NO_CARD) return null;
  const check = checkCardLimit(
    f.cards.find((card) => card.id === cardId),
    share,
    f.committedByCard,
  );
  if (!check) return null;
  if (check.available == null) {
    return (
      <p className='text-xs text-muted-foreground'>
        {check.card.name}: sem limite
      </p>
    );
  }
  return (
    <p
      className={
        check.exceeded
          ? 'text-xs text-rose-400'
          : 'text-xs text-muted-foreground'
      }
    >
      {check.card.name}: disponível {formatCurrency(check.available)}
      {check.exceeded ? ' — insuficiente para esta parte' : ''}
    </p>
  );
}

/** Two cards, or one card plus PIX, split by percentage. */
export function ExpenseSplitCardFields({ f }: { f: ExpenseFormApi }) {
  const { form, shares } = f;
  const twoCards = form.payMode === 'two_cards';

  return (
    <div className='space-y-3 rounded-xl border border-border bg-black/20 p-3'>
      <div className='grid gap-3 sm:grid-cols-2'>
        <CardPicker
          f={f}
          id={CARD1_ID}
          label='Cartão 1'
          value={form.cardId}
          cards={f.validCards}
          onChange={(cardId) =>
            f.patch({
              cardId,
              cardId2: form.cardId2 === cardId ? NO_CARD : form.cardId2,
            })
          }
        />
        {twoCards ? (
          <CardPicker
            f={f}
            id={CARD2_ID}
            label='Cartão 2'
            value={form.cardId2}
            cards={f.validCards.filter((card) => card.id !== form.cardId)}
            onChange={(cardId2) => f.patch({ cardId2 })}
          />
        ) : (
          <div className='flex flex-col justify-end gap-1 rounded-lg border border-border/70 bg-black/25 px-3 py-2'>
            <p className='text-xs text-muted-foreground'>PIX</p>
            <p className='text-sm font-medium'>
              {shares.percent2}% · {formatCurrency(shares.share2)}
            </p>
          </div>
        )}
      </div>

      <div className='flex flex-col gap-2'>
        <Label htmlFor={PERCENT_ID}>% no cartão 1</Label>
        <Input
          id={PERCENT_ID}
          {...fieldErrorProps(f.error, PERCENT_ID, ERROR_ID)}
          inputMode='numeric'
          value={form.cardPercent}
          onChange={(event) =>
            f.patch({
              cardPercent: event.target.value.replace(/\D/g, '').slice(0, 2),
            })
          }
          className='rounded-lg'
        />
        <FieldError error={f.error} fieldId={PERCENT_ID} errorId={ERROR_ID} />
        <p className='text-xs text-muted-foreground'>
          Cartão 1: {shares.percent1 ?? 0}% · {formatCurrency(shares.share1)}
          {' · '}
          {twoCards ? 'Cartão 2' : 'PIX'}: {shares.percent2}% ·{' '}
          {formatCurrency(shares.share2)}
        </p>
      </div>

      <CardLimitHint f={f} cardId={form.cardId} share={shares.share1} />
      {twoCards ? (
        <CardLimitHint f={f} cardId={form.cardId2} share={shares.share2} />
      ) : null}
    </div>
  );
}
