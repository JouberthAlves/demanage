import { useMemo, useState } from 'react';

import { AssetTransactionForm } from '@/components/currencies/asset-transaction-form';
import { HistoryPanel } from '@/components/currencies/history-panel';
import { PositionCard } from '@/components/currencies/position-card';
import { QuickConverter } from '@/components/currencies/quick-converter';
import { TransactionsList } from '@/components/currencies/transactions-list';
import { useAssetTransactionForm } from '@/components/currencies/use-asset-transaction-form';
import { PageHeader } from '@/components/layout/page-header';
import { PageHero } from '@/components/layout/page-hero';
import { SectionPanel } from '@/components/layout/section-panel';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useAssetsSummary } from '@/hooks/use-patrimony';
import { toCents } from '@/lib/decimal-input';
import { formatCurrency } from '@/lib/format';
import type { Asset, AssetsSummary } from '@/types/patrimony';

/** Combined BTC + USD result, summed in integer cents. */
function combinePositions(data: AssetsSummary) {
  const pnlCents = toCents(data.BTC.totalPnlBrl) + toCents(data.USD.totalPnlBrl);
  const baseCents =
    toCents(data.BTC.realizedCostBasisBrl) +
    toCents(data.BTC.investedBrl) +
    toCents(data.USD.realizedCostBasisBrl) +
    toCents(data.USD.investedBrl);
  return {
    pnl: pnlCents / 100,
    pct: baseCents > 0 ? (pnlCents / baseCents) * 100 : null,
  };
}

export function CurrenciesPage() {
  const summaryQuery = useAssetsSummary();
  const { data, isLoading, isError } = summaryQuery;
  const [asset, setAsset] = useState<Asset>('BTC');
  const form = useAssetTransactionForm({ asset, onAssetChange: setAsset });
  const combined = useMemo(() => (data ? combinePositions(data) : null), [data]);

  return (
    <div className='space-y-6'>
      <title>Moedas | deManage</title>
      <PageHeader
        title='Moedas'
        description='BTC e dólar como patrimônio: posição, preço médio, taxas e resultado contábil.'
      />

      {isLoading ? (
        <div className='flex h-48 items-center justify-center' role='status' aria-label='Carregando moedas'>
          <Spinner className='size-5' />
        </div>
      ) : isError || !data ? (
        <SectionPanel>
          <div role='alert' className='space-y-3'>
            <p className='text-sm text-destructive'>
              As cotações estão indisponíveis e ainda não existe cache suficiente.
            </p>
            <Button
              variant='outline'
              size='sm'
              disabled={summaryQuery.isFetching}
              onClick={() => void summaryQuery.refetch()}
            >
              {summaryQuery.isFetching ? <Spinner data-icon='inline-start' /> : null}
              {summaryQuery.isFetching ? 'Tentando novamente…' : 'Tentar novamente'}
            </Button>
          </div>
        </SectionPanel>
      ) : (
        <>
          <PageHero
            eyebrow='Resultado BTC + USD'
            title={formatCurrency(combined?.pnl ?? 0)}
            description={
              combined?.pct == null
                ? 'Sem custo conhecido suficiente para calcular percentual.'
                : `${combined.pct.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}% sobre o capital conhecido.`
            }
          />
          <div className='grid gap-4 xl:grid-cols-2'>
            <PositionCard position={data.BTC} />
            <PositionCard position={data.USD} />
          </div>
        </>
      )}

      <div className='grid gap-4 xl:grid-cols-[1.15fr_0.85fr]'>
        <HistoryPanel asset={asset} />
        <QuickConverter
          asset={asset}
          onAssetChange={form.chooseAsset}
          quoteBrl={data?.[asset].quoteBrl}
        />
      </div>

      <AssetTransactionForm form={form} />

      <TransactionsList
        asset={asset}
        busy={form.pending}
        onEdit={form.startEditing}
        onDeleted={(id) => {
          if (form.editingId === id) form.reset();
        }}
      />
    </div>
  );
}
