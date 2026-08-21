import { useId, useMemo } from 'react';
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts';

import { Spinner } from '@/components/ui/spinner';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';
import type { ChartConfig } from '@/components/ui/chart';
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

function formatAxisDate(value: string) {
  const [month, day] = value.split('-');
  if (!month || !day) return value;
  return `${day}/${month}`;
}

function formatAxisValue(value: number) {
  const abs = Math.abs(value);
  if (abs < 1000) {
    return new Intl.NumberFormat('pt-BR', {
      maximumFractionDigits: abs < 10 ? 2 : 0,
    }).format(value);
  }
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    compactDisplay: 'short',
    maximumFractionDigits: 1,
  })
    .format(value)
    .toLowerCase();
}

export function CurrencyHistoryChart({
  asset,
  data,
  isLoading = false,
}: CurrencyHistoryChartProps) {
  const gradientId = `fill-valor-${useId().replace(/:/g, '')}`;
  const chartConfig = useMemo(
    () =>
      ({
        valor: {
          label: asset === 'BTC' ? 'Bitcoin' : 'Dólar',
          color: asset === 'BTC' ? 'var(--chart-1)' : 'var(--chart-2)',
        },
      }) satisfies ChartConfig,
    [asset],
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
    <ChartContainer
      config={chartConfig}
      className='h-72 w-full aspect-auto'
    >
      <AreaChart
        accessibilityLayer
        data={data}
        margin={{ top: 8, right: 8, left: 4, bottom: 0 }}
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
          tickFormatter={(value) => formatAxisValue(Number(value))}
        />
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              indicator='line'
              labelFormatter={(value) => formatAxisDate(String(value))}
              formatter={(value) => (
                <div className='flex w-full items-center justify-between gap-4'>
                  <span className='text-muted-foreground'>
                    {asset === 'BTC' ? 'Bitcoin' : 'Dólar'}
                  </span>
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
          name={asset === 'BTC' ? 'Bitcoin' : 'Dólar'}
          type='natural'
          fill={`url(#${gradientId})`}
          stroke='var(--color-valor)'
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4 }}
          className={
            asset === 'BTC' ? 'neon-line-amber' : 'neon-line-green'
          }
        />
      </AreaChart>
    </ChartContainer>
  );
}
