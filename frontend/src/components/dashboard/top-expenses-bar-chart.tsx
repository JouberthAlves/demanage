import { Eye, EyeOff, Receipt } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from 'recharts';

import { Button } from '@/components/ui/button';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import {
  EXPENSE_CATEGORY_COLORS,
  EXPENSE_CATEGORY_LABELS,
  monthlyAmount,
} from '@/data/labels';
import { formatCurrency } from '@/lib/format';
import { useFinanceStore } from '@/stores/finance-store';

const TOP_COUNT = 5;

const chartConfig = {
  amount: {
    label: 'Valor',
  },
} satisfies ChartConfig;

type CategoryBucket = {
  key: string;
  name: string;
  color: string;
  amount: number;
  items: { id: string; name: string; amount: number }[];
};

function truncateLabel(value: string, max = 18) {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

function CategoryBarChart({
  data,
  colorMode,
}: {
  data: { key: string; name: string; amount: number; color?: string }[];
  colorMode: 'per-row' | 'solid';
}) {
  const solidColor = data[0]?.color;

  return (
    <ChartContainer config={chartConfig} className='h-64 w-full aspect-auto'>
      <BarChart
        accessibilityLayer
        data={data}
        layout='vertical'
        margin={{ left: 4, right: 12, top: 8, bottom: 8 }}
      >
        <CartesianGrid horizontal={false} strokeDasharray='3 3' />
        <XAxis
          type='number'
          dataKey='amount'
          tickLine={false}
          axisLine={false}
          tickFormatter={(value) => formatCurrency(Number(value))}
        />
        <YAxis
          type='category'
          dataKey='name'
          width={112}
          tickLine={false}
          axisLine={false}
          tickFormatter={(value) => truncateLabel(String(value))}
        />
        <ChartTooltip
          cursor={{ fill: 'rgba(255,255,255,0.04)' }}
          content={
            <ChartTooltipContent
              hideLabel
              formatter={(value, _name, item) => (
                <div className='flex w-full items-center justify-between gap-4'>
                  <span className='flex items-center gap-2 text-muted-foreground'>
                    <span
                      className='size-2.5 shrink-0 rounded-sm'
                      style={{
                        backgroundColor: String(
                          item?.payload?.color ?? solidColor ?? '',
                        ),
                      }}
                    />
                    {String(item?.payload?.name ?? 'Item')}
                  </span>
                  <span className='font-medium tabular-nums text-foreground'>
                    {formatCurrency(Number(value))}
                  </span>
                </div>
              )}
            />
          }
        />
        <Bar
          dataKey='amount'
          fill={colorMode === 'solid' ? solidColor : undefined}
          radius={[0, 6, 6, 0]}
          maxBarSize={28}
        >
          {colorMode === 'per-row'
            ? data.map((entry) => (
                <Cell key={entry.key} fill={entry.color} />
              ))
            : null}
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}

export function TopExpensesBarChart() {
  const expenses = useFinanceStore((state) => state.expenses);
  const [showItems, setShowItems] = useState(false);

  const categories = useMemo(() => {
    const grouped = expenses
      .filter((expense) => !expense.isInvoice)
      .reduce<Record<string, CategoryBucket>>((acc, expense) => {
        const amount =
          expense.frequency === 'unica'
            ? expense.amount
            : monthlyAmount(expense.amount, expense.frequency);
        if (amount <= 0) return acc;

        const key = expense.customTag
          ? `tag:${expense.customTag.id}`
          : expense.category;
        const name = expense.customTag
          ? expense.customTag.name
          : EXPENSE_CATEGORY_LABELS[expense.category];
        const color = expense.customTag
          ? expense.customTag.color
          : EXPENSE_CATEGORY_COLORS[expense.category];

        const current = acc[key] ?? {
          key,
          name,
          color,
          amount: 0,
          items: [],
        };

        current.amount += amount;
        current.items.push({
          id: expense.id,
          name: expense.name,
          amount,
        });
        acc[key] = current;
        return acc;
      }, {});

    return Object.values(grouped)
      .map((category) => ({
        ...category,
        items: [...category.items].sort((a, b) => b.amount - a.amount),
      }))
      .sort((a, b) => b.amount - a.amount);
  }, [expenses]);

  const summaryData = categories.slice(0, TOP_COUNT).map((category) => ({
    key: category.key,
    name: category.name,
    amount: category.amount,
    color: category.color,
  }));

  if (categories.length === 0) {
    return (
      <div className='flex h-72 flex-col items-center justify-center gap-3 px-6 text-center'>
        <div className='flex size-12 items-center justify-center rounded-2xl bg-neon-amber/10'>
          <Receipt className='size-6 text-neon-amber' />
        </div>
        <div className='flex flex-col gap-1'>
          <p className='font-medium'>Nenhuma categoria para rankear</p>
          <p className='text-sm text-muted-foreground'>
            Cadastre despesas para ver as maiores por categoria.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className='flex flex-col gap-3'>
      <div className='flex items-center justify-end'>
        <Button
          type='button'
          variant={showItems ? 'secondary' : 'ghost'}
          size='icon-sm'
          className='rounded-lg'
          aria-pressed={showItems}
          aria-label={
            showItems
              ? 'Ocultar itens por categoria'
              : 'Ver itens por categoria'
          }
          title={
            showItems
              ? 'Ocultar itens por categoria'
              : 'Ver itens por categoria'
          }
          onClick={() => setShowItems((current) => !current)}
        >
          {showItems ? <EyeOff /> : <Eye />}
        </Button>
      </div>

      {showItems ? (
        <div className='flex flex-col gap-5'>
          {categories.map((category) => (
            <div
              key={category.key}
              className='rounded-xl border border-border/60 bg-black/15 p-3'
            >
              <div className='mb-2 flex items-center justify-between gap-3'>
                <div className='flex items-center gap-2 min-w-0'>
                  <span
                    className='size-2.5 shrink-0 rounded-sm'
                    style={{ backgroundColor: category.color }}
                  />
                  <p className='truncate font-medium'>{category.name}</p>
                </div>
                <p className='shrink-0 text-sm tabular-nums text-muted-foreground'>
                  {formatCurrency(category.amount)}
                </p>
              </div>
              <CategoryBarChart
                colorMode='solid'
                data={category.items.map((item) => ({
                  key: item.id,
                  name: item.name,
                  amount: item.amount,
                  color: category.color,
                }))}
              />
            </div>
          ))}
        </div>
      ) : (
        <CategoryBarChart colorMode='per-row' data={summaryData} />
      )}
    </div>
  );
}
