import { useMemo } from 'react';
import { ArrowDownRight, ArrowUpRight, Wallet } from 'lucide-react';

import { CardCommitmentChart } from '@/components/dashboard/card-commitment-chart';
import { CategoryDonutChart } from '@/components/dashboard/category-donut-chart';
import { IncomeExpenseAreaChart } from '@/components/dashboard/income-expense-area-chart';
import { KpiCard } from '@/components/dashboard/kpi-card';
import { MonthCompareBarChart } from '@/components/dashboard/month-compare-bar-chart';
import { TopExpensesBarChart } from '@/components/dashboard/top-expenses-bar-chart';
import { PageHeader } from '@/components/layout/page-header';
import { PageHero } from '@/components/layout/page-hero';
import { SectionPanel } from '@/components/layout/section-panel';
import { Button } from '@/components/ui/button';
import {
  useAssetCashTransactions,
  useFinanceSummary,
} from '@/hooks/use-monthly-history';
import { usePiggyBanks, usePiggyCashMovements } from '@/hooks/use-piggy-banks';
import {
  formatCurrencyCompact,
  formatPercent,
  getFirstName,
  moneyValueClass,
} from '@/lib/format';
import { useAuthStore } from '@/stores/auth-store';

export function DashboardPage() {
  const userName = useAuthStore((state) => state.user?.name ?? '');
  const {
    history,
    income,
    expenses,
    averageExpense,
    recurringShare,
    historyQuery,
  } = useFinanceSummary();
  const { data: piggyBanks = [] } = usePiggyBanks();
  const piggyCashQuery = usePiggyCashMovements();
  const assetCashQuery = useAssetCashTransactions();
  const balance = income - expenses;
  const hasHistory = history.slice(0, -1).some((month) => month.hasActivity);
  const piggyTotal = useMemo(
    () => piggyBanks.reduce((sum, bank) => sum + bank.balance, 0),
    [piggyBanks],
  );
  const balanceLabel = formatCurrencyCompact(balance);
  const piggyLabel = formatCurrencyCompact(piggyTotal);
  const shareLabel = formatPercent(recurringShare);

  // Ordinary income/expense endpoints omit internal piggy and asset flows.
  // Never display a partial cash balance while either source is unavailable.
  if (
    piggyCashQuery.isError ||
    !piggyCashQuery.data ||
    assetCashQuery.isError ||
    assetCashQuery.isPending ||
    historyQuery.isError ||
    !historyQuery.data
  ) {
    const failed =
      piggyCashQuery.isError || assetCashQuery.isError || historyQuery.isError;
    return (
      <div className='space-y-6'>
        <title>Dashboard | deManage</title>
        <PageHeader
          title={`Olá, ${getFirstName(userName)}`}
          description='Resumo financeiro até hoje'
        />
        <div
          role={failed ? 'alert' : 'status'}
          className='rounded-xl border border-border p-5 space-y-3'
        >
          <p className='font-medium'>
            {failed
              ? 'Saldo indisponível: não foi possível consultar todas as movimentações financeiras.'
              : 'Atualizando o saldo com as movimentações financeiras…'}
          </p>
          {failed ? (
            <Button
              variant='outline'
              onClick={() =>
                void Promise.all([
                  piggyCashQuery.refetch(),
                  assetCashQuery.refetch(),
                  historyQuery.refetch(),
                ])
              }
            >
              Tentar novamente
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className='space-y-6'>
      <title>Dashboard | deManage</title>
      <PageHeader
        title={`Olá, ${getFirstName(userName)}`}
        description='Valores já no saldo até hoje (após o dia de recebimento/desconto).'
      />

      <PageHero
        eyebrow='Resumo até hoje'
        title={balance >= 0 ? 'Saldo positivo' : 'Saldo negativo'}
        description={
          balance >= 0
            ? 'Entradas já creditadas cobrem as saídas já no saldo. Despesas no cartão entram só como fatura.'
            : 'As saídas já no saldo estão acima das entradas. Vale revisar cartões e recorrências.'
        }
      >
        <div className='grid min-w-0 gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'>
          <div className='min-w-0 rounded-xl border border-border bg-black/25 p-4'>
            <p className='text-xs text-muted-foreground'>Saldo até hoje</p>
            <p
              title={balanceLabel}
              className={
                balance >= 0
                  ? `mt-2 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-semibold tabular-nums text-neon-green ${moneyValueClass(balanceLabel)}`
                  : `mt-2 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-semibold tabular-nums text-rose-400 ${moneyValueClass(balanceLabel)}`
              }
            >
              {balanceLabel}
            </p>
          </div>
          <div className='min-w-0 rounded-xl border border-border bg-black/25 p-4'>
            <p className='text-xs text-muted-foreground'>Total no cofre</p>
            <p
              title={piggyLabel}
              className={`mt-2 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-semibold tabular-nums text-violet-300 ${moneyValueClass(piggyLabel)}`}
            >
              {piggyLabel}
            </p>
          </div>
          <div className='min-w-0 rounded-xl border border-border bg-black/25 p-4 sm:col-span-2 lg:col-span-1'>
            <p className='text-xs text-muted-foreground'>
              Saídas / entradas (já no saldo)
            </p>
            <p
              title={shareLabel}
              className={`mt-2 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-semibold tabular-nums text-neon-amber ${moneyValueClass(shareLabel)}`}
            >
              {shareLabel}
            </p>
          </div>
        </div>
      </PageHero>

      <p className='text-sm text-muted-foreground'>
        Despesas vinculadas a cartão não entram no saldo até virarem fatura no
        fechamento.
      </p>

      <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-3'>
        <KpiCard
          label='Entradas já no saldo'
          value={formatCurrencyCompact(income)}
          hint='Após o dia de recebimento'
          tone='positive'
          icon={<ArrowUpRight className='size-4 text-neon-green' />}
        />
        <KpiCard
          label='Saídas já no saldo'
          value={formatCurrencyCompact(expenses)}
          hint='Após o dia de desconto (sem cartão aberto)'
          tone='amber'
          icon={<ArrowDownRight className='size-4 text-neon-amber' />}
        />
        <KpiCard
          label='Gasto médio mensal'
          value={formatCurrencyCompact(averageExpense)}
          hint={
            hasHistory
              ? 'Média dos meses com histórico'
              : 'Sem histórico ainda — valor = mês atual'
          }
          icon={<Wallet className='size-4' />}
          className='sm:col-span-2 lg:col-span-1'
        />
      </div>

      <div className='grid gap-4 lg:grid-cols-3'>
        <SectionPanel
          title='Entrada vs saída'
          description='Meses anteriores: movimentações registradas. Mês atual: valores já no saldo.'
          className='lg:col-span-2'
        >
          <IncomeExpenseAreaChart
            history={history}
            currentIncome={income}
            currentExpense={expenses}
          />
        </SectionPanel>

        <SectionPanel
          title='Composição no saldo'
          description='Despesas já no saldo por categoria'
        >
          <CategoryDonutChart />
        </SectionPanel>
      </div>

      <SectionPanel
        title='Suas maiores despesas'
        description='Top categorias por valor mensal — use o olho para ver os itens'
      >
        <TopExpensesBarChart />
      </SectionPanel>

      <div className='grid gap-4 lg:grid-cols-2'>
        <SectionPanel
          title='Este mês vs mês passado'
          description={
            hasHistory
              ? 'Comparação entre pagamentos e recebimentos registrados'
              : 'A comparação aparece quando houver registros em um mês anterior'
          }
        >
          <MonthCompareBarChart history={history} />
        </SectionPanel>

        <SectionPanel
          title='Comprometimento do cartão'
          description='% do limite usado por despesas vinculadas'
        >
          <CardCommitmentChart />
        </SectionPanel>
      </div>
    </div>
  );
}
