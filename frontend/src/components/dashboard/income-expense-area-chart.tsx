import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { formatCurrency, formatMonthLabel } from '@/lib/format';
import {
  selectMonthlyExpenses,
  selectMonthlyIncome,
  useFinanceStore,
} from '@/stores/finance-store';

export function IncomeExpenseAreaChart() {
  const history = useFinanceStore((state) => state.history);
  const currentIncome = useFinanceStore(selectMonthlyIncome);
  const currentExpense = useFinanceStore(selectMonthlyExpenses);

  const data = history.map((item, index) => {
    const isLast = index === history.length - 1;
    return {
      label: formatMonthLabel(item.month),
      income: isLast ? currentIncome : item.income,
      expense: isLast ? currentExpense : item.expense,
    };
  });

  return (
    <div className='h-72 w-full'>
      <ResponsiveContainer width='100%' height='100%'>
        <AreaChart
          data={data}
          margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
        >
          <defs>
            <linearGradient id='incomeFill' x1='0' y1='0' x2='0' y2='1'>
              <stop offset='5%' stopColor='#FFB800' stopOpacity={0.35} />
              <stop offset='95%' stopColor='#FFB800' stopOpacity={0} />
            </linearGradient>
            <linearGradient id='expenseFill' x1='0' y1='0' x2='0' y2='1'>
              <stop offset='5%' stopColor='#34D399' stopOpacity={0.3} />
              <stop offset='95%' stopColor='#34D399' stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke='rgba(255,255,255,0.06)' vertical={false} />
          <XAxis
            dataKey='label'
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
            labelStyle={{ color: '#f5f5f5' }}
            formatter={(value) => formatCurrency(Number(value))}
          />
          <Area
            type='monotone'
            dataKey='income'
            name='Entradas'
            stroke='#FFB800'
            fill='url(#incomeFill)'
            strokeWidth={2.5}
            className='neon-line-amber'
          />
          <Area
            type='monotone'
            dataKey='expense'
            name='Saídas'
            stroke='#34D399'
            fill='url(#expenseFill)'
            strokeWidth={2.5}
            className='neon-line-green'
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
