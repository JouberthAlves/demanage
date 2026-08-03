import {
  Cell,
  PolarAngleAxis,
  RadialBar,
  RadialBarChart,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';

import { formatCurrency, formatPercent } from '@/lib/format';
import { useFinanceStore } from '@/stores/finance-store';

function hexToRgb(hex: string) {
  const value = hex.replace('#', '');
  return {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16),
  };
}

function mixHex(from: string, to: string, amount: number) {
  const start = hexToRgb(from);
  const end = hexToRgb(to);
  const t = Math.min(1, Math.max(0, amount));
  const channel = (a: number, b: number) => Math.round(a + (b - a) * t);
  const toHex = (n: number) => n.toString(16).padStart(2, '0');

  return `#${toHex(channel(start.r, end.r))}${toHex(channel(start.g, end.g))}${toHex(channel(start.b, end.b))}`;
}

/** Verde → lima → âmbar conforme sobe o %; vermelho se estourar. */
function commitmentColor(percent: number) {
  if (percent >= 100) return '#F43F5E';

  const t = Math.min(1, Math.max(0, percent / 100));

  if (t < 0.5) {
    return mixHex('#34D399', '#A3E635', t / 0.5);
  }

  return mixHex('#A3E635', '#FFB800', (t - 0.5) / 0.5);
}

export function CardCommitmentChart() {
  const cards = useFinanceStore((state) => state.profile.cards);
  const expenses = useFinanceStore((state) => state.expenses);

  const data = cards
    .filter((card) => card.limit != null && card.limit > 0)
    .map((card) => {
      const committed = expenses
        .filter((expense) => expense.cardId === card.id)
        .reduce((sum, expense) => sum + expense.amount, 0);
      const percent = (committed / (card.limit as number)) * 100;

      return {
        name: card.name,
        percent: Number(percent.toFixed(1)),
        display: Math.min(percent, 100),
        committed,
        limit: card.limit as number,
        fill: commitmentColor(percent),
      };
    });

  if (data.length === 0) {
    return (
      <div className='flex h-72 items-center justify-center text-sm text-muted-foreground'>
        Cadastre cartões com limite e vincule despesas para ver o comprometimento.
      </div>
    );
  }

  const average =
    data.reduce((sum, item) => sum + item.percent, 0) / data.length;

  return (
    <div className='flex h-72 flex-col items-center justify-center gap-4'>
      <div className='relative h-48 w-full'>
        <ResponsiveContainer width='100%' height='100%'>
          <RadialBarChart
            cx='50%'
            cy='50%'
            innerRadius='35%'
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
              clockWise
            >
              {data.map((entry) => (
                <Cell key={entry.name} fill={entry.fill} />
              ))}
            </RadialBar>
            <Tooltip
              contentStyle={{
                background: '#111',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 12,
              }}
              formatter={(_value, _name, item) => {
                const payload = item?.payload as
                  | {
                      name: string;
                      committed: number;
                      limit: number;
                      percent: number;
                    }
                  | undefined;
                if (!payload) return [String(_value), 'Comprometido'];

                return [
                  `${formatPercent(payload.percent / 100)} (${formatCurrency(payload.committed)} de ${formatCurrency(payload.limit)})`,
                  payload.name,
                ];
              }}
            />
          </RadialBarChart>
        </ResponsiveContainer>
        <div className='pointer-events-none absolute inset-0 flex flex-col items-center justify-center'>
          <span className='text-xs text-muted-foreground'>Média</span>
          <span className='text-sm font-semibold'>
            {formatPercent(average / 100)}
          </span>
        </div>
      </div>

      <div className='w-full space-y-2'>
        {data.map((item) => (
          <div
            key={item.name}
            className='flex items-center justify-between text-sm'
          >
            <div className='flex items-center gap-2'>
              <span
                className='size-2.5 rounded-sm'
                style={{ backgroundColor: item.fill }}
              />
              <span className='text-muted-foreground'>{item.name}</span>
            </div>
            <span className='font-medium'>
              {formatPercent(item.percent / 100)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
