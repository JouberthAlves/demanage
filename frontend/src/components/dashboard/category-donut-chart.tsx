import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';

import { EXPENSE_CATEGORY_LABELS } from '@/data/seed';
import { formatCurrency } from '@/lib/format';
import { useFinanceStore } from '@/stores/finance-store';
import type { ExpenseCategory } from '@/types/finance';

const COLORS: Record<ExpenseCategory, string> = {
  assinatura: '#60A5FA',
  parcela: '#FFB800',
  divida: '#F43F5E',
  outro: '#A3A3A3',
};

export function CategoryDonutChart() {
  const expenses = useFinanceStore((state) => state.expenses);

  const grouped = expenses.reduce<Record<string, number>>((acc, expense) => {
    acc[expense.category] = (acc[expense.category] ?? 0) + expense.amount;
    return acc;
  }, {});

  const data = Object.entries(grouped).map(([category, value]) => ({
    name: EXPENSE_CATEGORY_LABELS[category as ExpenseCategory],
    category: category as ExpenseCategory,
    value,
  }));

  const total = data.reduce((sum, item) => sum + item.value, 0);

  return (
    <div className='flex h-72 flex-col items-center justify-center gap-4'>
      <div className='relative h-48 w-full'>
        <ResponsiveContainer width='100%' height='100%'>
          <PieChart>
            <Pie
              data={data}
              dataKey='value'
              nameKey='name'
              innerRadius={55}
              outerRadius={80}
              paddingAngle={3}
              stroke='transparent'
            >
              {data.map((entry) => (
                <Cell key={entry.category} fill={COLORS[entry.category]} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                background: '#111',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 12,
              }}
              formatter={(value) => formatCurrency(Number(value))}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className='pointer-events-none absolute inset-0 flex flex-col items-center justify-center'>
          <span className='text-xs text-muted-foreground'>Total</span>
          <span className='text-sm font-semibold'>{formatCurrency(total)}</span>
        </div>
      </div>

      <div className='w-full space-y-2'>
        {data.map((item) => (
          <div
            key={item.category}
            className='flex items-center justify-between text-sm'
          >
            <div className='flex items-center gap-2'>
              <span
                className='size-2.5 rounded-sm'
                style={{ backgroundColor: COLORS[item.category] }}
              />
              <span className='text-muted-foreground'>{item.name}</span>
            </div>
            <span className='font-medium'>{formatCurrency(item.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
