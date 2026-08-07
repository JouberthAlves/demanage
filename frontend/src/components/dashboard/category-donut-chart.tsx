import { useState } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts';

import {
  EXPENSE_CATEGORY_COLORS,
  EXPENSE_CATEGORY_LABELS,
} from '@/data/labels';
import { expenseContributionThisMonth } from '@/lib/expense-schedule';
import { formatCurrencyCompact } from '@/lib/format';
import { useFinanceStore } from '@/stores/finance-store';

type DonutItem = {
  key: string;
  name: string;
  color: string;
  value: number;
};

export function CategoryDonutChart() {
  const expenses = useFinanceStore((state) => state.expenses);
  const [active, setActive] = useState<DonutItem | null>(null);

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
      : EXPENSE_CATEGORY_COLORS[expense.category];

    const current = acc[key];
    acc[key] = {
      name,
      color,
      value: (current?.value ?? 0) + value,
    };
    return acc;
  }, {});

  const data: DonutItem[] = Object.entries(grouped).map(([key, item]) => ({
    key,
    ...item,
  }));

  const total = data.reduce((sum, item) => sum + item.value, 0);
  const totalLabel = formatCurrencyCompact(total);

  return (
    <div className='flex h-72 flex-col items-center justify-center gap-4'>
      <div className='relative h-48 w-full'>
        <div className='pointer-events-none absolute inset-0 z-0 flex flex-col items-center justify-center px-10'>
          <span className='text-[10px] text-muted-foreground'>Total</span>
          <span
            title={totalLabel}
            className='max-w-[6.5rem] overflow-hidden text-ellipsis whitespace-nowrap text-sm font-semibold tabular-nums'
          >
            {totalLabel}
          </span>
        </div>
        <div className='relative z-10 h-full w-full'>
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
                onMouseEnter={(_, index) => setActive(data[index] ?? null)}
                onMouseLeave={() => setActive(null)}
              >
                {data.map((entry) => (
                  <Cell key={entry.key} fill={entry.color} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        </div>
        {active ? (
          <div className='pointer-events-none absolute inset-x-0 top-0 z-20 flex justify-center'>
            <div className='max-w-[90%] truncate rounded-xl border border-white/10 bg-[#111] px-3 py-1.5 text-sm shadow-lg'>
              <span className='text-muted-foreground'>{active.name}</span>
              <span className='mx-1.5 text-muted-foreground'>·</span>
              <span
                className='font-medium tabular-nums'
                style={{ color: active.color }}
              >
                {formatCurrencyCompact(active.value)}
              </span>
            </div>
          </div>
        ) : null}
      </div>

      <div className='w-full space-y-2'>
        {data.map((item) => (
          <div
            key={item.key}
            className='flex items-center justify-between gap-3 text-sm'
          >
            <div className='flex min-w-0 items-center gap-2'>
              <span
                className='size-2.5 shrink-0 rounded-sm'
                style={{ backgroundColor: item.color }}
              />
              <span className='min-w-0 truncate text-muted-foreground'>
                {item.name}
              </span>
            </div>
            <span className='shrink-0 font-medium tabular-nums'>
              {formatCurrencyCompact(item.value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
