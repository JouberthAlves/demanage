import { isAxiosError } from 'axios';
import { Settings2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { PageHeader } from '@/components/layout/page-header';
import { PatrimonyHistoryChart } from '@/components/patrimony/patrimony-history-chart';
import { PageHero } from '@/components/layout/page-hero';
import { SectionPanel } from '@/components/layout/section-panel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import {
  usePatrimonyHistory,
  usePatrimonySettings,
  useSavePatrimonySettings,
} from '@/hooks/use-patrimony';
import { formatCurrency } from '@/lib/format';
import {
  selectMonthlyExpenses,
  selectMonthlyIncome,
  useFinanceStore,
} from '@/stores/finance-store';

const DAY_MS = 86_400_000;

function dateInput(date: Date) {
  return date.toISOString().slice(0, 10);
}

function daysAgo(days: number) {
  return dateInput(new Date(Date.now() - days * DAY_MS));
}

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

export function PatrimonyPage() {
  const settingsQuery = usePatrimonySettings();
  const settings = settingsQuery.data;
  const income = useFinanceStore(selectMonthlyIncome);
  const expenses = useFinanceStore(selectMonthlyExpenses);
  const dashboardBalance = income - expenses;
  const [editingSettings, setEditingSettings] = useState(false);
  const [baseDate, setBaseDate] = useState(dateInput(new Date()));
  const [openingCash, setOpeningCash] = useState(String(dashboardBalance));
  const [from, setFrom] = useState<string | undefined>(daysAgo(30));
  const [to, setTo] = useState<string | undefined>(dateInput(new Date()));
  const saveSettings = useSavePatrimonySettings();
  const historyQuery = usePatrimonyHistory(from, to, Boolean(settings));

  useEffect(() => {
    if (settings) {
      setBaseDate(settings.baseDate);
      setOpeningCash(settings.openingCashBrl);
      return;
    }
    if (settings === null) {
      setBaseDate(dateInput(new Date()));
      setOpeningCash(String(dashboardBalance));
    }
  }, [dashboardBalance, settings]);

  async function submitSettings(event: React.FormEvent) {
    event.preventDefault();
    try {
      await saveSettings.mutateAsync({
        baseDate,
        openingCashBrl: openingCash.replace(',', '.'),
      });
      setEditingSettings(false);
      setFrom(undefined);
      setTo(undefined);
      toast.success('Base patrimonial salva');
    } catch (error) {
      toast.error(
        isAxiosError(error)
          ? (error.response?.data?.error ?? 'Não foi possível salvar')
          : 'Não foi possível salvar',
      );
    }
  }

  function preset(days: number) {
    setFrom(daysAgo(days));
    setTo(dateInput(new Date()));
  }

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

  if (settingsQuery.isLoading) {
    return (
      <div className='flex h-60 items-center justify-center'>
        <Spinner className='size-5' />
      </div>
    );
  }

  if (settings === null || editingSettings) {
    return (
      <div className='space-y-6'>
        <title>Patrimônio | deManage</title>
        <PageHeader
          title='Patrimônio'
          description='Defina a data-base e quanto existia em reais naquele dia. Meta e investimentos passam a ser reconstruídos a partir daí.'
        />
        <SectionPanel
          title={settings === null ? 'Configuração inicial' : 'Editar base patrimonial'}
          description={`Sugestão do Dashboard atual: ${formatCurrency(dashboardBalance)}. Você pode corrigir esse valor antes de salvar.`}
        >
          <form onSubmit={(event) => void submitSettings(event)} className='grid gap-4 sm:grid-cols-2'>
            <div className='space-y-2'>
              <Label htmlFor='patrimony-base-date'>Data-base</Label>
              <Input
                id='patrimony-base-date'
                type='date'
                max={dateInput(new Date())}
                value={baseDate}
                onChange={(event) => setBaseDate(event.target.value)}
              />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='patrimony-opening-cash'>Saldo em reais na data-base</Label>
              <Input
                id='patrimony-opening-cash'
                inputMode='decimal'
                value={openingCash}
                onChange={(event) => setOpeningCash(event.target.value)}
              />
            </div>
            <div className='flex gap-2 sm:col-span-2'>
              <Button type='submit' disabled={saveSettings.isPending}>
                {saveSettings.isPending ? 'Salvando…' : 'Salvar base'}
              </Button>
              {settings ? (
                <Button type='button' variant='ghost' onClick={() => setEditingSettings(false)}>
                  Cancelar
                </Button>
              ) : null}
            </div>
          </form>
        </SectionPanel>
      </div>
    );
  }

  const data = historyQuery.data;
  const summary = data?.summary;

  return (
    <div className='space-y-6'>
      <title>Patrimônio | deManage</title>
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
        <div className='flex h-60 items-center justify-center'>
          <Spinner className='size-5' />
        </div>
      ) : historyQuery.isError || !summary ? (
        <SectionPanel>
          <p className='text-sm text-destructive'>
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
            <div className='mb-4 flex flex-wrap gap-2'>
              <Button size='sm' variant='outline' onClick={() => preset(7)}>7d</Button>
              <Button size='sm' variant='outline' onClick={() => preset(30)}>30d</Button>
              <Button size='sm' variant='outline' onClick={() => preset(90)}>3m</Button>
              <Button size='sm' variant='outline' onClick={() => preset(365)}>1a</Button>
              <Button size='sm' variant='outline' onClick={() => { setFrom(undefined); setTo(undefined); }}>Máx</Button>
              <Input
                type='date'
                min={settings.baseDate}
                max={to ?? dateInput(new Date())}
                value={from ?? settings.baseDate}
                onChange={(event) => setFrom(event.target.value)}
                className='w-auto'
              />
              <Input
                type='date'
                min={from ?? settings.baseDate}
                max={dateInput(new Date())}
                value={to ?? dateInput(new Date())}
                onChange={(event) => setTo(event.target.value)}
                className='w-auto'
              />
            </div>
            <div className='h-[360px]'>
              <PatrimonyHistoryChart data={chartData} />
            </div>
          </SectionPanel>
        </>
      )}
    </div>
  );
}
