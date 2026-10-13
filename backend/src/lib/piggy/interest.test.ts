import assert from 'node:assert/strict';
import test from 'node:test';

import { addDaysToKey, weekdayOfKey } from '@/lib/civil-date';
import { decimal } from '@/lib/decimal';
import { validateHistoryRange } from '@/lib/market/series';
import { MAX_HISTORY_RANGE_DAYS } from '@/lib/market/types';
import {
  accrueCdiInterest,
  calculateCdiInterest,
  type InterestLedgerTransaction,
  lastCompletedWeekday,
  splitCdiHistoryRange,
} from '@/lib/piggy/interest';

test('rendimento diário usa CDI bruto proporcional ao percentual do cofrinho', () => {
  const interest = calculateCdiInterest(decimal('10000'), decimal('0.04'), decimal('100'));
  assert.equal(interest.toFixed(2), '4.00');
});

test('cofrinho 120% CDI multiplica a taxa diária sem aplicar imposto', () => {
  const interest = calculateCdiInterest(decimal('10000'), decimal('0.04'), decimal('120'));
  assert.equal(interest.toFixed(2), '4.80');
});

test('percentual zero não inventa rendimento', () => {
  const interest = calculateCdiInterest(decimal('10000'), decimal('0.04'), decimal('0'));
  assert.equal(interest.toFixed(2), '0.00');
});

test('catch-up nunca depende do CDI do dia ainda em andamento', () => {
  assert.equal(
    lastCompletedWeekday(new Date('2026-08-21T18:00:00Z')).toISOString().slice(0, 10),
    '2026-08-20',
  );
});

test('fim de semana usa a sexta-feira como último dia concluído', () => {
  assert.equal(
    lastCompletedWeekday(new Date('2026-08-24T12:00:00Z')).toISOString().slice(0, 10),
    '2026-08-21',
  );
});

test('data de catch-up segue o dia civil de São Paulo perto da meia-noite UTC', () => {
  assert.equal(
    lastCompletedWeekday(new Date('2026-01-01T01:00:00.000Z')).toISOString().slice(0, 10),
    '2025-12-30',
  );
});

test('catch-up divide histórico CDI longo em janelas compatíveis com o limite', () => {
  const ranges = splitCdiHistoryRange(
    new Date('2010-01-01T12:00:00.000Z'),
    new Date('2026-09-28T12:00:00.000Z'),
  );
  assert.equal(ranges.length, 2);
  assert.equal(ranges[0].from, '2010-01-01');
  assert.equal(ranges.at(-1)?.to, '2026-09-28');
  for (const range of ranges) {
    const elapsedDays =
      (new Date(`${range.to}T12:00:00Z`).getTime() -
        new Date(`${range.from}T12:00:00Z`).getTime()) /
      86_400_000;
    assert.ok(elapsedDays + 1 <= MAX_HISTORY_RANGE_DAYS);
    assert.doesNotThrow(() =>
      validateHistoryRange(range.from, range.to, new Date('2026-09-29T12:00:00Z')),
    );
  }
});

// --------------------------------------------------------------- accrual

function businessDays(startKey: string, count: number) {
  const days: string[] = [];
  let key = startKey;
  while (days.length < count) {
    if (weekdayOfKey(key) !== 0 && weekdayOfKey(key) !== 6) days.push(key);
    key = addDaysToKey(key, 1);
  }
  return days;
}

/** Applies postings to a ledger the way the DB layer would. */
function replay(args: {
  deposit: string;
  days: string[];
  ratePercent: string;
  cdiPercent?: string;
  batches?: number;
}) {
  const transactions: InterestLedgerTransaction[] = [
    {
      type: 'deposit',
      amount: args.deposit,
      date: new Date(`${args.days[0]}T12:00:00.000Z`),
      interestKey: null,
      resultingBalance: null,
    },
  ];
  let accruedThrough: string | null = null;
  const postedAll: ReturnType<typeof accrueCdiInterest>['postings'] = [];
  const points = args.days.map((date) => ({ date, value: args.ratePercent }));
  const batches = args.batches ?? 1;
  const size = Math.ceil(points.length / batches);

  for (let batch = 0; batch < batches; batch += 1) {
    const slice = points.slice(0, (batch + 1) * size);
    const result = accrueCdiInterest({
      bankId: 'bank',
      transactions: [...transactions],
      accruedThrough,
      points: slice,
      cdiPercent: args.cdiPercent ?? '100',
      startKey: accruedThrough ? addDaysToKey(accruedThrough, 1) : args.days[0],
      targetKey: slice[slice.length - 1].date,
    });
    for (const posting of result.postings) {
      postedAll.push(posting);
      transactions.push({
        type: 'interest',
        amount: posting.amount,
        date: new Date(`${posting.day}T12:00:00.000Z`),
        interestKey: posting.interestKey,
        resultingBalance: posting.resultingBalance,
      });
    }
    if (result.accruedThrough) accruedThrough = result.accruedThrough;
  }
  const total = postedAll.reduce((sum, p) => sum.plus(p.amount), decimal(0));
  return { total, postings: postedAll, accruedThrough };
}

test('R$10 over 252 business days earns R$1.49 (not R$2.52 from per-day cent rounding)', () => {
  const days = businessDays('2026-01-05', 252);
  const { total } = replay({ deposit: '10', days, ratePercent: '0.055131' });

  // Exact compounding: 10 * (1 + 0.00055131)^252 - 10
  const exact = decimal(10)
    .mul(decimal(1).plus('0.00055131').pow(252))
    .minus(10);
  assert.ok(
    total.minus(exact).abs().lt('0.011'),
    `posted ${total.toFixed(2)} vs exact ${exact.toFixed(4)}`,
  );
  // The old algorithm rounded 0.0055 up to 0.01 every day: R$ 2.52.
  assert.ok(total.lt('1.6') && total.gt('1.3'));
});

test('a tiny balance accumulates sub-cent interest and eventually posts a cent', () => {
  // R$5 at 0.055131%/day: 0.00275655/day -> first cent after 4 days.
  const days = businessDays('2026-03-02', 30);
  const { postings, total } = replay({ deposit: '5', days, ratePercent: '0.055131' });
  assert.ok(postings.length > 0);
  assert.ok(total.gte('0.07'));
  for (const posting of postings) {
    assert.equal(posting.amount.decimalPlaces() <= 2, true);
    assert.ok(posting.amount.gt(0));
  }
});

test('the carried fraction is rebuilt from persisted rows across separate runs', () => {
  const days = businessDays('2026-01-05', 120);
  const oneShot = replay({ deposit: '10', days, ratePercent: '0.055131' });
  const stepped = replay({ deposit: '10', days, ratePercent: '0.055131', batches: 6 });
  assert.equal(stepped.total.toFixed(2), oneShot.total.toFixed(2));
  assert.deepEqual(
    stepped.postings.map((p) => [p.day, p.amount.toFixed(2)]),
    oneShot.postings.map((p) => [p.day, p.amount.toFixed(2)]),
  );
});

test('days that post nothing are replayed instead of being marked accrued', () => {
  const days = businessDays('2026-03-02', 2);
  const result = accrueCdiInterest({
    bankId: 'bank',
    transactions: [
      {
        type: 'deposit',
        amount: '5',
        date: new Date('2026-03-02T12:00:00.000Z'),
        interestKey: null,
        resultingBalance: null,
      },
    ],
    accruedThrough: null,
    points: days.map((date) => ({ date, value: '0.055131' })),
    cdiPercent: '100',
    startKey: days[0],
    targetKey: days[1],
  });
  assert.equal(result.postings.length, 0);
  assert.equal(result.accruedThrough, null);
  assert.ok(result.carry.gt(0));
});

test('balances under R$9.10 now earn interest (they never did with per-day rounding)', () => {
  const days = businessDays('2026-01-05', 252);
  const { total } = replay({ deposit: '5', days, ratePercent: '0.055131' });
  assert.ok(total.gt('0.5'));
});

test('first accrual keeps the exact base balance and cents-only amount', () => {
  const result = accrueCdiInterest({
    bankId: 'bank',
    transactions: [
      {
        type: 'deposit',
        amount: '100',
        date: new Date('2026-09-05T12:00:00.000Z'),
        interestKey: null,
        resultingBalance: null,
      },
    ],
    accruedThrough: null,
    points: [{ date: '2026-09-08', value: '0.1' }],
    cdiPercent: '100',
    startKey: '2026-09-08',
    targetKey: '2026-09-08',
  });
  assert.equal(result.postings[0].amount.toFixed(2), '0.10');
  assert.equal(result.postings[0].baseBalance.toFixed(), '100');
  assert.equal(result.accruedThrough, '2026-09-08');
});

test('an already posted day is skipped idempotently', () => {
  const result = accrueCdiInterest({
    bankId: 'bank',
    transactions: [
      {
        type: 'deposit',
        amount: '100',
        date: new Date('2026-09-05T12:00:00.000Z'),
        interestKey: null,
        resultingBalance: null,
      },
      {
        type: 'interest',
        amount: '0.10',
        date: new Date('2026-09-08T12:00:00.000Z'),
        interestKey: 'bank:2026-09-08',
        resultingBalance: '100.10',
      },
    ],
    accruedThrough: '2026-09-07',
    points: [{ date: '2026-09-08', value: '0.1' }],
    cdiPercent: '100',
    startKey: '2026-09-08',
    targetKey: '2026-09-08',
  });
  assert.equal(result.postings.length, 0);
  assert.equal(result.accruedThrough, '2026-09-08');
});
