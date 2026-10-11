import {
  dayValueFromStored,
  type FormFieldError,
  isRecurringFrequency,
  monthValueFromStartsAt,
  resolveSchedule,
  scheduleValuesForFrequency,
  validateSchedule,
} from '@/components/shared/schedule-form/validate-schedule';
import {
  BUILTIN_EXPENSE_CATEGORY_LABELS,
  EXPENSE_CATEGORY_LABELS,
} from '@/data/labels';
import { parseDayKey, todayKey } from '@/lib/dates';
import {
  CARD_FIELD_IDS,
  computeSplitShares,
  exceedsCardLimit,
  NO_CARD,
  type PayMode,
  type SplitShares,
} from '@/lib/expense-card-limit';
import type { ExpensePayload } from '@/lib/expenses-api';
import {
  formatBrlInputValue,
  formatCurrency,
  parseCurrencyInput,
} from '@/lib/format';
import type {
  Card,
  ExpenseCategory,
  ExpenseFrequency,
  RecurringExpense,
} from '@/types/finance';

export type ExpenseFormState = {
  name: string;
  amount: string;
  /** Built-in category, or `tag:<id>` for a custom tag. */
  categoryKey: string;
  frequency: ExpenseFrequency;
  payMode: PayMode;
  cardId: string;
  cardId2: string;
  /** Raw text of the "% no cartão 1" input. */
  cardPercent: string;
  dueDay: string;
  dueMonth: string;
  occurredAt: string;
  endsAt: string;
  notes: string;
};

export {
  checkCardLimit,
  computeSplitShares,
  exceedsCardLimit,
  NO_CARD,
  parseCardPercent,
  type PayMode,
} from '@/lib/expense-card-limit';

export const EXPENSE_FIELD_IDS = {
  error: 'expense-form-error',
  name: 'expense-name',
  amount: 'expense-amount',
  schedule: {
    day: 'expense-due',
    month: 'expense-due-month',
    endsAt: 'expense-ends-at',
  },
  occurredAt: 'expense-occurred-at',
  ...CARD_FIELD_IDS,
} as const;

const SCHEDULE_MESSAGES = {
  day: 'Informe o dia em que será descontado (01-31)',
  month: 'Informe o mês em que será descontado',
  endsAt: 'Data de término deve ser após o primeiro desconto',
};

const PERCENT_MESSAGE = 'Informe um percentual entre 1 e 99';

/** Defaults for a new expense, built when the dialog opens. */
export function emptyExpenseForm(now: Date): ExpenseFormState {
  const today = todayKey(now);
  return {
    name: '',
    amount: '',
    categoryKey: 'assinatura',
    frequency: 'mensal',
    payMode: 'none',
    cardId: NO_CARD,
    cardId2: NO_CARD,
    cardPercent: '70',
    dueDay: '05',
    dueMonth: monthValueFromStartsAt(null, now),
    occurredAt: today,
    endsAt: '',
    notes: '',
  };
}

export function categoryKeyFromExpense(expense: RecurringExpense) {
  if (expense.customTagId) return `tag:${expense.customTagId}`;
  return expense.category;
}

export function payModeFromExpense(expense: RecurringExpense): PayMode {
  const splits = expense.splits ?? [];
  const cardSplits = splits.filter((split) => split.kind === 'card');
  const pixSplits = splits.filter((split) => split.kind === 'pix');
  if (cardSplits.length === 2) return 'two_cards';
  if (cardSplits.length === 1 && pixSplits.length === 1) return 'card_pix';
  if (cardSplits.length === 1 || expense.cardId) return 'one_card';
  return 'none';
}

export function formFromExpense(
  expense: RecurringExpense,
  now: Date,
): ExpenseFormState {
  const mode = payModeFromExpense(expense);
  const cardSplits = (expense.splits ?? []).filter(
    (split) => split.kind === 'card',
  );
  const splitsByPercent = mode === 'two_cards' || mode === 'card_pix';

  return {
    name: expense.name,
    amount: formatBrlInputValue(expense.amount),
    categoryKey: categoryKeyFromExpense(expense),
    frequency: expense.frequency,
    payMode: mode,
    cardId: cardSplits[0]?.cardId ?? expense.cardId ?? NO_CARD,
    cardId2: cardSplits[1]?.cardId ?? NO_CARD,
    cardPercent: splitsByPercent
      ? String(Math.round(Number(cardSplits[0]?.percent ?? 70)))
      : '70',
    dueDay: dayValueFromStored(expense.dueDay),
    dueMonth: monthValueFromStartsAt(expense.startsAt, now),
    occurredAt: expense.occurredAt?.slice(0, 10) ?? todayKey(now),
    endsAt: expense.endsAt ?? '',
    notes: expense.notes ?? '',
  };
}

/**
 * Category options for the select. Creation is limited to the built-in
 * categories, but the current value is always listed so editing an expense
 * created elsewhere ("outro", "cofrinho", "investimento") shows its label.
 */
export function expenseCategoryOptions(currentKey: string) {
  const options = Object.entries(BUILTIN_EXPENSE_CATEGORY_LABELS).map(
    ([value, label]) => ({ value, label }),
  );
  const extra =
    currentKey in EXPENSE_CATEGORY_LABELS &&
    !(currentKey in BUILTIN_EXPENSE_CATEGORY_LABELS)
      ? [
          {
            value: currentKey,
            label: EXPENSE_CATEGORY_LABELS[currentKey as ExpenseCategory],
          },
        ]
      : [];
  return [...options, ...extra];
}

export function applyExpenseFrequency(
  form: ExpenseFormState,
  frequency: ExpenseFrequency,
  now: Date,
): ExpenseFormState {
  const schedule = scheduleValuesForFrequency(
    { day: form.dueDay, month: form.dueMonth, endsAt: form.endsAt },
    frequency,
    now,
  );
  return {
    ...form,
    frequency,
    dueDay: schedule.day,
    dueMonth: schedule.month,
    endsAt: schedule.endsAt,
  };
}

/** Switches the payment mode, picking sensible default cards. */
export function applyPayMode(
  form: ExpenseFormState,
  payMode: PayMode,
  validCards: Card[],
): ExpenseFormState {
  const firstCardId = validCards[0]?.id;
  const cardId =
    payMode === 'none'
      ? NO_CARD
      : form.cardId === NO_CARD && firstCardId
        ? firstCardId
        : form.cardId;

  let cardId2 = NO_CARD;
  if (payMode === 'two_cards') {
    cardId2 =
      form.cardId2 === NO_CARD || form.cardId2 === form.cardId
        ? (validCards.find(
            (card) =>
              card.id !== (form.cardId === NO_CARD ? firstCardId : form.cardId),
          )?.id ?? NO_CARD)
        : form.cardId2;
  }
  return { ...form, payMode, cardId, cardId2 };
}


export type ExpenseValidationContext = {
  cards: Card[];
  /** Editing an existing expense: the limit is not pre-checked (backend decides). */
  editing: boolean;
  now: Date;
  /** startsAt of the expense being edited. */
  previousStartsAt?: string | null;
};

/** Returns the first problem found, or null when the form can be saved. */
export function validateExpenseForm(
  form: ExpenseFormState,
  { cards, editing, now, previousStartsAt }: ExpenseValidationContext,
): FormFieldError | null {
  const fail = (fieldId: string, message: string) => ({ fieldId, message });
  const amount = parseCurrencyInput(form.amount);

  if (!form.name.trim()) {
    return fail(EXPENSE_FIELD_IDS.name, 'Informe o nome da despesa');
  }
  if (amount <= 0) {
    return fail(EXPENSE_FIELD_IDS.amount, 'Informe um valor válido');
  }

  if (isRecurringFrequency(form.frequency)) {
    const schedule = validateSchedule(
      { day: form.dueDay, month: form.dueMonth, endsAt: form.endsAt },
      EXPENSE_FIELD_IDS.schedule,
      SCHEDULE_MESSAGES,
      { now, previousStartsAt },
    );
    if (!schedule.ok) return schedule.error;
  }

  if (form.frequency === 'unica' && !parseDayKey(form.occurredAt)) {
    return fail(EXPENSE_FIELD_IDS.occurredAt, 'Informe a data da despesa');
  }

  const shares = computeSplitShares(amount, form.cardPercent);
  if (form.payMode === 'one_card' && form.cardId === NO_CARD) {
    return fail(EXPENSE_FIELD_IDS.card, 'Selecione um cartão');
  }
  if (form.payMode === 'two_cards') {
    if (form.cardId === NO_CARD || form.cardId2 === NO_CARD) {
      return fail(
        form.cardId === NO_CARD
          ? EXPENSE_FIELD_IDS.card1
          : EXPENSE_FIELD_IDS.card2,
        'Selecione os dois cartões',
      );
    }
    if (form.cardId === form.cardId2) {
      return fail(EXPENSE_FIELD_IDS.card2, 'Escolha dois cartões diferentes');
    }
    if (shares.percent1 == null) {
      return fail(EXPENSE_FIELD_IDS.percent, PERCENT_MESSAGE);
    }
  }
  if (form.payMode === 'card_pix') {
    if (form.cardId === NO_CARD) {
      return fail(EXPENSE_FIELD_IDS.card1, 'Selecione o cartão');
    }
    if (shares.percent1 == null) {
      return fail(EXPENSE_FIELD_IDS.percent, PERCENT_MESSAGE);
    }
  }

  const exceeded = exceedsCardLimit(form, amount, shares, cards, {
    frequency: form.frequency,
    editing,
  });
  if (exceeded) {
    return fail(
      exceeded.fieldId,
      `Limite insuficiente no cartão ${exceeded.card.name} (disponível ${formatCurrency(exceeded.available ?? 0)})`,
    );
  }
  return null;
}

function buildSplits(
  form: ExpenseFormState,
  shares: SplitShares,
): NonNullable<ExpensePayload['splits']> {
  const percent1 = shares.percent1 ?? 0;
  if (form.payMode === 'one_card') {
    return [{ kind: 'card', cardId: form.cardId, percent: 100 }];
  }
  if (form.payMode === 'two_cards') {
    return [
      { kind: 'card', cardId: form.cardId, percent: percent1 },
      { kind: 'card', cardId: form.cardId2, percent: shares.percent2 },
    ];
  }
  if (form.payMode === 'card_pix') {
    return [
      { kind: 'card', cardId: form.cardId, percent: percent1 },
      { kind: 'pix', percent: shares.percent2 },
    ];
  }
  return [];
}

/** API payload for a form that already passed validateExpenseForm. */
export function buildExpensePayload(
  form: ExpenseFormState,
  options: { now: Date; previousStartsAt?: string | null },
): ExpensePayload {
  const amount = parseCurrencyInput(form.amount);
  const isCustom = form.categoryKey.startsWith('tag:');
  const recurring = isRecurringFrequency(form.frequency);
  const schedule = recurring
    ? resolveSchedule(
        { day: form.dueDay, month: form.dueMonth },
        options,
      )
    : null;

  return {
    name: form.name.trim().slice(0, 100),
    amount,
    category: isCustom ? 'outro' : (form.categoryKey as ExpenseCategory),
    frequency: form.frequency,
    date: form.frequency === 'unica' ? form.occurredAt : undefined,
    cardId: form.payMode === 'one_card' ? form.cardId : null,
    dueDay: schedule?.day ?? null,
    startsAt: schedule?.startsAt ?? null,
    endsAt: recurring ? form.endsAt || null : null,
    notes: form.notes.trim().slice(0, 500) || null,
    customTagId: isCustom ? form.categoryKey.slice(4) : null,
    splits: buildSplits(form, computeSplitShares(amount, form.cardPercent)),
  };
}
