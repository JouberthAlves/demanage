import assert from 'node:assert/strict';
import test from 'node:test';

import { validateFinancialDraft } from './finance-preview-validate';

test('ambiguous deposit must ask whether it affects cash balance', () => {
  const questions = validateFinancialDraft({
    kind: 'deposit_existing_cash',
    amountCents: 2_000,
    dateKey: '2026-10-16',
    bankId: 'bank-porco',
  });
  assert.ok(questions.some((question) => /descontar|saldo/i.test(question)));
});

test('received gift with an explicit tag, description, bank and date is unambiguous', () => {
  assert.deepEqual(
    validateFinancialDraft({
      kind: 'receive_and_save',
      amountCents: 2_000,
      dateKey: '2026-10-16',
      bankId: 'bank-porco',
      description: 'Presente da minha vó',
      tagName: 'Presente',
    }),
    [],
  );
});

test('missing date, source or destination is not silently assumed', () => {
  const unknown = validateFinancialDraft({ kind: 'deposit_existing_cash', amountCents: 2_000 });
  assert.ok(unknown.some((question) => /data/i.test(question)));
  assert.ok(unknown.some((question) => /cofrinho/i.test(question)));
  assert.ok(unknown.some((question) => /descontar|saldo/i.test(question)));

  assert.ok(validateFinancialDraft({ kind: 'receive_income', amountCents: -1 }).length > 0);
  assert.ok(validateFinancialDraft({ kind: 'receive_income', amountCents: 2_000, dateKey: '2026-02-30' }).some((question) => /data/i.test(question)));
});

test('contradictory structured intent asks instead of silently dropping a transfer', () => {
  const base = {
    amountCents: 2_000,
    dateKey: '2026-10-16',
    description: 'Presente da minha vó',
    tagName: 'Presente',
    bankId: 'bank-porco',
  };
  assert.ok(
    validateFinancialDraft({ ...base, kind: 'receive_income' }).some((question) =>
      /cofrinho|guardar|transferir/i.test(question),
    ),
  );
  assert.ok(
    validateFinancialDraft({ ...base, kind: 'receive_and_save', deductFromBalance: false }).some(
      (question) => /saldo|descontar/i.test(question),
    ),
  );
});
