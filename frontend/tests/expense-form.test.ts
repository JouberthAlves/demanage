import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildExpensePayload,
  computeSplitShares,
  emptyExpenseForm,
  exceedsCardLimit,
  expenseCategoryOptions,
  type ExpenseFormState,
  formFromExpense,
  parseCardPercent,
  validateExpenseForm,
} from '@/lib/expense-form';
import type { Card, RecurringExpense } from '@/types/finance';

const now = new Date('2026-10-10T15:00:00.000Z');
const c1: Card = {
  id: 'c1',
  name: 'Nubank',
  limit: 1000,
  committed: 0,
  available: 1000,
};
const c2: Card = {
  id: 'c2',
  name: 'Itaú',
  limit: 100,
  committed: 0,
  available: 100,
};
const cards: Card[] = [c1, c2];

function form(overrides: Partial<ExpenseFormState> = {}): ExpenseFormState {
  return {
    ...emptyExpenseForm(now),
    name: 'Netflix',
    amount: '55,90',
    ...overrides,
  };
}

function validate(
  state: ExpenseFormState,
  options: { cards?: Card[]; editing?: boolean; previousStartsAt?: string } = {},
) {
  return validateExpenseForm(state, {
    cards: options.cards ?? cards,
    editing: options.editing ?? false,
    now,
    previousStartsAt: options.previousStartsAt,
  });
}

test('defaults are built from the São Paulo day, not the browser clock', () => {
  const lateNight = new Date('2026-10-11T02:00:00.000Z'); // 23:00 on Oct 10 in SP
  assert.equal(emptyExpenseForm(lateNight).occurredAt, '2026-10-10');
  assert.equal(emptyExpenseForm(lateNight).dueMonth, '10');

  const nextMorning = new Date('2026-11-01T04:00:00.000Z'); // 01:00 on Nov 1
  assert.equal(emptyExpenseForm(nextMorning).occurredAt, '2026-11-01');
  assert.equal(emptyExpenseForm(nextMorning).dueMonth, '11');
});

test('a valid monthly expense passes validation', () => {
  assert.equal(validate(form()), null);
});

test('name and amount are required', () => {
  assert.equal(validate(form({ name: '  ' }))?.fieldId, 'expense-name');
  assert.equal(validate(form({ amount: '' }))?.fieldId, 'expense-amount');
  assert.equal(validate(form({ amount: '0,00' }))?.fieldId, 'expense-amount');
});

test('recurring schedule needs a valid day and end date after the start', () => {
  assert.equal(validate(form({ dueDay: '' }))?.fieldId, 'expense-due');
  assert.equal(validate(form({ dueMonth: '' }))?.fieldId, 'expense-due-month');
  const error = validate(
    form({ dueDay: '05', dueMonth: '12', endsAt: '2026-01-01' }),
  );
  assert.equal(error?.fieldId, 'expense-ends-at');
});

test('one-off expenses need a real date and skip the schedule', () => {
  const unique = form({ frequency: 'unica', dueDay: '', occurredAt: '' });
  assert.equal(validate(unique)?.fieldId, 'expense-occurred-at');
  assert.equal(
    validate(form({ frequency: 'unica', dueDay: '', occurredAt: '2026-02-30' }))
      ?.fieldId,
    'expense-occurred-at',
  );
  assert.equal(
    validate(form({ frequency: 'unica', dueDay: '', occurredAt: '2026-10-09' })),
    null,
  );
});

test('percentage is validated instead of silently clamped to 1%', () => {
  for (const cardPercent of ['', '0', '00', '100']) {
    const error = validate(
      form({ payMode: 'card_pix', cardId: 'c1', cardPercent }),
    );
    assert.equal(error?.fieldId, 'expense-card-percent', `"${cardPercent}"`);
    assert.equal(error?.message, 'Informe um percentual entre 1 e 99');
  }
  const twoCards = validate(
    form({ payMode: 'two_cards', cardId: 'c1', cardId2: 'c2', cardPercent: '' }),
  );
  assert.equal(twoCards?.fieldId, 'expense-card-percent');
  assert.equal(
    validate(form({ payMode: 'card_pix', cardId: 'c1', cardPercent: '1' })),
    null,
  );
});

test('parseCardPercent only accepts integers from 1 to 99', () => {
  assert.equal(parseCardPercent(''), null);
  assert.equal(parseCardPercent('0'), null);
  assert.equal(parseCardPercent('5'), 5);
  assert.equal(parseCardPercent('99'), 99);
  assert.equal(parseCardPercent('100'), null);
  assert.equal(parseCardPercent('-3'), null);
});

test('card selection rules per pay mode', () => {
  assert.equal(validate(form({ payMode: 'one_card' }))?.fieldId, 'expense-card');
  assert.equal(
    validate(form({ payMode: 'two_cards', cardId: 'c1' }))?.fieldId,
    'expense-card-2',
  );
  assert.equal(
    validate(form({ payMode: 'two_cards', cardId: 'none', cardId2: 'c2' }))
      ?.fieldId,
    'expense-card-1',
  );
  assert.equal(
    validate(form({ payMode: 'two_cards', cardId: 'c1', cardId2: 'c1' }))
      ?.fieldId,
    'expense-card-2',
  );
  assert.equal(validate(form({ payMode: 'card_pix' }))?.fieldId, 'expense-card-1');
});

test('card limit check covers every pay mode', () => {
  // 150,00 on a card with a 100,00 limit
  const oneCard = form({ amount: '150,00', payMode: 'one_card', cardId: 'c2' });
  assert.match(validate(oneCard)?.message ?? '', /Limite insuficiente no cartão Itaú/);
  assert.equal(validate(oneCard)?.fieldId, 'expense-card');

  // 70% of 150,00 = 105,00 on c2 (second card)
  const split = form({
    amount: '150,00',
    payMode: 'two_cards',
    cardId: 'c2',
    cardId2: 'c1',
    cardPercent: '70',
  });
  assert.equal(validate(split)?.fieldId, 'expense-card-1');

  const pix = form({
    amount: '300,00',
    payMode: 'card_pix',
    cardId: 'c2',
    cardPercent: '50',
  });
  assert.equal(validate(pix)?.fieldId, 'expense-card-1');

  // the backend-computed available amount is what counts
  const nearlyFull = form({ amount: '50,00', payMode: 'one_card', cardId: 'c2' });
  assert.equal(validate(nearlyFull), null);
  const tight: Card[] = [c1, { ...c2, committed: 60, available: 40 }];
  const blocked = validate(nearlyFull, { cards: tight });
  assert.equal(blocked?.fieldId, 'expense-card');
  assert.equal(
    blocked?.message.replace(/\s/g, ' '),
    'Limite insuficiente no cartão Itaú (disponível R$ 40,00)',
  );

  const context = { frequency: 'mensal', editing: false } as const;
  const shares = computeSplitShares(150, '70');
  assert.ok(exceedsCardLimit(split, 150, shares, cards, context));
  assert.equal(
    exceedsCardLimit(form({ payMode: 'none' }), 150, shares, cards, context),
    null,
  );
});

test('weekly expenses reserve five charges against the available limit', () => {
  const tight: Card[] = [c1, c2];
  // 20,00 x 5 = 100,00 fits exactly; 20,01 x 5 does not.
  const fits = form({
    amount: '20,00',
    frequency: 'semanal',
    payMode: 'one_card',
    cardId: 'c2',
  });
  assert.equal(validate(fits, { cards: tight }), null);
  const over = form({
    amount: '20,01',
    frequency: 'semanal',
    payMode: 'one_card',
    cardId: 'c2',
  });
  assert.equal(validate(over, { cards: tight })?.fieldId, 'expense-card');
  // The same amount monthly is a single charge and fits.
  assert.equal(validate({ ...over, frequency: 'mensal' }, { cards: tight }), null);
});

test('cards without a limit are never blocked', () => {
  const unlimited: Card[] = [
    { id: 'c3', name: 'Livre', committed: 5000, available: null },
  ];
  const state = form({ amount: '999.999,00', payMode: 'one_card', cardId: 'c3' });
  assert.equal(validate(state, { cards: unlimited }), null);
});

test('editing does not pre-block on the limit (backend decides)', () => {
  const state = form({ amount: '150,00', payMode: 'one_card', cardId: 'c2' });
  assert.ok(validate(state));
  assert.equal(validate(state, { editing: true }), null);
});

test('payload parses pt-BR money and builds splits', () => {
  const payload = buildExpensePayload(
    form({ amount: '1.500,00', payMode: 'card_pix', cardId: 'c1', cardPercent: '70' }),
    { now },
  );
  assert.equal(payload.amount, 1500);
  assert.deepEqual(payload.splits, [
    { kind: 'card', cardId: 'c1', percent: 70 },
    { kind: 'pix', percent: 30 },
  ]);
  assert.equal(payload.cardId, null);

  const two = buildExpensePayload(
    form({ payMode: 'two_cards', cardId: 'c1', cardId2: 'c2', cardPercent: '60' }),
    { now },
  );
  assert.deepEqual(two.splits, [
    { kind: 'card', cardId: 'c1', percent: 60 },
    { kind: 'card', cardId: 'c2', percent: 40 },
  ]);

  const one = buildExpensePayload(form({ payMode: 'one_card', cardId: 'c2' }), {
    now,
  });
  assert.equal(one.cardId, 'c2');
  assert.deepEqual(one.splits, [{ kind: 'card', cardId: 'c2', percent: 100 }]);

  assert.deepEqual(buildExpensePayload(form(), { now }).splits, []);
});

test('payload for recurring, one-off and custom-tag expenses', () => {
  const monthly = buildExpensePayload(
    form({ dueDay: '5', dueMonth: '10', endsAt: '2027-01-01', notes: ' oi ' }),
    { now },
  );
  assert.equal(monthly.dueDay, 5);
  assert.equal(monthly.startsAt, '2026-10-05');
  assert.equal(monthly.endsAt, '2027-01-01');
  assert.equal(monthly.notes, 'oi');
  assert.equal(monthly.date, undefined);

  const unique = buildExpensePayload(
    form({ frequency: 'unica', dueDay: '', endsAt: '', occurredAt: '2026-10-01' }),
    { now },
  );
  assert.equal(unique.date, '2026-10-01');
  assert.equal(unique.dueDay, null);
  assert.equal(unique.startsAt, null);
  assert.equal(unique.endsAt, null);

  const tagged = buildExpensePayload(form({ categoryKey: 'tag:abc' }), { now });
  assert.equal(tagged.category, 'outro');
  assert.equal(tagged.customTagId, 'abc');
  assert.equal(
    buildExpensePayload(form({ categoryKey: 'divida' }), { now }).customTagId,
    null,
  );
});

test('editing an old expense keeps its original start date', () => {
  const state = form({ dueDay: '05', dueMonth: '3' });
  const payload = buildExpensePayload(state, {
    now,
    previousStartsAt: '2025-03-05',
  });
  assert.equal(payload.startsAt, '2025-03-05');

  const moved = buildExpensePayload(form({ dueDay: '10', dueMonth: '3' }), {
    now,
    previousStartsAt: '2025-03-05',
  });
  assert.equal(moved.startsAt, '2025-03-10');
});

test('formFromExpense round-trips an existing split expense', () => {
  const expense: RecurringExpense = {
    id: 'e1',
    name: 'Academia',
    amount: 1500,
    category: 'cofrinho',
    frequency: 'mensal',
    dueDay: 7,
    startsAt: '2025-03-07',
    splits: [
      { kind: 'card', cardId: 'c1', percent: 60, amount: 900 },
      { kind: 'pix', percent: 40, amount: 600 },
    ],
  };
  const state = formFromExpense(expense, now);
  assert.equal(state.amount, '1.500,00');
  assert.equal(state.payMode, 'card_pix');
  assert.equal(state.cardPercent, '60');
  assert.equal(state.dueDay, '07');
  assert.equal(state.dueMonth, '3');
  assert.equal(state.categoryKey, 'cofrinho');
});

test('category options keep creation restricted but show the current value', () => {
  const values = (key: string) => expenseCategoryOptions(key).map((o) => o.value);
  assert.deepEqual(values('assinatura'), ['assinatura', 'parcela', 'divida']);
  assert.deepEqual(values('tag:x'), ['assinatura', 'parcela', 'divida']);
  for (const key of ['outro', 'cofrinho', 'investimento']) {
    assert.deepEqual(values(key), ['assinatura', 'parcela', 'divida', key]);
  }
});
