import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';

import { EXPENSE_CATEGORY_LABELS } from '@/data/labels';
import { expenseContributionThisMonth } from '@/lib/expense-schedule';
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

  const grouped = expenses.reduce<
    Record<string, { name: string; color: string; value: number }>
  >((acc, expense) => {
    const value = expenseContributionThisMonth(expense);
    if (value <= 0) return acc;

    const key = expense.customTag
      ? `tag:${expense.customTag.id}`
      : expense.category;
    const name = expense.customTag
      ? expense.customTag.name
      : EXPENSE_CATEGORY_LABELS[expense.category];
    const color = expense.customTag
      ? expense.customTag.color
      : COLORS[expense.category];

    const current = acc[key];
    acc[key] = {
      name,
      color,
      value: (current?.value ?? 0) + value,
    };
    return acc;
  }, {});

  const data = Object.entries(grouped).map(([key, item]) => ({
    key,
    ...item,
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
                <Cell key={entry.key} fill={entry.color} />
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
            key={item.key}
            className='flex items-center justify-between text-sm'
          >
            <div className='flex items-center gap-2'>
              <span
                className='size-2.5 rounded-sm'
                style={{ backgroundColor: item.color }}
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
