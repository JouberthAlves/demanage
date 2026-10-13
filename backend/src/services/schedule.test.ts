/* eslint-disable simple-import-sort/imports -- db-env precisa ser o primeiro import (define DATABASE_URL antes de carregar @/lib/prisma) */
import '@/test-support/db-env';

import assert from 'node:assert/strict';
import test from 'node:test';

import { AppError } from '@/http/errors';

import { resolveSchedule } from './schedule';

const empty = {
  day: undefined,
  startsAt: undefined,
  endsAt: undefined,
  date: undefined,
};

function message(fn: () => unknown) {
  try {
    fn();
  } catch (error) {
    if (error instanceof AppError) return `${error.status}:${error.message}`;
    throw error;
  }
  return null;
}

test('recurring creation requires day and start, end is optional', () => {
  const ok = resolveSchedule({
    kind: 'income',
    frequency: 'mensal',
    body: {
      day: 5,
      startsAt: '2026-01-01',
      endsAt: undefined,
      date: undefined,
    },
  });
  assert.equal(ok.day, 5);
  assert.equal(ok.startsAt?.toISOString(), '2026-01-01T00:00:00.000Z');
  assert.equal(ok.endsAt, null);
  assert.equal(ok.date, null);

  assert.equal(
    message(() =>
      resolveSchedule({ kind: 'income', frequency: 'mensal', body: empty }),
    ),
    '400:Informe o dia em que recebe (1-31)',
  );
  assert.equal(
    message(() =>
      resolveSchedule({
        kind: 'expense',
        frequency: 'semanal',
        body: { ...empty, day: 3 },
      }),
    ),
    '400:Informe o mês em que será descontado',
  );
  assert.equal(
    message(() =>
      resolveSchedule({
        kind: 'expense',
        frequency: 'mensal',
        body: {
          day: 3,
          startsAt: '2026-05-01',
          endsAt: '2026-04-01',
          date: undefined,
        },
      }),
    ),
    '400:Data de término deve ser após o primeiro desconto',
  );
  assert.equal(
    message(() =>
      resolveSchedule({
        kind: 'income',
        frequency: 'mensal',
        body: {
          day: 3,
          startsAt: '2026-02-30',
          endsAt: undefined,
          date: undefined,
        },
      }),
    ),
    '400:Mês de recebimento inválido',
  );
});

test('one-off creation requires a valid date and clears the schedule', () => {
  const ok = resolveSchedule({
    kind: 'expense',
    frequency: 'unica',
    body: { ...empty, date: '2026-09-10' },
  });
  assert.equal(ok.date?.toISOString(), '2026-09-10T12:00:00.000Z');
  assert.deepEqual([ok.day, ok.startsAt, ok.endsAt], [null, null, null]);
  assert.equal(
    message(() =>
      resolveSchedule({ kind: 'expense', frequency: 'unica', body: empty }),
    ),
    '400:Informe uma data válida para a despesa avulsa',
  );
  assert.equal(
    message(() =>
      resolveSchedule({
        kind: 'income',
        frequency: 'unica',
        body: { ...empty, date: '2026-02-30' },
      }),
    ),
    '400:Informe a data da entrada única',
  );
});

test('patch keeps stored values untouched and merges the end check', () => {
  const existing = {
    day: 10,
    startsAt: new Date('2026-03-01T00:00:00.000Z'),
    endsAt: null,
    date: null,
  };
  const untouched = resolveSchedule({
    kind: 'income',
    frequency: 'mensal',
    body: empty,
    existing,
  });
  assert.deepEqual(
    [untouched.day, untouched.startsAt, untouched.endsAt],
    [undefined, undefined, undefined],
  );
  assert.equal(untouched.date, null);

  assert.equal(
    message(() =>
      resolveSchedule({
        kind: 'income',
        frequency: 'mensal',
        body: { ...empty, endsAt: '2026-02-01' },
        existing,
      }),
    ),
    '400:Data de término deve ser após o primeiro recebimento',
  );
  const cleared = resolveSchedule({
    kind: 'income',
    frequency: 'mensal',
    body: { ...empty, endsAt: null },
    existing: { ...existing, endsAt: new Date('2026-12-01T00:00:00.000Z') },
  });
  assert.equal(cleared.endsAt, null);
});

test('patch to a recurring frequency needs the missing stored fields', () => {
  assert.equal(
    message(() =>
      resolveSchedule({
        kind: 'expense',
        frequency: 'mensal',
        body: empty,
        existing: { day: null, startsAt: null, endsAt: null, date: new Date() },
      }),
    ),
    '400:Informe o dia em que será descontado (1-31)',
  );
  // unica -> unica sem nova data mantém a existente; sem data armazenada falha.
  assert.equal(
    resolveSchedule({
      kind: 'expense',
      frequency: 'unica',
      body: empty,
      existing: { day: null, startsAt: null, endsAt: null, date: new Date() },
    }).date,
    undefined,
  );
  assert.equal(
    message(() =>
      resolveSchedule({
        kind: 'expense',
        frequency: 'unica',
        body: empty,
        existing: { day: 1, startsAt: new Date(), endsAt: null, date: null },
      }),
    ),
    '400:Informe uma data válida para a despesa avulsa',
  );
});
