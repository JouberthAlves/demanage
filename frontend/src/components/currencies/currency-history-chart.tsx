import { useId, useMemo } from 'react';
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts';

import {
  formatAxisDate,
  formatAxisValue,
  paddedYDomain,
} from '@/components/charts/chart-format';
import type { ChartConfig } from '@/components/ui/chart';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';
import { Spinner } from '@/components/ui/spinner';
import { formatCurrency } from '@/lib/format';
import type { Asset } from '@/types/patrimony';

type ChartRow = {
  date: string;
  valor: number;
};

type CurrencyHistoryChartProps = {
  asset: Asset;
  data: ChartRow[];
  isLoading?: boolean;
};

export function CurrencyHistoryChart({
  asset,
  data,
  isLoading = false,
}: CurrencyHistoryChartProps) {
  const gradientId = `fill-valor-${useId().replace(/:/g, '')}`;
  const seriesLabel = asset === 'BTC' ? 'Bitcoin' : 'Dólar';
  const chartConfig = useMemo(
    () =>
      ({
        valor: {
          label: seriesLabel,
          color: asset === 'BTC' ? 'var(--chart-1)' : 'var(--chart-2)',
        },
      }) satisfies ChartConfig,
    [asset, seriesLabel],
  );
  const yDomain = useMemo(
    () => paddedYDomain(data.map((row) => row.valor)),
    [data],
  );

  if (isLoading) {
    return (
      <div className='flex h-72 items-center justify-center'>
        <Spinner className='size-5' />
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className='flex h-72 items-center justify-center px-6 text-center'>
        <p className='text-sm text-muted-foreground'>
          Sem histórico de cotação neste período.
        </p>
      </div>
    );
  }

  return (
    <ChartContainer config={chartConfig} className='h-72 w-full aspect-auto'>
      <AreaChart
        accessibilityLayer
        data={data}
        margin={{ top: 16, right: 8, left: 4, bottom: 0 }}
      >
        <defs>
          <linearGradient id={gradientId} x1='0' y1='0' x2='0' y2='1'>
            <stop
              offset='5%'
              stopColor='var(--color-valor)'
              stopOpacity={0.45}
            />
            <stop
              offset='95%'
              stopColor='var(--color-valor)'
              stopOpacity={0.04}
            />
          </linearGradient>
        </defs>
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
              formatter={(value) => (
                <div className='flex w-full items-center justify-between gap-4'>
                  <span className='text-muted-foreground'>{seriesLabel}</span>
                  <span className='font-medium tabular-nums text-foreground'>
                    {formatCurrency(Number(value))}
                  </span>
                </div>
              )}
            />
          }
        />
        <Area
          dataKey='valor'
          name={seriesLabel}
          type='monotone'
          fill={`url(#${gradientId})`}
          stroke='var(--color-valor)'
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4 }}
          className={asset === 'BTC' ? 'neon-line-amber' : 'neon-line-green'}
        />
      </AreaChart>
    </ChartContainer>
  );
}
