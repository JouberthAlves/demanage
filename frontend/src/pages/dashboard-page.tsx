import { CardCommitmentChart } from '@/components/dashboard/card-commitment-chart';
import { CategoryDonutChart } from '@/components/dashboard/category-donut-chart';
import { IncomeExpenseAreaChart } from '@/components/dashboard/income-expense-area-chart';
import { KpiCard } from '@/components/dashboard/kpi-card';
import { MonthCompareBarChart } from '@/components/dashboard/month-compare-bar-chart';
import { PageHeader } from '@/components/layout/page-header';
import { formatCurrency, formatPercent } from '@/lib/format';
import {
  selectAverageMonthlyExpense,
  selectMonthlyExpenses,
  selectMonthlyIncome,
  selectRecurringShare,
  useFinanceStore,
} from '@/stores/finance-store';

export function DashboardPage() {
  const profileName = useFinanceStore((state) => state.profile.name);
  const income = useFinanceStore(selectMonthlyIncome);
  const expenses = useFinanceStore(selectMonthlyExpenses);
  const averageExpense = useFinanceStore(selectAverageMonthlyExpense);
  const recurringShare = useFinanceStore(selectRecurringShare);
  const balance = income - expenses;

  return (
    <div className='space-y-6'>
      <title>Dashboard | deManage</title>
      <PageHeader
        title={`Olá, ${profileName || 'bem-vindo'}`}
        description='Visão geral das entradas, saídas e despesas recorrentes do mês.'
      />

      <div className='grid gap-4 sm:grid-cols-2 xl:grid-cols-5'>
        <KpiCard label='Entradas do mês' value={formatCurrency(income)} />
        <KpiCard label='Saídas do mês' value={formatCurrency(expenses)} />
        <KpiCard
          label='Gasto médio mensal'
          value={formatCurrency(averageExpense)}
          hint='Média dos últimos meses'
        />
        <KpiCard
          label='% recorrentes'
          value={formatPercent(recurringShare)}
          hint='Sobre as entradas'
        />
        <KpiCard
          label='Saldo do mês'
          value={formatCurrency(balance)}
          hint={balance >= 0 ? 'Sobra prevista' : 'Deficit previsto'}
          tone={balance >= 0 ? 'positive' : 'negative'}
        />
      </div>

      <div className='grid gap-4 xl:grid-cols-3'>
        <div className='rounded-xl border border-border p-5 xl:col-span-2'>
          <div className='mb-4'>
            <h2 className='text-base font-medium'>Entrada vs saída</h2>
            <p className='text-sm text-muted-foreground'>
              Comparativo dos últimos 6 meses
            </p>
          </div>
          <IncomeExpenseAreaChart />
        </div>

        <div className='rounded-xl border border-border p-5'>
          <div className='mb-4'>
            <h2 className='text-base font-medium'>Composição recorrente</h2>
            <p className='text-sm text-muted-foreground'>
              Despesas por categoria
            </p>
          </div>
          <CategoryDonutChart />
        </div>
      </div>

      <div className='grid gap-4 xl:grid-cols-2'>
        <div className='rounded-xl border border-border p-5'>
          <div className='mb-4'>
            <h2 className='text-base font-medium'>Este mês vs mês passado</h2>
            <p className='text-sm text-muted-foreground'>
              Entradas e saídas lado a lado
            </p>
          </div>
          <MonthCompareBarChart />
        </div>

        <div className='rounded-xl border border-border p-5'>
          <div className='mb-4'>
            <h2 className='text-base font-medium'>Comprometimento do cartão</h2>
            <p className='text-sm text-muted-foreground'>
              % do limite usado por despesas vinculadas
            </p>
          </div>
          <CardCommitmentChart />
        </div>
      </div>
    </div>
  );
}
