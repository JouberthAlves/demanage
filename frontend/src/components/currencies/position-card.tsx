import { SectionPanel } from '@/components/layout/section-panel';
import { Badge } from '@/components/ui/badge';
import { formatAssetQuantity } from '@/lib/btc-quantity';
import { formatCurrency } from '@/lib/format';
import type { AssetPosition } from '@/types/patrimony';

function pct(raw: string | null) {
  if (raw == null) return '—';
  const value = Number(raw);
  if (!Number.isFinite(value)) return '—';
  return `${value.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className='min-w-0 rounded-xl border border-border bg-black/15 p-3'>
      <p className='text-xs text-muted-foreground'>{label}</p>
      <p className='mt-1 truncate font-medium tabular-nums' title={value}>
        {value}
      </p>
    </div>
  );
}

export function PositionCard({ position }: { position: AssetPosition }) {
  const positive = Number(position.totalPnlBrl) >= 0;
  return (
    <SectionPanel
      title={position.asset === 'BTC' ? 'Bitcoin' : 'Dólar'}
      description={`Cotação ${formatCurrency(Number(position.quoteBrl))}`}
    >
      <div className='space-y-4'>
        <div className='flex flex-wrap items-center gap-2'>
          <p className='text-2xl font-semibold tabular-nums'>
            {formatAssetQuantity(position.asset, position.quantity)}
          </p>
          {position.quote.stale ? (
            <Badge variant='outline' className='border-amber-500/40 text-amber-300'>
              Cotação em cache
            </Badge>
          ) : null}
          {!position.pnlComplete ? (
            <Badge variant='outline'>P&L parcial</Badge>
          ) : null}
        </div>

        <div className='grid gap-3 sm:grid-cols-2'>
          <Metric label='Valor atual' value={formatCurrency(Number(position.marketValueBrl))} />
          <Metric label='Total investido' value={formatCurrency(Number(position.investedBrl))} />
          <Metric
            label='Preço médio'
            value={
              position.averageCostBrl == null
                ? '—'
                : formatCurrency(Number(position.averageCostBrl))
            }
          />
          <Metric label='Taxas acumuladas' value={formatCurrency(Number(position.feesBrl))} />
          <Metric label='Resultado realizado' value={formatCurrency(Number(position.realizedPnlBrl))} />
          <Metric label='Resultado não realizado' value={formatCurrency(Number(position.unrealizedPnlBrl))} />
        </div>

        <div className='rounded-xl border border-border bg-black/20 p-3'>
          <p className='text-xs text-muted-foreground'>Resultado total</p>
          <p
            className={
              positive
                ? 'mt-1 text-lg font-semibold text-neon-green'
                : 'mt-1 text-lg font-semibold text-rose-400'
            }
          >
            {formatCurrency(Number(position.totalPnlBrl))} ·{' '}
            {pct(position.totalPnlPercent)}
          </p>
        </div>
      </div>
    </SectionPanel>
  );
}
