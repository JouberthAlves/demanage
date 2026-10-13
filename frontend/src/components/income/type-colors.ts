import type { IncomeType } from '@/types/finance';

export const typeColors: Record<IncomeType, string> = {
  salario: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  freelance: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  outro: 'bg-zinc-500/15 text-zinc-300 border-zinc-500/30',
};
