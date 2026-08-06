import type { CSSProperties } from 'react';

import type {
  ExpenseCategory,
  ExpenseFrequency,
  Income,
  IncomeFrequency,
  RecurringExpense,
} from '@/types/finance';

export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  assinatura: 'Assinatura',
  parcela: 'Parcela',
  divida: 'Dívida',
  outro: 'Outro',
};

export const EXPENSE_CATEGORY_COLORS: Record<ExpenseCategory, string> = {
  assinatura: '#60A5FA',
  parcela: '#FFB800',
  divida: '#F43F5E',
  outro: '#A3A3A3',
};

/** Categorias pré-definidas no select (sem "Outro", que abre o modal). */
export const BUILTIN_EXPENSE_CATEGORY_LABELS: Record<
  Exclude<ExpenseCategory, 'outro'>,
  string
> = {
  assinatura: 'Assinatura',
  parcela: 'Parcela',
  divida: 'Dívida',
};

export const EXPENSE_FREQUENCY_LABELS: Record<ExpenseFrequency, string> = {
  mensal: 'Mensal',
  semanal: 'Semanal',
  unica: 'Única',
};

export const INCOME_TYPE_LABELS: Record<Income['type'], string> = {
  salario: 'Salário',
  freelance: 'Freelance',
  outro: 'Outro',
};

/** Tipos pré-definidos no select de Entradas (sem "Outro"). */
export const BUILTIN_INCOME_TYPE_LABELS: Record<
  Exclude<Income['type'], 'salario' | 'outro'>,
  string
> = {
  freelance: 'Freelance',
};

export const INCOME_FREQUENCY_LABELS: Record<IncomeFrequency, string> = {
  mensal: 'Mensal',
  semanal: 'Semanal',
  unica: 'Única',
};

export const MONTH_LABELS: Record<number, string> = {
  1: 'Janeiro',
  2: 'Fevereiro',
  3: 'Março',
  4: 'Abril',
  5: 'Maio',
  6: 'Junho',
  7: 'Julho',
  8: 'Agosto',
  9: 'Setembro',
  10: 'Outubro',
  11: 'Novembro',
  12: 'Dezembro',
};

export const MONTH_OPTIONS = Object.entries(MONTH_LABELS).map(
  ([value, label]) => ({
    value: Number(value),
    label,
  }),
);

export const TAG_COLOR_OPTIONS = [
  '#60A5FA',
  '#FFB800',
  '#34D399',
  '#F43F5E',
  '#A78BFA',
  '#FB7185',
  '#22D3EE',
  '#A3A3A3',
  '#F97316',
  '#E879F9',
] as const;

export function tagBadgeStyle(color: string): CSSProperties {
  return {
    borderColor: `${color}55`,
    backgroundColor: `${color}22`,
    color,
  };
}

export function monthlyAmount(
  amount: number,
  frequency: ExpenseFrequency | IncomeFrequency,
) {
  if (frequency === 'semanal') return amount * 4;
  if (frequency === 'unica') return 0;
  return amount;
}

export function expenseTypeLabel(expense: RecurringExpense) {
  if (expense.customTag) return expense.customTag.name;
  return EXPENSE_CATEGORY_LABELS[expense.category];
}

export function incomeTypeLabel(income: Income) {
  if (income.customTag) return income.customTag.name;
  return INCOME_TYPE_LABELS[income.type];
}
