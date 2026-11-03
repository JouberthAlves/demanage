import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function component(path: string) {
  return readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');
}

test('failed patrimony and currencies requests expose retry actions with accessible alerts and pending feedback', () => {
  const patrimony = component('pages/patrimony-page.tsx');
  const currencies = component('pages/currencies-page.tsx');
  for (const source of [patrimony, currencies]) {
    assert.match(source, /role='alert'/);
    assert.match(source, /Tentar novamente/);
    assert.match(source, /\.refetch\(\)/);
    assert.match(source, /disabled=\{[^}]*\.isFetching\}/);
  }
});

test('expense confirmation dialogs preserve pending mutations and suppress Radix auto-dismiss', () => {
  const dialogs = component('components/expenses/expense-confirm-dialogs.tsx');
  const actions = component('components/expenses/use-expense-actions.ts');
  const page = component('pages/expenses-page.tsx');
  assert.match(dialogs, /event\.preventDefault\(\)/);
  assert.match(dialogs, /disabled=\{pending\}/);
  assert.match(dialogs, /if \(!open && !pending\) onCancel\(\)/);
  assert.match(actions, /await pay\(target\)/);
  assert.match(actions, /await remove\(target\)/);
  assert.match(page, /onConfirm=\{actions\.runPay\}/);
  assert.match(page, /onConfirm=\{actions\.runDelete\}/);
});

test('card deletion only disables its own tile', () => {
  const source = component('components/profile/cards-section.tsx');
  assert.match(source, /deleting=\{deletingIds\.has\(card\.id\)\}/);
});

test('dialog actions are localized and income/expense chart follows KPI semantics', () => {
  const dialog = component('components/ui/dialog.tsx');
  const chart = component('components/dashboard/income-expense-area-chart.tsx');
  assert.doesNotMatch(dialog, />Close</);
  assert.match(dialog, />Fechar</);
  assert.match(chart, /dataKey='income'[\s\S]*?stroke='#34D399'/);
  assert.match(chart, /dataKey='expense'[\s\S]*?stroke='#FFB800'/);
});
