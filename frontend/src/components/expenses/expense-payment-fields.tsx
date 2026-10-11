import { FieldError } from '@/components/shared/schedule-form/field-error';
import { fieldErrorProps } from '@/components/shared/schedule-form/field-error-props';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { EXPENSE_FIELD_IDS, type PayMode } from '@/lib/expense-form';
import { formatCurrency } from '@/lib/format';

import { ExpenseSplitCardFields } from './expense-split-card-fields';
import type { ExpenseFormApi } from './use-expense-form';

const { error: ERROR_ID, card: CARD_ID } = EXPENSE_FIELD_IDS;

function PayModeSelect({ f }: { f: ExpenseFormApi }) {
  return (
    <div className='flex flex-col gap-2'>
      <Label id='expense-pay-mode-label' htmlFor='expense-pay-mode'>
        Pagamento
      </Label>
      <Select
        value={f.form.payMode}
        onValueChange={(value) => {
          if (value) f.setPayMode(value as PayMode);
        }}
      >
        <SelectTrigger
          id='expense-pay-mode'
          aria-labelledby='expense-pay-mode-label'
          className='rounded-lg'
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value='none'>PIX / dinheiro</SelectItem>
          <SelectItem value='one_card'>1 cartão</SelectItem>
          <SelectItem value='two_cards' disabled={f.validCards.length < 2}>
            2 cartões
          </SelectItem>
          <SelectItem value='card_pix' disabled={f.validCards.length < 1}>
            Cartão + PIX
          </SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

function SingleCardField({ f }: { f: ExpenseFormApi }) {
  return (
    <div className='flex flex-col gap-2'>
      <Label id='expense-card-label' htmlFor={CARD_ID}>
        Cartão
      </Label>
      <Select
        value={f.form.cardId}
        onValueChange={(cardId) => {
          if (cardId) f.patch({ cardId });
        }}
      >
        <SelectTrigger
          id={CARD_ID}
          aria-labelledby='expense-card-label'
          {...fieldErrorProps(f.error, CARD_ID, ERROR_ID)}
          className='rounded-lg'
        >
          <SelectValue placeholder='Selecione' />
        </SelectTrigger>
        <SelectContent>
          {f.validCards.map((card) => (
            <SelectItem key={card.id} value={card.id}>
              {card.name}
              {card.available != null
                ? ` · disp. ${formatCurrency(card.available)}`
                : ' · sem limite'}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <FieldError error={f.error} fieldId={CARD_ID} errorId={ERROR_ID} />
    </div>
  );
}

/** Payment mode select plus the card pickers it requires. */
export function ExpensePaymentFields({ f }: { f: ExpenseFormApi }) {
  const { payMode } = f.form;
  return (
    <div className='flex flex-col gap-3'>
      <PayModeSelect f={f} />
      {payMode === 'one_card' ? <SingleCardField f={f} /> : null}
      {payMode === 'two_cards' || payMode === 'card_pix' ? (
        <ExpenseSplitCardFields f={f} />
      ) : null}
      {f.cards.some((card) => card.expired) ? (
        <p className='text-xs text-muted-foreground'>
          Cartões vencidos não podem receber novas despesas.
        </p>
      ) : null}
    </div>
  );
}
