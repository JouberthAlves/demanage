import { isAxiosError } from 'axios';
import { ArrowDownToLine, ArrowUpFromLine, RefreshCw } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { CurrencyHistoryChart } from '@/components/currencies/currency-history-chart';
import { PageHeader } from '@/components/layout/page-header';
import { PageHero } from '@/components/layout/page-hero';
import { SectionPanel } from '@/components/layout/section-panel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import {
  useAssetHistory,
  useAssetTransactions,
  useAssetsSummary,
  useCreateAssetTransaction,
  useDeleteAssetTransaction,
  useUpdateAssetTransaction,
} from '@/hooks/use-patrimony';
import { formatCurrency } from '@/lib/format';
import type {
  Asset,
  AssetPosition,
  AssetTransaction,
  AssetTransactionType,
} from '@/types/patrimony';

const DAY_MS = 86_400_000;
const SATS_PER_BTC = 100_000_000;

type BtcQuantityUnit = 'BTC' | 'SATS';

function dateInput(date: Date) {
  return date.toISOString().slice(0, 10);
}

function daysAgo(days: number) {
  return dateInput(new Date(Date.now() - days * DAY_MS));
}

function normalizeBtcQuantity(raw: string, unit: BtcQuantityUnit) {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (unit === 'BTC') {
    return trimmed.includes(',')
      ? trimmed.replace(/\./g, '').replace(',', '.')
      : trimmed;
  }

  const negative = trimmed.startsWith('-');
  const digits = trimmed.replace(/^-/, '').replace(/[.,\s]/g, '');
  if (!/^\d+$/.test(digits)) return null;

  const sats = Number(digits);
  if (!Number.isSafeInteger(sats) || sats === 0) return null;

  const btc = (sats / SATS_PER_BTC)
    .toFixed(8)
    .replace(/0+$/, '')
    .replace(/\.$/, '');
  return negative ? `-${btc}` : btc;
}

function formatQuantity(asset: Asset, raw: string) {
  const value = Number(raw);
  if (!Number.isFinite(value)) return '0';
  if (asset === 'BTC' && Math.abs(value) < 0.001) {
    return `${Math.round(value * SATS_PER_BTC).toLocaleString('pt-BR')} sats`;
  }
  return `${value.toLocaleString('pt-BR', {
    maximumFractionDigits: asset === 'BTC' ? 8 : 4,
  })} ${asset}`;
}

function pct(raw: string | null) {
  if (raw == null) return '—';
  const value = Number(raw);
  if (!Number.isFinite(value)) return '—';
  return `${value.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
}

function PositionCard({ position }: { position: AssetPosition }) {
  const positive = Number(position.totalPnlBrl) >= 0;
  return (
    <SectionPanel
      title={position.asset === 'BTC' ? 'Bitcoin' : 'Dólar'}
      description={`Cotação ${formatCurrency(Number(position.quoteBrl))}`}
    >
      <div className='space-y-4'>
        <div className='flex flex-wrap items-center gap-2'>
          <p className='text-2xl font-semibold tabular-nums'>
            {formatQuantity(position.asset, position.quantity)}
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

export function CurrenciesPage() {
  const { data, isLoading, isError } = useAssetsSummary();
  const [asset, setAsset] = useState<Asset>('BTC');
  const [type, setType] = useState<AssetTransactionType>('BUY');
  const [quantity, setQuantity] = useState('');
  const [btcQuantityUnit, setBtcQuantityUnit] = useState<BtcQuantityUnit>('BTC');
  const [cash, setCash] = useState('');
  const [fee, setFee] = useState('');
  const [feePercent, setFeePercent] = useState('');
  const [date, setDate] = useState(dateInput(new Date()));
  const [note, setNote] = useState('');
  const [costBasisKnown, setCostBasisKnown] = useState(false);
  const [editingTransactionId, setEditingTransactionId] = useState<string | null>(null);
  const [calcBrl, setCalcBrl] = useState('');
  const [from, setFrom] = useState(daysAgo(30));
  const [to, setTo] = useState(dateInput(new Date()));
  const createTransaction = useCreateAssetTransaction();
  const updateTransaction = useUpdateAssetTransaction();
  const deleteTransaction = useDeleteAssetTransaction();
  const btcHistory = useAssetHistory('BTC', from, to);
  const usdHistory = useAssetHistory('USD', from, to);
  const btcTransactions = useAssetTransactions('BTC');
  const usdTransactions = useAssetTransactions('USD');

  const activePosition = data?.[asset];
  const calculator = useMemo(() => {
    const brl = Number(calcBrl);
    const quote = Number(activePosition?.quoteBrl ?? 0);
    if (!Number.isFinite(brl) || brl <= 0 || quote <= 0) return '—';
    return formatQuantity(asset, String(brl / quote));
  }, [activePosition?.quoteBrl, asset, calcBrl]);

  const combined = useMemo(() => {
    if (!data) return null;
    const pnl = Number(data.BTC.totalPnlBrl) + Number(data.USD.totalPnlBrl);
    const denominator =
      Number(data.BTC.realizedCostBasisBrl) +
      Number(data.BTC.investedBrl) +
      Number(data.USD.realizedCostBasisBrl) +
      Number(data.USD.investedBrl);
    return {
      pnl,
      pct: denominator > 0 ? (pnl / denominator) * 100 : null,
    };
  }, [data]);

  function setPreset(days: number) {
    setFrom(daysAgo(days));
    setTo(dateInput(new Date()));
  }

  function resetTransactionForm() {
    setEditingTransactionId(null);
    setType('BUY');
    setQuantity('');
    setBtcQuantityUnit('BTC');
    setCash('');
    setFee('');
    setFeePercent('');
    setDate(dateInput(new Date()));
    setNote('');
    setCostBasisKnown(false);
  }

  function chooseAsset(nextAsset: Asset) {
    if (editingTransactionId) resetTransactionForm();
    setAsset(nextAsset);
  }

  function switchBtcUnit(nextUnit: BtcQuantityUnit) {
    if (nextUnit === btcQuantityUnit) return;
    const normalized = normalizeBtcQuantity(quantity, btcQuantityUnit);
    setBtcQuantityUnit(nextUnit);
    if (!normalized) {
      setQuantity('');
      return;
    }
    if (nextUnit === 'BTC') {
      setQuantity(normalized);
      return;
    }
    const sats = Number(normalized) * SATS_PER_BTC;
    setQuantity(Number.isSafeInteger(sats) ? String(Math.round(sats)) : '');
  }

  function startEditing(transaction: AssetTransaction) {
    setAsset(transaction.asset);
    setEditingTransactionId(transaction.id);
    setType(transaction.type);
    const quantityValue = Number(transaction.quantity);
    if (
      transaction.asset === 'BTC' &&
      Number.isFinite(quantityValue) &&
      Math.abs(quantityValue) < 0.001
    ) {
      setBtcQuantityUnit('SATS');
      setQuantity(String(Math.round(quantityValue * SATS_PER_BTC)));
    } else {
      setBtcQuantityUnit('BTC');
      setQuantity(transaction.quantity);
    }
    setCash(transaction.cashAmountBrl);
    setFee(transaction.feeAmountBrl === '0' ? '' : transaction.feeAmountBrl);
    setFeePercent(transaction.feePercent ?? '');
    setDate(transaction.date.slice(0, 10));
    setNote(transaction.note ?? '');
    setCostBasisKnown(transaction.costBasisKnown);
    window.requestAnimationFrame(() => {
      document
        .getElementById('asset-transaction-form')
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const normalizedQuantity =
      asset === 'BTC'
        ? normalizeBtcQuantity(quantity, btcQuantityUnit)
        : quantity.trim();

    if (!normalizedQuantity) {
      toast.error(
        asset === 'BTC' && btcQuantityUnit === 'SATS'
          ? 'Informe uma quantidade válida de sats'
          : 'Informe uma quantidade válida',
      );
      return;
    }
    if (type !== 'MANUAL_ADJUSTMENT' && !cash) {
      toast.error('Informe o valor da operação em BRL');
      return;
    }

    const payload = {
      type,
      quantity: normalizedQuantity,
      cashAmountBrl: cash || '0',
      feeAmountBrl: fee || undefined,
      feePercent: feePercent || undefined,
      costBasisKnown,
      date,
      note: note.trim() || null,
    };
    const isEditing = Boolean(editingTransactionId);

    try {
      if (editingTransactionId) {
        await updateTransaction.mutateAsync({
          id: editingTransactionId,
          payload,
        });
      } else {
        await createTransaction.mutateAsync({ asset, payload });
      }
      resetTransactionForm();
      toast.success(isEditing ? 'Movimentação atualizada' : 'Movimentação registrada');
    } catch (error) {
      toast.error(
        isAxiosError(error)
          ? (error.response?.data?.error ??
              (isEditing
                ? 'Não foi possível atualizar'
                : 'Não foi possível registrar'))
          : isEditing
            ? 'Não foi possível atualizar'
            : 'Não foi possível registrar',
      );
    }
  }

  const chartRows = (asset === 'BTC' ? btcHistory.data : usdHistory.data)?.points.map(
    (point) => ({ date: point.date.slice(5), valor: Number(point.value) }),
  );
  const transactions =
    asset === 'BTC' ? btcTransactions.data ?? [] : usdTransactions.data ?? [];
  const transactionMutationPending =
    createTransaction.isPending || updateTransaction.isPending;

  return (
    <div className='space-y-6'>
      <title>Moedas | deManage</title>
      <PageHeader
        title='Moedas'
        description='BTC e dólar como patrimônio: posição, preço médio, taxas e resultado contábil.'
      />

      {isLoading ? (
        <div className='flex h-48 items-center justify-center'>
          <Spinner className='size-5' />
        </div>
      ) : isError || !data ? (
        <SectionPanel>
          <p className='text-sm text-destructive'>
            As cotações estão indisponíveis e ainda não existe cache suficiente.
          </p>
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
        <SectionPanel
          title={`Histórico ${asset}`}
          description='Cotação em BRL. Finais de semana são avaliados pelo último ponto conhecido no patrimônio.'
        >
          <div className='mb-4 flex flex-wrap gap-2'>
            {[
              [7, '7d'],
              [30, '30d'],
              [90, '3m'],
              [365, '1a'],
            ].map(([days, label]) => (
              <Button
                key={label}
                size='sm'
                variant='outline'
                onClick={() => setPreset(Number(days))}
              >
                {label}
              </Button>
            ))}
            <Input
              type='date'
              value={from}
              onChange={(event) => setFrom(event.target.value)}
              className='w-auto'
            />
            <Input
              type='date'
              value={to}
              max={dateInput(new Date())}
              onChange={(event) => setTo(event.target.value)}
              className='w-auto'
            />
          </div>
          <div className='h-72'>
            <CurrencyHistoryChart
              asset={asset}
              data={chartRows ?? []}
              isLoading={
                asset === 'BTC' ? btcHistory.isLoading : usdHistory.isLoading
              }
            />
          </div>
        </SectionPanel>

        <SectionPanel title='Conversor rápido' description='Somente cálculo. Não cria movimentação.'>
          <div className='space-y-4'>
            <div className='flex gap-2'>
              {(['BTC', 'USD'] as const).map((item) => (
                <Button
                  key={item}
                  variant={asset === item ? 'default' : 'outline'}
                  onClick={() => chooseAsset(item)}
                >
                  {item}
                </Button>
              ))}
            </div>
            <div className='space-y-2'>
              <Label htmlFor='currency-calculator'>Reais</Label>
              <Input
                id='currency-calculator'
                inputMode='decimal'
                value={calcBrl}
                onChange={(event) => setCalcBrl(event.target.value.replace(',', '.'))}
                placeholder='1000,00'
              />
            </div>
            <div className='rounded-xl border border-border bg-black/20 p-4'>
              <p className='text-xs text-muted-foreground'>Você receberia aproximadamente</p>
              <p className='mt-1 text-xl font-semibold'>{calculator}</p>
            </div>
          </div>
        </SectionPanel>
      </div>

      <div id='asset-transaction-form'>
        <SectionPanel
          title={editingTransactionId ? 'Editar movimentação' : 'Registrar movimentação'}
          description='O valor em BRL é sempre o total efetivamente debitado ou recebido. Taxas são informativas e não são somadas duas vezes.'
        >
          <form onSubmit={(event) => void submit(event)} className='grid gap-4 lg:grid-cols-2'>
            <div className='space-y-2'>
              <Label>Ativo</Label>
              <div className='flex gap-2'>
                {(['BTC', 'USD'] as const).map((item) => (
                  <Button
                    key={item}
                    type='button'
                    variant={asset === item ? 'default' : 'outline'}
                    onClick={() => chooseAsset(item)}
                  >
                    {item}
                  </Button>
                ))}
              </div>
            </div>
            <div className='space-y-2'>
              <Label htmlFor='asset-type'>Tipo</Label>
              <select
                id='asset-type'
                value={type}
                onChange={(event) => setType(event.target.value as AssetTransactionType)}
                className='h-9 w-full rounded-lg border border-input bg-background px-3 text-sm'
              >
                <option value='BUY'>Compra</option>
                <option value='SELL'>Venda</option>
                <option value='MANUAL_ADJUSTMENT'>Ajuste manual</option>
              </select>
            </div>
            <div className='space-y-2'>
              <div className='flex flex-wrap items-center justify-between gap-2'>
                <Label htmlFor='asset-quantity'>
                  Quantidade{' '}
                  {asset === 'BTC'
                    ? btcQuantityUnit === 'SATS'
                      ? '(sats, inteiro)'
                      : '(BTC, até 8 casas)'
                    : '(USD)'}
                </Label>
                {asset === 'BTC' ? (
                  <div className='flex gap-1'>
                    <Button
                      type='button'
                      size='sm'
                      variant={btcQuantityUnit === 'BTC' ? 'default' : 'outline'}
                      onClick={() => switchBtcUnit('BTC')}
                    >
                      BTC
                    </Button>
                    <Button
                      type='button'
                      size='sm'
                      variant={btcQuantityUnit === 'SATS' ? 'default' : 'outline'}
                      onClick={() => switchBtcUnit('SATS')}
                    >
                      sats
                    </Button>
                  </div>
                ) : null}
              </div>
              <Input
                id='asset-quantity'
                inputMode={asset === 'BTC' && btcQuantityUnit === 'SATS' ? 'numeric' : 'decimal'}
                value={quantity}
                onChange={(event) =>
                  setQuantity(
                    asset === 'BTC'
                      ? event.target.value
                      : event.target.value.replace(',', '.'),
                  )
                }
                placeholder={
                  asset === 'BTC'
                    ? btcQuantityUnit === 'SATS'
                      ? '1.000.411'
                      : '0,01000411'
                    : '100.00'
                }
              />
              {asset === 'BTC' && btcQuantityUnit === 'SATS' ? (
                <p className='text-xs text-muted-foreground'>
                  1 sat = 0,00000001 BTC. Ex.: 1.000.411 sats = 0,01000411 BTC.
                </p>
              ) : null}
            </div>
            <div className='space-y-2'>
              <Label htmlFor='asset-cash'>Total efetivo em BRL</Label>
              <Input id='asset-cash' value={cash} onChange={(event) => setCash(event.target.value.replace(',', '.'))} placeholder='500,00' />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='asset-fee'>Taxa em BRL</Label>
              <Input id='asset-fee' value={fee} onChange={(event) => setFee(event.target.value.replace(',', '.'))} placeholder='0,00' />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='asset-fee-percent'>Taxa em %</Label>
              <Input id='asset-fee-percent' value={feePercent} onChange={(event) => setFeePercent(event.target.value.replace(',', '.'))} placeholder='0.20' />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='asset-date'>Data</Label>
              <Input id='asset-date' type='date' value={date} max={dateInput(new Date())} onChange={(event) => setDate(event.target.value)} />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='asset-note'>Observação</Label>
              <Input id='asset-note' value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} />
            </div>
            {type === 'MANUAL_ADJUSTMENT' ? (
              <label className='flex items-center gap-2 text-sm lg:col-span-2'>
                <input type='checkbox' checked={costBasisKnown} onChange={(event) => setCostBasisKnown(event.target.checked)} />
                Informei também o custo real deste saldo manual
              </label>
            ) : null}
            <div className='flex flex-wrap gap-2 lg:col-span-2'>
              <Button type='submit' disabled={transactionMutationPending}>
                {type === 'BUY' ? <ArrowDownToLine data-icon='inline-start' /> : type === 'SELL' ? <ArrowUpFromLine data-icon='inline-start' /> : <RefreshCw data-icon='inline-start' />}
                {transactionMutationPending
                  ? 'Salvando…'
                  : editingTransactionId
                    ? 'Salvar edição'
                    : 'Registrar'}
              </Button>
              {editingTransactionId ? (
                <Button type='button' variant='outline' onClick={resetTransactionForm}>
                  Cancelar edição
                </Button>
              ) : null}
            </div>
          </form>
        </SectionPanel>
      </div>

      <SectionPanel title={`Movimentações ${asset}`} description='Compras e vendas ficam vinculadas ao financeiro; ajustes manuais não criam caixa.'>
        {transactions.length === 0 ? (
          <p className='text-sm text-muted-foreground'>Nenhuma movimentação.</p>
        ) : (
          <div className='space-y-2'>
            {transactions.map((transaction) => (
              <div key={transaction.id} className='flex flex-col gap-3 rounded-xl border border-border p-3 sm:flex-row sm:items-center sm:justify-between'>
                <div>
                  <p className='font-medium'>
                    {transaction.type === 'BUY' ? 'Compra' : transaction.type === 'SELL' ? 'Venda' : 'Ajuste manual'} · {formatQuantity(asset, transaction.quantity)}
                  </p>
                  <p className='text-xs text-muted-foreground'>
                    {transaction.date.slice(0, 10).split('-').reverse().join('/')} · {formatCurrency(Number(transaction.cashAmountBrl))}
                    {transaction.feeAmountBrl !== '0' ? ` · taxa ${formatCurrency(Number(transaction.feeAmountBrl))}` : ''}
                  </p>
                </div>
                <div className='flex flex-wrap gap-2'>
                  <Button
                    size='sm'
                    variant='outline'
                    disabled={transactionMutationPending || deleteTransaction.isPending}
                    onClick={() => startEditing(transaction)}
                  >
                    Editar
                  </Button>
                  <Button
                    size='sm'
                    variant='ghost'
                    disabled={deleteTransaction.isPending || transactionMutationPending}
                    onClick={() => {
                      void deleteTransaction.mutateAsync(transaction.id).then(
                        () => {
                          if (editingTransactionId === transaction.id) {
                            resetTransactionForm();
                          }
                          toast.success('Movimentação removida');
                        },
                        (error) => toast.error(isAxiosError(error) ? (error.response?.data?.error ?? 'Não foi possível excluir') : 'Não foi possível excluir'),
                      );
                    }}
                  >
                    Excluir
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionPanel>
    </div>
  );
}
