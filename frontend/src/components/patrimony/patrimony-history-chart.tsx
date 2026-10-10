import { useMemo } from 'react';
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts';

import {
  formatAxisDate,
  formatAxisValue,
  paddedYDomain,
} from '@/components/charts/chart-format';
import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';
import { formatCurrency } from '@/lib/format';

type ChartRow = {
  date: string;
  patrimonio: number;
  cdi: number;
  ipca: number;
};

const chartConfig = {
  patrimonio: {
    label: 'Patrimônio',
    color: 'var(--chart-2)',
  },
  cdi: {
    label: '100% CDI',
    color: 'var(--chart-3)',
  },
  ipca: {
    label: 'IPCA',
    color: 'var(--chart-1)',
  },
} satisfies ChartConfig;

export function PatrimonyHistoryChart({ data }: { data: ChartRow[] }) {
  const yDomain = useMemo(
    () =>
      paddedYDomain(
        data.flatMap((row) => [row.patrimonio, row.cdi, row.ipca]),
      ),
    [data],
  );

  if (data.length === 0) {
    return (
      <div className='flex h-[360px] items-center justify-center px-6 text-center'>
        <p className='text-sm text-muted-foreground'>
          Sem histórico patrimonial neste período.
        </p>
      </div>
    );
  }

  return (
    <ChartContainer
      config={chartConfig}
      className='h-[360px] w-full aspect-auto'
    >
      <LineChart
        accessibilityLayer
        data={data}
        margin={{ top: 16, right: 8, left: 4, bottom: 0 }}
      >
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey='date'
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={28}
          tickFormatter={formatAxisDate}
        />
        <YAxis
          width={44}
          tickLine={false}
          axisLine={false}
          tickMargin={4}
          domain={yDomain}
          padding={{ top: 8, bottom: 4 }}
          tickFormatter={(value) => formatAxisValue(Number(value))}
        />
        <ChartTooltip
          cursor={{ stroke: 'var(--border)', strokeDasharray: '3 3' }}
          content={
            <ChartTooltipContent
              indicator='line'
              labelFormatter={(value) => formatAxisDate(String(value))}
              formatter={(value, name) => (
                <div className='flex w-full items-center justify-between gap-4'>
                  <span className='text-muted-foreground'>
                    {chartConfig[name as keyof typeof chartConfig]?.label ??
                      String(name)}
                  </span>
                  <span className='font-medium tabular-nums text-foreground'>
                    {formatCurrency(Number(value))}
                  </span>
                </div>
              )}
            />
          }
        />
        <ChartLegend content={<ChartLegendContent />} />
        <Line
          dataKey='patrimonio'
          name='patrimonio'
          type='monotone'
          stroke='var(--color-patrimonio)'
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4 }}
        />
        <Line
          dataKey='cdi'
          name='cdi'
          type='monotone'
          stroke='var(--color-cdi)'
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4 }}
        />
        <Line
          dataKey='ipca'
          name='ipca'
          type='monotone'
          stroke='var(--color-ipca)'
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4 }}
        />
      </LineChart>
    </ChartContainer>
  );
}
