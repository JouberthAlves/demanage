import { isAxiosError } from 'axios';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { CustomTagFormDialog } from '@/components/shared/custom-tag-form-dialog';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { CurrencyInput } from '@/components/ui/currency-input';
import { DatePicker } from '@/components/ui/date-picker';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import {
  BUILTIN_EXPENSE_CATEGORY_LABELS,
  EXPENSE_FREQUENCY_LABELS,
  MONTH_OPTIONS,
} from '@/data/labels';
import { useCustomTags } from '@/hooks/use-custom-tags';
import { useCreateExpense, useUpdateExpense } from '@/hooks/use-expenses';
import {
  buildScheduleStartsAt,
  formatStartsAtPreview,
} from '@/lib/expense-schedule';
import { availableCardLimit, buildCommittedByCard } from '@/lib/expense-splits';
import type { ExpensePayload } from '@/lib/expenses-api';
import {
  formatBrlInputValue,
  formatCurrency,
  maskClosingDayInput,
  normalizeClosingDayInput,
  parseCurrencyInput,
} from '@/lib/format';
import { useFinanceStore } from '@/stores/finance-store';
import type {
  ExpenseCategory,
  ExpenseFrequency,
  RecurringExpense,
} from '@/types/finance';

type ExpenseFormDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  expense: RecurringExpense | null;
};

type PayMode = 'none' | 'one_card' | 'two_cards' | 'card_pix';

type FormState = {
  name: string;
  amount: string;
  categoryKey: string;
  frequency: ExpenseFrequency;
  payMode: PayMode;
  cardId: string;
  cardId2: string;
  cardPercent: string;
  dueDay: string;
  dueMonth: string;
  occurredAt: string;
  endsAt: string;
  notes: string;
};

const NEW_TYPE_VALUE = '__new_type__';

function currentMonthValue() {
  return String(new Date().getMonth() + 1);
}

function currentDateValue() {
  const today = new Date();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${today.getFullYear()}-${month}-${day}`;
}

const emptyForm: FormState = {
  name: '',
  amount: '',
  categoryKey: 'assinatura',
  frequency: 'mensal',
  payMode: 'none',
  cardId: 'none',
  cardId2: 'none',
  cardPercent: '70',
  dueDay: '05',
  dueMonth: currentMonthValue(),
  occurredAt: currentDateValue(),
  endsAt: '',
  notes: '',
};

function categoryKeyFromExpense(expense: RecurringExpense) {
  if (expense.customTagId) return `tag:${expense.customTagId}`;
  return expense.category;
}

function payModeFromExpense(expense: RecurringExpense): PayMode {
  const splits = expense.splits ?? [];
  const cardSplits = splits.filter((split) => split.kind === 'card');
  const pixSplits = splits.filter((split) => split.kind === 'pix');
  if (cardSplits.length === 2) return 'two_cards';
  if (cardSplits.length === 1 && pixSplits.length === 1) return 'card_pix';
  if (cardSplits.length === 1 || expense.cardId) return 'one_card';
  return 'none';
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

export function ExpenseFormDialog({
  open,
  onOpenChange,
  expense,
}: ExpenseFormDialogProps) {
  const cards = useFinanceStore((state) => state.profile.cards);
  const expenses = useFinanceStore((state) => state.expenses);
  const { data: customTags = [] } = useCustomTags('expense');
  const createExpense = useCreateExpense();
  const updateExpense = useUpdateExpense();
  const [form, setForm] = useState<FormState>(emptyForm);
  const [tagDialogOpen, setTagDialogOpen] = useState(false);
  const [categorySelectKey, setCategorySelectKey] = useState(0);
  const [validationError, setValidationError] = useState<{
    fieldId: string;
    message: string;
  } | null>(null);
  const submitting = createExpense.isPending || updateExpense.isPending;
  const isUnique = form.frequency === 'unica';
  const isRecurring =
    form.frequency === 'mensal' || form.frequency === 'semanal';
  const validCards = cards.filter((card) => !card.expired);
  const committedByCard = buildCommittedByCard(
    expenses.filter((item) => item.id !== expense?.id),
    cards,
  );
  const amountValue = parseCurrencyInput(form.amount);
  const percent1 = Math.min(99, Math.max(1, Number(form.cardPercent) || 0));
  const percent2 = roundMoney(100 - percent1);
  const share1 = roundMoney((amountValue * percent1) / 100);
  const share2 = roundMoney(amountValue - share1);

  function validationMessageFor(fieldId: string) {
    if (validationError?.fieldId !== fieldId) return null;

    return (
      <p
        id='expense-form-error'
        role='alert'
        className='text-sm text-destructive'
      >
        {validationError.message}
      </p>
    );
  }

  const limitBlocked = (() => {
    const shares: Array<{ cardId: string; amount: number }> = [];
    if (form.payMode === 'one_card' && form.cardId !== 'none') {
      shares.push({ cardId: form.cardId, amount: amountValue });
    } else if (form.payMode === 'two_cards') {
      if (form.cardId !== 'none') {
        shares.push({ cardId: form.cardId, amount: share1 });
      }
      if (form.cardId2 !== 'none') {
        shares.push({ cardId: form.cardId2, amount: share2 });
      }
    } else if (form.payMode === 'card_pix' && form.cardId !== 'none') {
      shares.push({ cardId: form.cardId, amount: share1 });
    }

    return shares.some((share) => {
      const card = cards.find((item) => item.id === share.cardId);
      if (!card || card.limit == null) return false;
      const available = availableCardLimit({
        limit: card.limit,
        committed: committedByCard.get(card.id) ?? 0,
      });
      return available != null && share.amount > available + 0.001;
    });
  })();

  useEffect(() => {
    if (!open) return;
    setValidationError(null);

    if (expense) {
      const startsMonth = expense.startsAt
        ? String(Number(expense.startsAt.slice(5, 7)))
        : currentMonthValue();
      const mode = payModeFromExpense(expense);
      const splits = expense.splits ?? [];
      const cardSplits = splits.filter((split) => split.kind === 'card');
      const firstCard = cardSplits[0]?.cardId ?? expense.cardId ?? 'none';
      const secondCard = cardSplits[1]?.cardId ?? 'none';
      const firstPercent =
        mode === 'two_cards' || mode === 'card_pix'
          ? String(Math.round(Number(cardSplits[0]?.percent ?? 70)))
          : '70';

      setForm({
        name: expense.name,
        amount: formatBrlInputValue(expense.amount),
        categoryKey: categoryKeyFromExpense(expense),
        frequency: expense.frequency,
        payMode: mode,
        cardId: firstCard,
        cardId2: secondCard,
        cardPercent: firstPercent,
        dueDay: expense.dueDay ? String(expense.dueDay).padStart(2, '0') : '05',
        dueMonth: startsMonth,
        occurredAt: expense.occurredAt?.slice(0, 10) ?? currentDateValue(),
        endsAt: expense.endsAt ?? '',
        notes: expense.notes ?? '',
      });
      return;
    }

    setForm({ ...emptyForm, dueMonth: currentMonthValue() });
  }, [expense, open]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setValidationError(null);

    function rejectValidation(message: string, fieldId: string) {
      setValidationError({ fieldId, message });
      toast.error(message);
      document.getElementById(fieldId)?.focus();
    }

    const amount = parseCurrencyInput(form.amount);
    if (!form.name.trim()) {
      rejectValidation('Informe o nome da despesa', 'expense-name');
      return;
    }
    if (amount <= 0) {
      rejectValidation('Informe um valor válido', 'expense-amount');
      return;
    }

    const isCustom = form.categoryKey.startsWith('tag:');
    const customTagId = isCustom ? form.categoryKey.slice(4) : null;
    const category: ExpenseCategory = isCustom
      ? 'outro'
      : (form.categoryKey as ExpenseCategory);

    let dueDay: number | null = null;
    let startsAt: string | null = null;
    if (isRecurring) {
      const normalized = normalizeClosingDayInput(form.dueDay);
      dueDay = normalized ? Number(normalized) : NaN;
      const dueMonth = Number(form.dueMonth);
      if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) {
        rejectValidation(
          'Informe o dia em que será descontado (01-31)',
          'expense-due',
        );
        return;
      }
      if (!Number.isInteger(dueMonth) || dueMonth < 1 || dueMonth > 12) {
        rejectValidation(
          'Informe o mês em que será descontado',
          'expense-due-month',
        );
        return;
      }
      startsAt = buildScheduleStartsAt(dueDay, dueMonth);
      if (form.endsAt && form.endsAt < startsAt) {
        rejectValidation(
          'Data de término deve ser após o primeiro desconto',
          'expense-ends-at',
        );
        return;
      }
    }

    if (isUnique && !/^\d{4}-\d{2}-\d{2}$/.test(form.occurredAt)) {
      rejectValidation('Informe a data da despesa', 'expense-occurred-at');
      return;
    }

    let cardId: string | null = null;
    let splits: NonNullable<ExpensePayload['splits']>;

    if (form.payMode === 'one_card') {
      if (form.cardId === 'none') {
        rejectValidation('Selecione um cartão', 'expense-card');
        return;
      }
      cardId = form.cardId;
      splits = [{ kind: 'card', cardId: form.cardId, percent: 100 }];
    } else if (form.payMode === 'two_cards') {
      if (form.cardId === 'none' || form.cardId2 === 'none') {
        rejectValidation(
          'Selecione os dois cartões',
          form.cardId === 'none' ? 'expense-card-1' : 'expense-card-2',
        );
        return;
      }
      if (form.cardId === form.cardId2) {
        rejectValidation('Escolha dois cartões diferentes', 'expense-card-2');
        return;
      }
      if (percent1 < 1 || percent1 > 99) {
        rejectValidation(
          'Informe um percentual entre 1 e 99',
          'expense-card-percent',
        );
        return;
      }
      splits = [
        { kind: 'card', cardId: form.cardId, percent: percent1 },
        { kind: 'card', cardId: form.cardId2, percent: percent2 },
      ];
    } else if (form.payMode === 'card_pix') {
      if (form.cardId === 'none') {
        rejectValidation('Selecione o cartão', 'expense-card-1');
        return;
      }
      if (percent1 < 1 || percent1 > 99) {
        rejectValidation(
          'Informe um percentual entre 1 e 99',
          'expense-card-percent',
        );
        return;
      }
      splits = [
        { kind: 'card', cardId: form.cardId, percent: percent1 },
        { kind: 'pix', percent: percent2 },
      ];
    } else {
      splits = [];
      cardId = null;
    }

    const cardShares: Array<{ cardId: string; amount: number }> = [];
    if (form.payMode === 'one_card' && form.cardId !== 'none') {
      cardShares.push({ cardId: form.cardId, amount });
    }
    if (form.payMode === 'two_cards') {
      cardShares.push(
        { cardId: form.cardId, amount: share1 },
        { cardId: form.cardId2, amount: share2 },
      );
    }
    if (form.payMode === 'card_pix' && form.cardId !== 'none') {
      cardShares.push({ cardId: form.cardId, amount: share1 });
    }

    for (const share of cardShares) {
      const card = cards.find((item) => item.id === share.cardId);
      if (!card || card.limit == null) continue;
      const available = availableCardLimit({
        limit: card.limit,
        committed: committedByCard.get(card.id) ?? 0,
      });
      if (available != null && share.amount > available + 0.001) {
        rejectValidation(
          `Limite insuficiente no cartão ${card.name} (disponível ${formatCurrency(available)})`,
          form.payMode === 'one_card' ? 'expense-card' : 'expense-card-1',
        );
        return;
      }
    }

    const payload: ExpensePayload = {
      name: form.name.trim().slice(0, 100),
      amount,
      category,
      frequency: form.frequency,
      date: isUnique ? form.occurredAt : undefined,
      cardId,
      dueDay,
      startsAt,
      endsAt: isRecurring ? form.endsAt || null : null,
      notes: form.notes.trim().slice(0, 500) || null,
      customTagId,
      splits,
    };

    try {
      if (expense) {
        await updateExpense.mutateAsync({ id: expense.id, payload });
        toast.success('Despesa atualizada');
      } else {
        await createExpense.mutateAsync(payload);
        toast.success('Despesa cadastrada');
      }
      onOpenChange(false);
    } catch (err) {
      const message = isAxiosError(err)
        ? (err.response?.data?.error ?? 'Não foi possível salvar a despesa')
        : 'Não foi possível salvar a despesa';
      toast.error(message);
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className='max-h-[min(90dvh,720px)] overflow-x-hidden overflow-y-auto rounded-xl sm:max-w-md'>
          <DialogHeader>
            <DialogTitle>
              {expense ? 'Editar despesa' : 'Nova despesa'}
            </DialogTitle>
            <DialogDescription>
              Cadastre assinaturas, parcelas e outras despesas.
            </DialogDescription>
          </DialogHeader>

          <form
            onSubmit={(event) => void handleSubmit(event)}
            onChangeCapture={() => setValidationError(null)}
            className='flex min-w-0 flex-col gap-4'
          >
            <div className='flex min-w-0 flex-col gap-2'>
              <Label htmlFor='expense-name'>Nome</Label>
              <Input
                id='expense-name'
                aria-invalid={validationError?.fieldId === 'expense-name'}
                aria-describedby={
                  validationError?.fieldId === 'expense-name'
                    ? 'expense-form-error'
                    : undefined
                }
                value={form.name}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
                placeholder='Ex: Netflix'
                maxLength={100}
                className='min-w-0 rounded-lg'
              />
              {validationMessageFor('expense-name')}
            </div>

            <div className='flex flex-col gap-2'>
              <Label htmlFor='expense-amount'>Valor</Label>
              <CurrencyInput
                id='expense-amount'
                aria-invalid={validationError?.fieldId === 'expense-amount'}
                aria-describedby={
                  validationError?.fieldId === 'expense-amount'
                    ? 'expense-form-error'
                    : undefined
                }
                value={form.amount}
                onValueChange={(amount) =>
                  setForm((current) => ({ ...current, amount }))
                }
                className='rounded-lg'
              />
              {validationMessageFor('expense-amount')}
            </div>

            <div className='grid grid-cols-2 gap-3'>
              <div className='flex flex-col gap-2'>
                <Label id='expense-category-label' htmlFor='expense-category'>
                  Categoria
                </Label>
                <Select
                  key={categorySelectKey}
                  value={form.categoryKey}
                  onValueChange={(value) => {
                    setValidationError(null);
                    if (!value) return;
                    if (value === NEW_TYPE_VALUE) {
                      setCategorySelectKey((current) => current + 1);
                      setTagDialogOpen(true);
                      return;
                    }
                    setForm((current) => ({
                      ...current,
                      categoryKey: value,
                    }));
                  }}
                >
                  <SelectTrigger
                    id='expense-category'
                    aria-labelledby='expense-category-label'
                    className='rounded-lg'
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(BUILTIN_EXPENSE_CATEGORY_LABELS).map(
                      ([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ),
                    )}
                    {customTags.map((tag) => (
                      <SelectItem key={tag.id} value={`tag:${tag.id}`}>
                        <span className='inline-flex items-center gap-2'>
                          <span
                            className='size-2.5 rounded-full'
                            style={{ backgroundColor: tag.color }}
                          />
                          {tag.name}
                        </span>
                      </SelectItem>
                    ))}
                    <SelectItem value={NEW_TYPE_VALUE}>Outro…</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className='flex flex-col gap-2'>
                <Label id='expense-frequency-label' htmlFor='expense-frequency'>
                  Frequência
                </Label>
                <Select
                  value={form.frequency}
                  onValueChange={(value) => {
                    setValidationError(null);
                    if (!value) return;
                    setForm((current) => ({
                      ...current,
                      frequency: value as ExpenseFrequency,
                      dueDay: value === 'unica' ? '' : current.dueDay || '05',
                      dueMonth:
                        value === 'unica'
                          ? current.dueMonth
                          : current.dueMonth || currentMonthValue(),
                      endsAt: value === 'unica' ? '' : current.endsAt,
                    }));
                  }}
                >
                  <SelectTrigger
                    id='expense-frequency'
                    aria-labelledby='expense-frequency-label'
                    className='rounded-lg'
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(EXPENSE_FREQUENCY_LABELS).map(
                      ([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ),
                    )}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {isRecurring ? (
              <>
                <div className='flex flex-col gap-2'>
                  <p className='text-sm font-medium'>Quando será descontado</p>
                  <div className='grid grid-cols-2 gap-3'>
                    <div className='flex flex-col gap-1.5'>
                      <Label
                        htmlFor='expense-due'
                        className='text-xs text-muted-foreground'
                      >
                        Dia
                      </Label>
                      <Input
                        id='expense-due'
                        aria-invalid={
                          validationError?.fieldId === 'expense-due'
                        }
                        aria-describedby={
                          validationError?.fieldId === 'expense-due'
                            ? 'expense-form-error'
                            : undefined
                        }
                        inputMode='numeric'
                        maxLength={2}
                        value={form.dueDay}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            dueDay: maskClosingDayInput(event.target.value),
                          }))
                        }
                        onBlur={() =>
                          setForm((current) => ({
                            ...current,
                            dueDay: normalizeClosingDayInput(current.dueDay),
                          }))
                        }
                        placeholder='05'
                        className='rounded-lg'
                      />
                      {validationMessageFor('expense-due')}
                    </div>
                    <div className='flex flex-col gap-1.5'>
                      <Label
                        id='expense-due-month-label'
                        htmlFor='expense-due-month'
                        className='text-xs text-muted-foreground'
                      >
                        Mês
                      </Label>
                      <Select
                        value={form.dueMonth}
                        onValueChange={(value) => {
                          setValidationError(null);
                          if (value) {
                            setForm((current) => ({
                              ...current,
                              dueMonth: value,
                            }));
                          }
                        }}
                      >
                        <SelectTrigger
                          id='expense-due-month'
                          aria-labelledby='expense-due-month-label'
                          aria-invalid={
                            validationError?.fieldId === 'expense-due-month'
                          }
                          aria-describedby={
                            validationError?.fieldId === 'expense-due-month'
                              ? 'expense-form-error'
                              : undefined
                          }
                          className='rounded-lg'
                        >
                          <SelectValue placeholder='Mês' />
                        </SelectTrigger>
                        <SelectContent>
                          {MONTH_OPTIONS.map((month) => (
                            <SelectItem
                              key={month.value}
                              value={String(month.value)}
                            >
                              {month.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {validationMessageFor('expense-due-month')}
                    </div>
                  </div>
                  {(() => {
                    const day = Number(
                      normalizeClosingDayInput(form.dueDay) || form.dueDay,
                    );
                    const month = Number(form.dueMonth);
                    if (
                      !Number.isInteger(day) ||
                      day < 1 ||
                      day > 31 ||
                      !Number.isInteger(month)
                    ) {
                      return (
                        <p className='text-xs text-muted-foreground'>
                          Escolha o dia e o mês do primeiro desconto.
                        </p>
                      );
                    }
                    const preview = formatStartsAtPreview(
                      buildScheduleStartsAt(day, month),
                    );
                    return (
                      <p className='text-xs text-muted-foreground'>
                        Primeiro desconto em{' '}
                        <span className='text-foreground'>{preview}</span>
                        {form.frequency === 'semanal'
                          ? ' · semanal equivale a ~4× no mês.'
                          : ', depois repete todo mês.'}
                      </p>
                    );
                  })()}
                </div>
                <div className='flex flex-col gap-2'>
                  <Label htmlFor='expense-ends-at'>Data de término</Label>
                  <DatePicker
                    id='expense-ends-at'
                    value={form.endsAt}
                    onValueChange={(endsAt) => {
                      setValidationError(null);
                      setForm((current) => ({ ...current, endsAt }));
                    }}
                    placeholder='Sem data de término'
                    allowClear
                    ariaInvalid={
                      validationError?.fieldId === 'expense-ends-at'
                    }
                    ariaDescribedBy={
                      validationError?.fieldId === 'expense-ends-at'
                        ? 'expense-form-error'
                        : undefined
                    }
                  />
                  {validationMessageFor('expense-ends-at')}
                  <p className='text-xs text-muted-foreground'>
                    Opcional. Vazio = sem fim.
                  </p>
                </div>
              </>
            ) : null}

            {isUnique ? (
              <div className='flex flex-col gap-2'>
                <Label htmlFor='expense-occurred-at'>Data da despesa</Label>
                <DatePicker
                  id='expense-occurred-at'
                  value={form.occurredAt}
                  onValueChange={(occurredAt) => {
                    setValidationError(null);
                    setForm((current) => ({ ...current, occurredAt }));
                  }}
                  max={currentDateValue()}
                  ariaInvalid={
                    validationError?.fieldId === 'expense-occurred-at'
                  }
                  ariaDescribedBy={
                    validationError?.fieldId === 'expense-occurred-at'
                      ? 'expense-form-error'
                      : undefined
                  }
                />
                {validationMessageFor('expense-occurred-at')}
                <p className='text-xs text-muted-foreground'>
                  Use o dia em que o gasto aconteceu.
                </p>
              </div>
            ) : null}

            {isUnique ? (
              <p className='text-xs text-muted-foreground'>
                Despesa única usa a data de hoje e não tem vencimento.
              </p>
            ) : null}

            <div className='flex flex-col gap-3'>
              <div className='flex flex-col gap-2'>
                <Label id='expense-pay-mode-label' htmlFor='expense-pay-mode'>
                  Pagamento
                </Label>
                <Select
                  value={form.payMode}
                  onValueChange={(value) => {
                    setValidationError(null);
                    if (!value) return;
                    setForm((current) => ({
                      ...current,
                      payMode: value as PayMode,
                      cardId:
                        value === 'none'
                          ? 'none'
                          : current.cardId === 'none' && validCards[0]
                            ? validCards[0].id
                            : current.cardId,
                      cardId2:
                        value === 'two_cards'
                          ? current.cardId2 === 'none' ||
                            current.cardId2 === current.cardId
                            ? (validCards.find(
                                (card) =>
                                  card.id !==
                                  (current.cardId === 'none'
                                    ? validCards[0]?.id
                                    : current.cardId),
                              )?.id ?? 'none')
                            : current.cardId2
                          : 'none',
                    }));
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
                    <SelectItem
                      value='two_cards'
                      disabled={validCards.length < 2}
                    >
                      2 cartões
                    </SelectItem>
                    <SelectItem
                      value='card_pix'
                      disabled={validCards.length < 1}
                    >
                      Cartão + PIX
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {form.payMode === 'one_card' ? (
                <div className='flex flex-col gap-2'>
                  <Label id='expense-card-label' htmlFor='expense-card'>
                    Cartão
                  </Label>
                  <Select
                    value={form.cardId}
                    onValueChange={(value) => {
                      setValidationError(null);
                      if (value) {
                        setForm((current) => ({ ...current, cardId: value }));
                      }
                    }}
                  >
                    <SelectTrigger
                      id='expense-card'
                      aria-labelledby='expense-card-label'
                      aria-invalid={validationError?.fieldId === 'expense-card'}
                      aria-describedby={
                        validationError?.fieldId === 'expense-card'
                          ? 'expense-form-error'
                          : undefined
                      }
                      className='rounded-lg'
                    >
                      <SelectValue placeholder='Selecione' />
                    </SelectTrigger>
                    <SelectContent>
                      {validCards.map((card) => {
                        const available = availableCardLimit({
                          limit: card.limit,
                          committed: committedByCard.get(card.id) ?? 0,
                        });
                        return (
                          <SelectItem key={card.id} value={card.id}>
                            {card.name}
                            {available != null
                              ? ` · disp. ${formatCurrency(available)}`
                              : ' · sem limite'}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                  {validationMessageFor('expense-card')}
                </div>
              ) : null}

              {form.payMode === 'two_cards' || form.payMode === 'card_pix' ? (
                <div className='space-y-3 rounded-xl border border-border bg-black/20 p-3'>
                  <div className='grid gap-3 sm:grid-cols-2'>
                    <div className='flex flex-col gap-2'>
                      <Label id='expense-card-1-label' htmlFor='expense-card-1'>
                        Cartão 1
                      </Label>
                      <Select
                        value={form.cardId}
                        onValueChange={(value) => {
                          setValidationError(null);
                          if (value) {
                            setForm((current) => ({
                              ...current,
                              cardId: value,
                              cardId2:
                                current.cardId2 === value
                                  ? 'none'
                                  : current.cardId2,
                            }));
                          }
                        }}
                      >
                        <SelectTrigger
                          id='expense-card-1'
                          aria-labelledby='expense-card-1-label'
                          aria-invalid={
                            validationError?.fieldId === 'expense-card-1'
                          }
                          aria-describedby={
                            validationError?.fieldId === 'expense-card-1'
                              ? 'expense-form-error'
                              : undefined
                          }
                          className='rounded-lg'
                        >
                          <SelectValue placeholder='Selecione' />
                        </SelectTrigger>
                        <SelectContent>
                          {validCards.map((card) => (
                            <SelectItem key={card.id} value={card.id}>
                              {card.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {validationMessageFor('expense-card-1')}
                    </div>
                    {form.payMode === 'two_cards' ? (
                      <div className='flex flex-col gap-2'>
                        <Label
                          id='expense-card-2-label'
                          htmlFor='expense-card-2'
                        >
                          Cartão 2
                        </Label>
                        <Select
                          value={form.cardId2}
                          onValueChange={(value) => {
                            setValidationError(null);
                            if (value) {
                              setForm((current) => ({
                                ...current,
                                cardId2: value,
                              }));
                            }
                          }}
                        >
                          <SelectTrigger
                            id='expense-card-2'
                            aria-labelledby='expense-card-2-label'
                            aria-invalid={
                              validationError?.fieldId === 'expense-card-2'
                            }
                            aria-describedby={
                              validationError?.fieldId === 'expense-card-2'
                                ? 'expense-form-error'
                                : undefined
                            }
                            className='rounded-lg'
                          >
                            <SelectValue placeholder='Selecione' />
                          </SelectTrigger>
                          <SelectContent>
                            {validCards
                              .filter((card) => card.id !== form.cardId)
                              .map((card) => (
                                <SelectItem key={card.id} value={card.id}>
                                  {card.name}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                        {validationMessageFor('expense-card-2')}
                      </div>
                    ) : (
                      <div className='flex flex-col justify-end gap-1 rounded-lg border border-border/70 bg-black/25 px-3 py-2'>
                        <p className='text-xs text-muted-foreground'>PIX</p>
                        <p className='text-sm font-medium'>
                          {percent2}% · {formatCurrency(share2)}
                        </p>
                      </div>
                    )}
                  </div>

                  <div className='flex flex-col gap-2'>
                    <Label htmlFor='expense-card-percent'>% no cartão 1</Label>
                    <Input
                      id='expense-card-percent'
                      aria-invalid={
                        validationError?.fieldId === 'expense-card-percent'
                      }
                      aria-describedby={
                        validationError?.fieldId === 'expense-card-percent'
                          ? 'expense-form-error'
                          : undefined
                      }
                      inputMode='numeric'
                      value={form.cardPercent}
                      onChange={(event) => {
                        const digits = event.target.value
                          .replace(/\D/g, '')
                          .slice(0, 2);
                        setForm((current) => ({
                          ...current,
                          cardPercent: digits,
                        }));
                      }}
                      className='rounded-lg'
                    />
                    {validationMessageFor('expense-card-percent')}
                    <p className='text-xs text-muted-foreground'>
                      Cartão 1: {percent1}% · {formatCurrency(share1)}
                      {' · '}
                      {form.payMode === 'card_pix' ? 'PIX' : 'Cartão 2'}:{' '}
                      {percent2}% · {formatCurrency(share2)}
                    </p>
                  </div>

                  {form.cardId !== 'none'
                    ? (() => {
                        const card = cards.find(
                          (item) => item.id === form.cardId,
                        );
                        if (!card) return null;
                        const available = availableCardLimit({
                          limit: card.limit,
                          committed: committedByCard.get(card.id) ?? 0,
                        });
                        if (available == null) {
                          return (
                            <p className='text-xs text-muted-foreground'>
                              {card.name}: sem limite
                            </p>
                          );
                        }
                        const ok = share1 <= available + 0.001;
                        return (
                          <p
                            className={
                              ok
                                ? 'text-xs text-muted-foreground'
                                : 'text-xs text-rose-400'
                            }
                          >
                            {card.name}: disponível {formatCurrency(available)}
                            {ok ? '' : ' — insuficiente para esta parte'}
                          </p>
                        );
                      })()
                    : null}

                  {form.payMode === 'two_cards' && form.cardId2 !== 'none'
                    ? (() => {
                        const card = cards.find(
                          (item) => item.id === form.cardId2,
                        );
                        if (!card) return null;
                        const available = availableCardLimit({
                          limit: card.limit,
                          committed: committedByCard.get(card.id) ?? 0,
                        });
                        if (available == null) {
                          return (
                            <p className='text-xs text-muted-foreground'>
                              {card.name}: sem limite
                            </p>
                          );
                        }
                        const ok = share2 <= available + 0.001;
                        return (
                          <p
                            className={
                              ok
                                ? 'text-xs text-muted-foreground'
                                : 'text-xs text-rose-400'
                            }
                          >
                            {card.name}: disponível {formatCurrency(available)}
                            {ok ? '' : ' — insuficiente para esta parte'}
                          </p>
                        );
                      })()
                    : null}
                </div>
              ) : null}

              {cards.some((card) => card.expired) ? (
                <p className='text-xs text-muted-foreground'>
                  Cartões vencidos não podem receber novas despesas.
                </p>
              ) : null}
            </div>

            <div className='flex min-w-0 flex-col gap-2'>
              <Label htmlFor='expense-notes'>Observações</Label>
              <Textarea
                id='expense-notes'
                value={form.notes}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    notes: event.target.value,
                  }))
                }
                placeholder='Opcional'
                maxLength={500}
                className='max-h-40 min-h-20 field-sizing-fixed overflow-y-auto rounded-lg'
              />
              <p className='text-xs text-muted-foreground'>
                {form.notes.length}/500
              </p>
            </div>

            <DialogFooter>
              <Button
                type='button'
                variant='outline'
                className='rounded-lg'
                onClick={() => onOpenChange(false)}
                disabled={submitting}
              >
                Cancelar
              </Button>
              <Button
                type='submit'
                className='rounded-lg'
                disabled={submitting || limitBlocked}
              >
                {submitting ? <Spinner data-icon='inline-start' /> : null}
                Salvar
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <CustomTagFormDialog
        open={tagDialogOpen}
        onOpenChange={setTagDialogOpen}
        scope='expense'
        onCreated={(tag) => {
          setForm((current) => ({
            ...current,
            categoryKey: `tag:${tag.id}`,
          }));
        }}
      />
    </>
  );
}
