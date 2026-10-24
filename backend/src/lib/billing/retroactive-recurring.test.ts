import assert from 'node:assert/strict';
import test from 'node:test';

import { hasRetroactiveClosedCardCharge, hasSettledRecurringMutation } from './retroactive-recurring';

const at = (day: string) => new Date(`${day}T12:00:00.000Z`);
const card = (lastInvoicedOn: string | null) => ({
  createdAt: at('2026-08-01'),
  lastInvoicedOn: lastInvoicedOn ? at(lastInvoicedOn) : null,
});
const recurrence = (frequency: 'mensal' | 'semanal', start: string, day: number) => ({
  amount: '100',
  frequency,
  startsAt: at(start),
  dueDay: day,
  endsAt: null,
});

test('F02 rejects card recurrence whose September charge was already invoiced', () => {
  assert.equal(hasRetroactiveClosedCardCharge(card('2026-09-05'), recurrence('mensal', '2026-09-01', 1)), true);
  assert.equal(hasRetroactiveClosedCardCharge(card('2026-09-05'), recurrence('semanal', '2026-09-01', 1)), true);
});

test('F02 accepts charges starting after last closing, even when start date is in the past', () => {
  assert.equal(hasRetroactiveClosedCardCharge(card('2026-09-05'), recurrence('mensal', '2026-09-07', 10)), false);
  assert.equal(hasRetroactiveClosedCardCharge(card('2026-09-05'), recurrence('mensal', '2026-09-01', 31)), false);
  assert.equal(hasRetroactiveClosedCardCharge(card(null), recurrence('mensal', '2026-09-01', 1)), false);
});

test('F02 ignores empty period and recurrence ended before first eligible date', () => {
  assert.equal(hasRetroactiveClosedCardCharge({createdAt: at('2026-09-10'),lastInvoicedOn: at('2026-09-05')}, recurrence('mensal','2026-09-01',1)), false);
  assert.equal(hasRetroactiveClosedCardCharge(card('2026-09-05'), {...recurrence('mensal','2026-09-01',1), endsAt:at('2026-08-31')}), false);
});

test('P1: moving February 15 after card A February 20 invoice cannot double bill on card B March 10', () => {
  const before = {
    amount: '100', frequency: 'mensal', dueDay: 15,
    startsAt: at('2026-01-15'), endsAt: null, occurredAt: null,
    createdAt: at('2026-01-01'), isInvoice: false, cardId: 'A', splits: [],
    obligationVersions: [{ sequence: 1, effectiveMonth: '2026-01', amount: '100', cardId: 'A', splits: [] }],
  };
  const after = {
    ...before, cardId: 'B',
    obligationVersions: [...before.obligationVersions,
      { sequence: 2, effectiveMonth: '2026-02', amount: '100', cardId: 'B', splits: [] }],
  };
  const cards = [
    { id: 'A', lastInvoicedOn: at('2026-02-20') },
    { id: 'B', lastInvoicedOn: at('2026-02-10') },
  ];
  assert.equal(hasSettledRecurringMutation(before, after, cards, '2026-02'), true);
  assert.equal(hasSettledRecurringMutation(before, after, [
    { id: 'A', lastInvoicedOn: at('2026-02-10') },
    { id: 'B', lastInvoicedOn: at('2026-02-20') },
  ], '2026-02'), true, 'the inverse direction must not silently drop a closed occurrence');
  assert.equal(hasSettledRecurringMutation(before, after, [
    { id: 'A', lastInvoicedOn: at('2026-01-20') },
    { id: 'B', lastInvoicedOn: at('2026-02-10') },
  ], '2026-02'), false, 'an unbilled occurrence may change cards');
  const due25 = { ...before, dueDay: 25 };
  const moved25 = { ...after, dueDay: 25 };
  assert.equal(hasSettledRecurringMutation(due25, moved25, cards, '2026-02'), false,
    'the February 25 occurrence is still unbilled on either card');
  const priceOnly = { ...before, amount: '150', obligationVersions: [
    ...before.obligationVersions,
    { sequence: 2, effectiveMonth: '2026-02', amount: '150', cardId: 'A', splits: [] },
  ] };
  assert.equal(hasSettledRecurringMutation(before, priceOnly, cards, '2026-02'), false,
    'same-card amount revisions should retain their existing versioned behavior');

  const halfMoved = {
    ...before, cardId: null, splits: [
      { kind: 'card', cardId: 'A', amount: '50' },
      { kind: 'card', cardId: 'B', amount: '50' },
    ],
    obligationVersions: [...before.obligationVersions, {
      sequence: 2, effectiveMonth: '2026-02', amount: '100', cardId: null,
      splits: [
        { kind: 'card', cardId: 'A', amount: '50' },
        { kind: 'card', cardId: 'B', amount: '50' },
      ],
    }],
  };
  assert.equal(hasSettledRecurringMutation(before, halfMoved, cards, '2026-02'), true,
    'a partial split cannot reassign any already-invoiced portion');
  assert.equal(hasSettledRecurringMutation(
    { ...before, obligationVersions: [] }, after, cards, '2026-02',
  ), true, 'missing legacy snapshots must not disable the settlement guard');
  const archivedSource = { ...cards[0], archivedAt: at('2026-02-22') };
  assert.equal(hasSettledRecurringMutation(before, after, [archivedSource, cards[1]], '2026-02'), true,
    'archived source cards also have immutable billing history');
});

test('P1: changing the monthly due day after closing cannot duplicate or erase a settled occurrence', () => {
  const before = {
    amount: '100', frequency: 'mensal', dueDay: 15,
    startsAt: at('2026-02-15'), endsAt: null, occurredAt: null,
    createdAt: at('2026-02-01'), isInvoice: false, cardId: 'A', splits: [],
    obligationVersions: [{ sequence: 1, effectiveMonth: '2026-02', amount: '100', cardId: 'A', splits: [] }],
  };
  const due25 = { ...before, dueDay: 25 };
  const settled = [{ id: 'A', lastInvoicedOn: at('2026-02-20') }];
  assert.equal(hasSettledRecurringMutation(before, due25, settled, '2026-02'), true,
    'a February 15 charge is already in the February 20 immutable invoice');
  assert.equal(hasSettledRecurringMutation(due25, before, settled, '2026-02'), true,
    'moving an unbilled February 25 charge behind the closing boundary loses the obligation');
  assert.equal(hasSettledRecurringMutation(before, due25, [
    { id: 'A', lastInvoicedOn: at('2026-02-10') },
  ], '2026-02'), false, 'both schedules are unbilled when edited before the due dates');
  assert.equal(hasSettledRecurringMutation(before, { ...before, endsAt: at('2026-03-01') }, settled, '2026-02'), false,
    'a future end date does not alter the already-settled occurrence');
  assert.equal(hasSettledRecurringMutation(before, { ...before, endsAt: at('2026-02-01') }, settled, '2026-02'), true,
    'a backdated end date cannot erase the immutable settled charge');
});

test('P1: matching historical total cannot conceal a different set of settled recurrence dates', () => {
  const before = {
    amount: '99', frequency: 'mensal', dueDay: 15,
    startsAt: at('2026-01-15'), endsAt: null, occurredAt: null,
    createdAt: at('2026-01-15'), isInvoice: false, cardId: 'A', splits: [],
    obligationVersions: [{ sequence: 1, effectiveMonth: '2026-01', amount: '99', cardId: 'A', splits: [] }],
  };
  const after = {
    ...before, amount: '66', frequency: 'semanal', dueDay: 1,
    startsAt: at('2026-02-01'),
    obligationVersions: [...before.obligationVersions,
      { sequence: 2, effectiveMonth: '2026-02', amount: '66', cardId: 'A', splits: [] }],
  };
  assert.equal(hasSettledRecurringMutation(before, after, [
    { id: 'A', createdAt: at('2026-01-01'), lastInvoicedOn: at('2026-02-20') },
  ], '2026-02'), true, 'closed Jan R$99 + Feb R$99 cannot become Jan R$0 + Feb R$198');
});

test('P2: a card created after a due date cannot have invoiced that earlier occurrence', () => {
  const before = {
    amount: '100', frequency: 'mensal', dueDay: 5,
    startsAt: at('2026-02-01'), endsAt: null, occurredAt: null,
    createdAt: at('2026-02-01'), isInvoice: false, cardId: 'A', splits: [],
    obligationVersions: [{ sequence: 1, effectiveMonth: '2026-02', amount: '100', cardId: 'A', splits: [] }],
  };
  const after = {
    ...before, cardId: 'B',
    obligationVersions: [...before.obligationVersions,
      { sequence: 2, effectiveMonth: '2026-02', amount: '100', cardId: 'B', splits: [] }],
  };
  assert.equal(hasSettledRecurringMutation(before, after, [
    { id: 'A', createdAt: at('2026-02-10'), lastInvoicedOn: at('2026-02-20') },
    { id: 'B', createdAt: at('2026-02-21'), lastInvoicedOn: null },
  ], '2026-02'), false, 'the February 5 occurrence predates both cards');
});

test('P2: a schedule edit that preserves every settled occurrence date remains legitimate', () => {
  const before = {
    amount: '100', frequency: 'mensal', dueDay: 15,
    startsAt: at('2026-01-01'), endsAt: null, occurredAt: null,
    createdAt: at('2026-01-01'), isInvoice: false, cardId: 'A', splits: [],
    obligationVersions: [{ sequence: 1, effectiveMonth: '2026-01', amount: '100', cardId: 'A', splits: [] }],
  };
  assert.equal(hasSettledRecurringMutation(before, { ...before, startsAt: at('2026-01-02') }, [
    { id: 'A', createdAt: at('2026-01-01'), lastInvoicedOn: at('2026-01-20') },
  ], '2026-01'), false, 'a later start before the same January 15 due date cannot affect January billing');

  const monthEnd = {
    ...before, dueDay: 30, startsAt: at('2026-02-01'),
    createdAt: at('2026-02-01'), obligationVersions: [{
      sequence: 1, effectiveMonth: '2026-02', amount: '100', cardId: 'A', splits: [],
    }],
  };
  assert.equal(hasSettledRecurringMutation(monthEnd, { ...monthEnd, dueDay: 31 }, [
    { id: 'A', createdAt: at('2026-02-01'), lastInvoicedOn: at('2026-02-28') },
  ], '2026-02'), false, 'February 30 and February 31 clamp to the same February 28 charge');
});

test('P2: legacy null startsAt uses São Paulo civil date when protecting a closed charge', () => {
  const before = {
    amount: '100', frequency: 'mensal', dueDay: 31,
    startsAt: null, endsAt: null, occurredAt: null,
    createdAt: new Date('2026-01-01T01:00:00.000Z'),
    isInvoice: false, cardId: 'A', splits: [], obligationVersions: [],
  };
  const after = {
    ...before, startsAt: at('2026-01-01'),
    obligationVersions: [{ sequence: 1, effectiveMonth: '2026-01', amount: '100', cardId: 'A', splits: [] }],
  };
  assert.equal(hasSettledRecurringMutation(before, after, [
    { id: 'A', createdAt: at('2025-12-01'), lastInvoicedOn: at('2025-12-31') },
  ], '2026-01'), true, 'December 31 São Paulo occurrence was closed before the UTC January 1 timestamp');
});
