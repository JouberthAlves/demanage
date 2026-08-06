import { ArrowDownRight, ArrowUpRight, Wallet } from 'lucide-react';
import { useMemo } from 'react';

import { CardCommitmentChart } from '@/components/dashboard/card-commitment-chart';
import { CategoryDonutChart } from '@/components/dashboard/category-donut-chart';
import { IncomeExpenseAreaChart } from '@/components/dashboard/income-expense-area-chart';
import { KpiCard } from '@/components/dashboard/kpi-card';
import { MonthCompareBarChart } from '@/components/dashboard/month-compare-bar-chart';
import { TopExpensesBarChart } from '@/components/dashboard/top-expenses-bar-chart';
import { PageHeader } from '@/components/layout/page-header';
import { PageHero } from '@/components/layout/page-hero';
import { SectionPanel } from '@/components/layout/section-panel';
import { usePiggyBanks } from '@/hooks/use-piggy-banks';
import { formatCurrency, formatPercent, getFirstName } from '@/lib/format';
import { useAuthStore } from '@/stores/auth-store';
import {
  selectAverageMonthlyExpense,
  selectMonthlyExpenses,
  selectMonthlyIncome,
  selectRecurringShare,
  useFinanceStore,
} from '@/stores/finance-store';

export function DashboardPage() {
  const userName = useAuthStore((state) => state.user?.name ?? '');
  const history = useFinanceStore((state) => state.history);
  const income = useFinanceStore(selectMonthlyIncome);
  const expenses = useFinanceStore(selectMonthlyExpenses);
  const averageExpense = useFinanceStore(selectAverageMonthlyExpense);
  const recurringShare = useFinanceStore(selectRecurringShare);
  const { data: piggyBanks = [] } = usePiggyBanks();
  const balance = income - expenses;
  const hasHistory = history.length > 0;
  const piggyTotal = useMemo(
    () => piggyBanks.reduce((sum, bank) => sum + bank.balance, 0),
    [piggyBanks],
  );

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
        <div className='grid gap-3 sm:grid-cols-3'>
          <div className='rounded-xl border border-border bg-black/25 p-4'>
            <p className='text-xs text-muted-foreground'>Saldo até hoje</p>
            <p
              className={
                balance >= 0
                  ? 'mt-2 text-2xl font-semibold text-neon-green'
                  : 'mt-2 text-2xl font-semibold text-rose-400'
              }
            >
              {formatCurrency(balance)}
            </p>
          </div>
          <div className='rounded-xl border border-border bg-black/25 p-4'>
            <p className='text-xs text-muted-foreground'>Total no cofre</p>
            <p className='mt-2 text-2xl font-semibold text-violet-300'>
              {formatCurrency(piggyTotal)}
            </p>
          </div>
          <div className='rounded-xl border border-border bg-black/25 p-4'>
            <p className='text-xs text-muted-foreground'>
              Saídas / entradas (já no saldo)
            </p>
            <p className='mt-2 text-2xl font-semibold text-neon-amber'>
              {formatPercent(recurringShare)}
            </p>
          </div>
        </div>
      </PageHero>

      <p className='text-sm text-muted-foreground'>
        Despesas vinculadas a cartão não entram no saldo até virarem fatura no
        fechamento.
      </p>

      <div className='grid gap-4 sm:grid-cols-2 xl:grid-cols-3'>
        <KpiCard
          label='Entradas já no saldo'
          value={formatCurrency(income)}
          hint='Após o dia de recebimento'
          tone='positive'
          icon={<ArrowUpRight className='size-4 text-neon-green' />}
        />
        <KpiCard
          label='Saídas já no saldo'
          value={formatCurrency(expenses)}
          hint='Após o dia de desconto (sem cartão aberto)'
          tone='amber'
          icon={<ArrowDownRight className='size-4 text-neon-amber' />}
        />
        <KpiCard
          label='Gasto médio mensal'
          value={formatCurrency(averageExpense)}
          hint={
            hasHistory
              ? 'Média dos meses com histórico'
              : 'Sem histórico ainda — valor = mês atual'
          }
          icon={<Wallet className='size-4' />}
        />
      </div>

      <div className='grid gap-4 xl:grid-cols-3'>
        <SectionPanel
          title='Entrada vs saída'
          description={
            hasHistory
              ? 'Comparativo dos últimos meses'
              : 'Histórico mensal ainda não disponível'
          }
          className='xl:col-span-2'
        >
          <IncomeExpenseAreaChart />
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

      <div className='grid gap-4 xl:grid-cols-2'>
        <SectionPanel
          title='Este mês vs mês passado'
          description={
            hasHistory
              ? 'Entradas e saídas lado a lado'
              : 'Histórico mensal ainda não disponível'
          }
        >
          <MonthCompareBarChart />
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
