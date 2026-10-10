import { useState } from 'react';

import { presetRange } from '@/components/charts/date-range';
import { DateRangeFilter } from '@/components/charts/date-range-filter';
import { CurrencyHistoryChart } from '@/components/currencies/currency-history-chart';
import { SectionPanel } from '@/components/layout/section-panel';
import { useFinancialNow } from '@/hooks/use-financial-now';
import { useAssetHistory } from '@/hooks/use-patrimony';
import { todayKey } from '@/lib/dates';
import type { Asset } from '@/types/patrimony';

export function HistoryPanel({ asset }: { asset: Asset }) {
  const now = useFinancialNow();
  const [range, setRange] = useState(() => presetRange(30, now));
  const history = useAssetHistory(asset, range.from, range.to);

  const rows = history.data?.points.map((point) => ({
    date: point.date.slice(5),
    valor: Number(point.value),
  }));

  return (
    <SectionPanel
      title={`Histórico ${asset}`}
      description='Cotação em BRL. Finais de semana são avaliados pelo último ponto conhecido no patrimônio.'
    >
      <DateRangeFilter
        from={range.from}
        to={range.to}
        max={todayKey(now)}
        onPreset={(days) => setRange(presetRange(days, now))}
        onFromChange={(from) => setRange((current) => ({ ...current, from }))}
        onToChange={(to) => setRange((current) => ({ ...current, to }))}
      />
      <div className='h-72'>
        {history.isError ? (
          <p role='alert' className='text-sm text-destructive'>
            Não foi possível carregar o histórico de cotação.
          </p>
        ) : (
          <CurrencyHistoryChart
            asset={asset}
            data={rows ?? []}
            isLoading={history.isLoading}
          />
        )}
      </div>
    </SectionPanel>
  );
}
