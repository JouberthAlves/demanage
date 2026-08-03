import {
  ArrowDownRight,
  ArrowUpRight,
  Percent,
  Scale,
  Wallet,
} from 'lucide-react';

import { CardCommitmentChart } from '@/components/dashboard/card-commitment-chart';
import { CategoryDonutChart } from '@/components/dashboard/category-donut-chart';
import { IncomeExpenseAreaChart } from '@/components/dashboard/income-expense-area-chart';
import { KpiCard } from '@/components/dashboard/kpi-card';
import { MonthCompareBarChart } from '@/components/dashboard/month-compare-bar-chart';
import { PageHeader } from '@/components/layout/page-header';
import { PageHero } from '@/components/layout/page-hero';
import { SectionPanel } from '@/components/layout/section-panel';
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
  const income = useFinanceStore(selectMonthlyIncome);
  const expenses = useFinanceStore(selectMonthlyExpenses);
  const averageExpense = useFinanceStore(selectAverageMonthlyExpense);
  const recurringShare = useFinanceStore(selectRecurringShare);
  const balance = income - expenses;

  return (
    <div className='space-y-6'>
      <title>Dashboard | deManage</title>
      <PageHeader
        title={`Olá, ${getFirstName(userName)}`}
        description='Visão geral das entradas, saídas e despesas recorrentes do mês.'
      />

      <PageHero
        eyebrow='Resumo do mês'
        title={balance >= 0 ? 'Sobra prevista' : 'Atenção ao deficit'}
        description={
          balance >= 0
            ? 'Suas entradas cobrem as despesas recorrentes neste mês.'
            : 'As saídas estão acima das entradas. Vale revisar cartões e recorrências.'
        }
      >
        <div className='grid gap-3 sm:grid-cols-2'>
          <div className='rounded-xl border border-border bg-black/25 p-4'>
            <p className='text-xs text-muted-foreground'>Saldo do mês</p>
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
            <p className='text-xs text-muted-foreground'>% recorrentes</p>
            <p className='mt-2 text-2xl font-semibold text-neon-amber'>
              {formatPercent(recurringShare)}
            </p>
          </div>
        </div>
      </PageHero>

      <div className='grid gap-4 sm:grid-cols-2 xl:grid-cols-4'>
        <KpiCard
          label='Entradas do mês'
          value={formatCurrency(income)}
          tone='positive'
          icon={<ArrowUpRight className='size-4 text-neon-green' />}
        />
        <KpiCard
          label='Saídas do mês'
          value={formatCurrency(expenses)}
          tone='amber'
          icon={<ArrowDownRight className='size-4 text-neon-amber' />}
        />
        <KpiCard
          label='Gasto médio mensal'
          value={formatCurrency(averageExpense)}
          hint='Média dos últimos meses'
          icon={<Wallet className='size-4' />}
        />
        <KpiCard
          label='Saldo do mês'
          value={formatCurrency(balance)}
          hint={balance >= 0 ? 'Sobra prevista' : 'Deficit previsto'}
          tone={balance >= 0 ? 'positive' : 'negative'}
          icon={
            balance >= 0 ? (
              <Scale className='size-4 text-neon-green' />
            ) : (
              <Percent className='size-4 text-rose-400' />
            )
          }
        />
      </div>

      <div className='grid gap-4 xl:grid-cols-3'>
        <SectionPanel
          title='Entrada vs saída'
          description='Comparativo dos últimos 6 meses'
          className='xl:col-span-2'
        >
          <IncomeExpenseAreaChart />
        </SectionPanel>

        <SectionPanel
          title='Composição recorrente'
          description='Despesas por categoria'
        >
          <CategoryDonutChart />
        </SectionPanel>
      </div>

      <div className='grid gap-4 xl:grid-cols-2'>
        <SectionPanel
          title='Este mês vs mês passado'
          description='Entradas e saídas lado a lado'
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
