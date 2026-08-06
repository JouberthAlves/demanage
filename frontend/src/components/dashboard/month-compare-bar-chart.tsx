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

import { formatCurrency } from '@/lib/format';
import {
  selectMonthlyExpenses,
  selectMonthlyIncome,
  useFinanceStore,
} from '@/stores/finance-store';

export function MonthCompareBarChart() {
  const history = useFinanceStore((state) => state.history);
  const currentIncome = useFinanceStore(selectMonthlyIncome);
  const currentExpense = useFinanceStore(selectMonthlyExpenses);

  const previous = history[history.length - 2];

  if (!previous) {
    return (
      <div className='flex h-72 flex-col items-center justify-center gap-3 px-6 text-center'>
        <div className='flex size-12 items-center justify-center rounded-2xl bg-neon-green/10'>
          <CalendarClock className='size-6 text-neon-green' />
        </div>
        <div className='space-y-1'>
          <p className='font-medium'>Histórico mensal em breve</p>
          <p className='text-sm text-muted-foreground'>
            Ainda não há mês anterior para comparar. Este mês:{' '}
            {formatCurrency(currentIncome)} / {formatCurrency(currentExpense)}.
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
            formatter={(value) => formatCurrency(Number(value))}
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
