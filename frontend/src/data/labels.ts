import type { Income, RecurringExpense } from '@/types/finance';

export const EXPENSE_CATEGORY_LABELS: Record<
  RecurringExpense['category'],
  string
> = {
  assinatura: 'Assinatura',
  parcela: 'Parcela',
  divida: 'Dívida',
  outro: 'Outro',
};

export const INCOME_TYPE_LABELS: Record<Income['type'], string> = {
  salario: 'Salário',
  freelance: 'Freelance',
  outro: 'Outro',
};

export const INCOME_FREQUENCY_LABELS: Record<Income['frequency'], string> = {
  mensal: 'Mensal',
  unica: 'Única',
};
