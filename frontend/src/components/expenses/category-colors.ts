import type { ExpenseCategory } from '@/types/finance';

export const categoryColors: Record<ExpenseCategory, string> = {
  assinatura: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  parcela: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  divida: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
  outro: 'bg-zinc-500/15 text-zinc-300 border-zinc-500/30',
  cofrinho: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
  investimento: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
};
