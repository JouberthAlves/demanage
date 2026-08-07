import {
  Cell,
  PolarAngleAxis,
  RadialBar,
  RadialBarChart,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';

import { getCardTone } from '@/lib/card-tone';
import { expenseCardCommittedAmount } from '@/lib/expense-splits';
import { formatCurrencyCompact, formatPercent } from '@/lib/format';
import { useFinanceStore } from '@/stores/finance-store';

export function CardCommitmentChart() {
  const cards = useFinanceStore((state) => state.profile.cards);
  const expenses = useFinanceStore((state) => state.expenses);

  const data = cards
    .filter((card) => card.limit != null && card.limit > 0)
    .map((card) => {
      const committed = expenses.reduce(
        (sum, expense) =>
          sum + expenseCardCommittedAmount(expense, card.id),
        0,
      );
      const percent = (committed / (card.limit as number)) * 100;
      const tone = getCardTone(card);

      return {
        id: card.id,
        name: card.name,
        expired: Boolean(card.expired),
        percent: Number(percent.toFixed(1)),
        display: Math.min(Math.max(percent, 0), 100),
        committed,
        limit: card.limit as number,
        fill: tone.fill,
      };
    });

  if (data.length === 0) {
    return (
      <div className='flex h-72 items-center justify-center text-sm text-muted-foreground'>
        Cadastre cartões com limite e vincule despesas para ver o
        comprometimento.
      </div>
    );
  }

  const average =
    data.reduce((sum, item) => sum + item.percent, 0) / data.length;

  return (
    <div className='flex h-72 flex-col items-center justify-center gap-4'>
      <div className='relative h-48 w-full'>
        <div className='pointer-events-none absolute inset-0 z-0 flex flex-col items-center justify-center'>
          <span className='text-sm text-muted-foreground'>Média</span>
          <span className='text-lg font-semibold tabular-nums'>
            {formatPercent(average / 100)}
          </span>
        </div>
        <div className='relative z-10 h-full w-full'>
          <ResponsiveContainer width='100%' height='100%'>
            <RadialBarChart
              cx='50%'
              cy='50%'
              innerRadius='48%'
              outerRadius='100%'
              data={data}
              startAngle={90}
              endAngle={-270}
            >
              <PolarAngleAxis type='number' domain={[0, 100]} tick={false} />
              <RadialBar
                dataKey='display'
                background={{ fill: 'rgba(255,255,255,0.06)' }}
                cornerRadius={6}
              >
                {data.map((entry) => (
                  <Cell key={entry.id} fill={entry.fill} />
                ))}
              </RadialBar>
              <Tooltip
                cursor={false}
                wrapperStyle={{ zIndex: 50, outline: 'none' }}
                content={({ active, payload }) => {
                  if (!active || !payload?.[0]) return null;

                  const item = payload[0].payload as {
                    name: string;
                    committed: number;
                    limit: number;
                    percent: number;
                    fill: string;
                  };

                  return (
                    <div className='max-w-56 rounded-xl border border-white/10 bg-[#111] px-3 py-2 text-sm text-foreground shadow-lg'>
                      <div className='flex min-w-0 items-center gap-2 font-medium'>
                        <span
                          className='size-2.5 shrink-0 rounded-sm'
                          style={{ backgroundColor: item.fill }}
                        />
                        <span className='min-w-0 break-all [overflow-wrap:anywhere]'>
                          {item.name}
                        </span>
                      </div>
                      <p className='mt-1 text-muted-foreground'>
                        {formatPercent(item.percent / 100)}
                        {' · '}
                        {formatCurrencyCompact(item.committed)} de{' '}
                        {formatCurrencyCompact(item.limit)}
                      </p>
                    </div>
                  );
                }}
              />
            </RadialBarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className='w-full space-y-2'>
        {data.map((item) => (
          <div
            key={item.id}
            className='flex items-center justify-between gap-3 text-sm'
          >
            <div className='flex min-w-0 items-center gap-2'>
              <span
                className='size-2.5 shrink-0 rounded-sm'
                style={{ backgroundColor: item.fill }}
              />
              <span className='truncate text-muted-foreground'>
                {item.name}
                {item.expired ? (
                  <span className='ml-1 text-rose-400'>(vencido)</span>
                ) : null}
              </span>
            </div>
            <span className='shrink-0 font-medium'>
              {formatPercent(item.percent / 100)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
