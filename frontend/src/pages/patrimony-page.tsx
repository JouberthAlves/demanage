import { useMemo, useState } from 'react';
import { Settings2 } from 'lucide-react';

import { presetRange } from '@/components/charts/date-range';
import { DateRangeFilter } from '@/components/charts/date-range-filter';
import { PageHeader } from '@/components/layout/page-header';
import { PageHero } from '@/components/layout/page-hero';
import { SectionPanel } from '@/components/layout/section-panel';
import { PatrimonyBaseForm } from '@/components/patrimony/patrimony-base-form';
import { PatrimonyHistoryChart } from '@/components/patrimony/patrimony-history-chart';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useFinancialNow } from '@/hooks/use-financial-now';
import {
  useMonthlyExpenses,
  useMonthlyIncome,
} from '@/hooks/use-monthly-history';
import {
  usePatrimonyHistory,
  usePatrimonySettings,
} from '@/hooks/use-patrimony';
import { todayKey } from '@/lib/dates';
import { formatCurrency } from '@/lib/format';

function percent(raw: string | null) {
  if (raw == null) return '—';
  const value = Number(raw);
  if (!Number.isFinite(value)) return '—';
  return `${value.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
}

function SummaryCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className='min-w-0 rounded-xl border border-border bg-black/20 p-4'>
      <p className='text-xs text-muted-foreground'>{label}</p>
      <p className='mt-2 truncate text-lg font-semibold tabular-nums' title={value}>
        {value}
      </p>
      {hint ? <p className='mt-1 text-xs text-muted-foreground'>{hint}</p> : null}
    </div>
  );
}

function PatrimonyShell({ children }: { children: React.ReactNode }) {
  return (
    <div className='space-y-6'>
      <title>Patrimônio | deManage</title>
      {children}
    </div>
  );
}

export function PatrimonyPage() {
  const now = useFinancialNow();
  const settingsQuery = usePatrimonySettings();
  const settings = settingsQuery.data;
  const dashboardBalance = useMonthlyIncome() - useMonthlyExpenses();
  const [editingSettings, setEditingSettings] = useState(false);
  const [range, setRange] = useState<{ from?: string; to?: string }>(() =>
    presetRange(30, now),
  );
  const historyQuery = usePatrimonyHistory(
    range.from,
    range.to,
    Boolean(settings),
  );

  const chartData = useMemo(
    () =>
      historyQuery.data?.history.map((point) => ({
        date: point.date.slice(5),
        patrimonio: Number(point.patrimonyBrl),
        cdi: Number(point.cdiBrl),
        ipca: Number(point.ipcaBrl),
      })) ?? [],
    [historyQuery.data?.history],
  );

  if (settingsQuery.isPending) {
    return (
      <div className='flex h-60 items-center justify-center' role='status' aria-label='Carregando patrimônio'>
        <Spinner className='size-5' />
      </div>
    );
  }

  if (settings === undefined) {
    return (
      <PatrimonyShell>
        <PageHeader title='Patrimônio' description='Não foi possível carregar a configuração.' />
        <SectionPanel>
          <div role='alert' className='flex flex-wrap items-center gap-3'>
            <p className='text-sm text-destructive'>
              Falha ao carregar a base patrimonial. Nenhuma configuração foi alterada.
            </p>
            <Button
              variant='outline'
              size='sm'
              disabled={settingsQuery.isFetching}
              onClick={() => void settingsQuery.refetch()}
            >
              Tentar novamente
            </Button>
          </div>
        </SectionPanel>
      </PatrimonyShell>
    );
  }

  if (settings === null || editingSettings) {
    return (
      <PatrimonyShell>
        <PageHeader
          title='Patrimônio'
          description='Defina a data-base e quanto existia em reais naquele dia. Meta e investimentos passam a ser reconstruídos a partir daí.'
        />
        <PatrimonyBaseForm
          settings={settings}
          suggestedBalance={dashboardBalance}
          onCancel={settings ? () => setEditingSettings(false) : undefined}
          onSaved={() => {
            setEditingSettings(false);
            setRange({});
          }}
        />
      </PatrimonyShell>
    );
  }

  const today = todayKey(now);
  const data = historyQuery.data;
  const summary = data?.summary;

  return (
    <PatrimonyShell>
      <PageHeader
        title='Patrimônio'
        description='Tudo o que você possui hoje, comparado com 100% CDI e preservação do poder de compra pelo IPCA.'
        actions={
          <Button variant='outline' onClick={() => setEditingSettings(true)}>
            <Settings2 data-icon='inline-start' />
            Editar base
          </Button>
        }
      />

      {historyQuery.isLoading ? (
        <div className='flex h-60 items-center justify-center' role='status' aria-label='Reconstruindo patrimônio'>
          <Spinner className='size-5' />
        </div>
      ) : historyQuery.isError || !data || !summary ? (
        <SectionPanel>
          <p role='alert' className='text-sm text-destructive'>
            Não foi possível reconstruir o patrimônio. Se uma cotação histórica ainda não estiver em cache, tente novamente quando o provedor estiver disponível.
          </p>
        </SectionPanel>
      ) : (
        <>
          <PageHero
            eyebrow='Patrimônio atual'
            title={formatCurrency(Number(summary.patrimonyBrl))}
            description={`Base em ${data.settings.baseDate.split('-').reverse().join('/')} · saldo inicial ${formatCurrency(Number(data.settings.openingCashBrl))}`}
          >
            <div className='flex flex-wrap gap-2'>
              {Object.entries(data.stale)
                .filter(([, stale]) => stale)
                .map(([provider]) => (
                  <Badge key={provider} variant='outline' className='border-amber-500/40 text-amber-300'>
                    {provider.toUpperCase()} em cache
                  </Badge>
                ))}
            </div>
          </PageHero>

          <div className='grid gap-3 sm:grid-cols-2 xl:grid-cols-4'>
            <SummaryCard label='Saldo em reais' value={formatCurrency(Number(summary.cashBrl))} />
            <SummaryCard label='Cofrinhos' value={formatCurrency(Number(summary.piggyBrl))} />
            <SummaryCard label='Bitcoin' value={formatCurrency(Number(summary.btcBrl))} />
            <SummaryCard label='Dólar' value={formatCurrency(Number(summary.usdBrl))} />
            <SummaryCard label='Se tudo fosse 100% CDI' value={formatCurrency(Number(summary.cdiBrl))} hint={`${formatCurrency(Number(summary.versusCdiBrl))} · ${percent(summary.versusCdiPercent)} vs patrimônio`} />
            <SummaryCard label='Para acompanhar o IPCA' value={formatCurrency(Number(summary.ipcaBrl))} hint={`${formatCurrency(Number(summary.versusIpcaBrl))} · ${percent(summary.versusIpcaPercent)} vs patrimônio`} />
          </div>

          <SectionPanel
            title='Evolução patrimonial'
            description='Transferências internas mudam a composição real, mas não são tratadas como aportes ou retiradas nas linhas CDI/IPCA.'
          >
            <DateRangeFilter
              from={range.from ?? settings.baseDate}
              to={range.to ?? today}
              min={settings.baseDate}
              max={today}
              onPreset={(days) => setRange(presetRange(days, now))}
              onFromChange={(from) => setRange((current) => ({ ...current, from }))}
              onToChange={(to) => setRange((current) => ({ ...current, to }))}
              extra={
                <Button type='button' size='sm' variant='outline' onClick={() => setRange({})}>
                  Máx
                </Button>
              }
            />
            <div className='h-[360px]'>
              <PatrimonyHistoryChart data={chartData} />
            </div>
          </SectionPanel>
        </>
      )}
    </PatrimonyShell>
  );
}
