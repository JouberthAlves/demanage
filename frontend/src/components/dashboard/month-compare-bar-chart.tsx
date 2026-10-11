import { CalendarClock } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { formatCurrencyCompact } from '@/lib/format';
import type { MonthlySnapshot } from '@/types/finance';

export function MonthCompareBarChart({
  history,
}: {
  history: MonthlySnapshot[];
}) {
  const currentMonth = history[history.length - 1];
  const currentIncome = currentMonth?.income ?? 0;
  const currentExpense = currentMonth?.expense ?? 0;

  const previous = history[history.length - 2];

  if (!previous?.hasActivity) {
    return (
      <div className='flex h-72 flex-col items-center justify-center gap-3 px-6 text-center'>
        <div className='flex size-12 items-center justify-center rounded-2xl bg-neon-green/10'>
          <CalendarClock className='size-6 text-neon-green' />
        </div>
        <div className='space-y-1'>
          <p className='font-medium'>
            Ainda não há pagamentos ou recebimentos anteriores
          </p>
          <p className='text-sm text-muted-foreground'>
            A comparação aparece quando houver movimentações registradas em um
            mês anterior. Este mês: {formatCurrencyCompact(currentIncome)}{' '}
            recebidos · {formatCurrencyCompact(currentExpense)} pagos.
          </p>
        </div>
      </div>
    );
  }

  const data = [
    {
      name: 'Entradas',
      atual: currentIncome,
      anterior: previous.income,
    },
    {
      name: 'Saídas',
      atual: currentExpense,
      anterior: previous.expense,
    },
  ];

  return (
    <div className='h-72 w-full'>
      <ResponsiveContainer width='100%' height='100%'>
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke='rgba(255,255,255,0.06)' vertical={false} />
          <XAxis
            dataKey='name'
            tickLine={false}
            axisLine={false}
            tick={{ fill: '#a3a3a3', fontSize: 12 }}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            tick={{ fill: '#a3a3a3', fontSize: 12 }}
            tickFormatter={(value) =>
              new Intl.NumberFormat('pt-BR', {
                notation: 'compact',
                compactDisplay: 'short',
              }).format(Number(value))
            }
          />
          <Tooltip
            contentStyle={{
              background: '#111',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 12,
            }}
            formatter={(value) => formatCurrencyCompact(Number(value))}
          />
          <Legend />
          <Bar
            dataKey='atual'
            name='Este mês'
            fill='#FFB800'
            radius={[6, 6, 0, 0]}
          />
          <Bar
            dataKey='anterior'
            name='Mês passado'
            fill='#34D399'
            radius={[6, 6, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
