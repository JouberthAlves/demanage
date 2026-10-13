import { useMemo, useState } from 'react';
import { Plus, TrendingUp } from 'lucide-react';
import { toast } from 'sonner';

import { IncomeDeleteDialog } from '@/components/income/income-delete-dialog';
import { IncomeFiltersBar } from '@/components/income/income-filters-bar';
import { IncomeFormDialog } from '@/components/income/income-form-dialog';
import { IncomeListCard } from '@/components/income/income-list-card';
import { IncomeSummaryHero } from '@/components/income/income-summary-hero';
import { IncomeTable } from '@/components/income/income-table';
import { useIncomeActions } from '@/components/income/use-income-actions';
import { PageHeader } from '@/components/layout/page-header';
import { SectionPanel } from '@/components/layout/section-panel';
import {
  ListEmpty,
  ListError,
  ListFooter,
  ListLoading,
} from '@/components/shared/schedule-form/list-parts';
import { Button } from '@/components/ui/button';
import { useEntries } from '@/hooks/use-entries';
import { useFinancialNow } from '@/hooks/use-financial-now';
import { useMonthlyIncome } from '@/hooks/use-monthly-history';
import { incomeContributionThisMonth } from '@/lib/income-schedule';
import { matchesListFilter } from '@/lib/list-filter';
import type { Income } from '@/types/finance';

export function IncomePage() {
  const { data: incomes = [], isLoading, isError } = useEntries();
  const total = useMonthlyIncome();
  const now = useFinancialNow();
  const actions = useIncomeActions(now);

  const [search, setSearch] = useState('');
  const [type, setType] = useState('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Income | null>(null);

  const filtered = useMemo(
    () =>
      incomes.filter((income) =>
        matchesListFilter(income, income.type, search, type),
      ),
    [incomes, search, type],
  );

  const filteredTotal = useMemo(
    () =>
      filtered.reduce(
        (sum, income) => sum + incomeContributionThisMonth(income, now),
        0,
      ),
    [filtered, now],
  );

  function openForm(income: Income | null) {
    if (income?.type === 'salario') {
      toast.error('O salário é gerenciado na aba Perfil');
      return;
    }
    setEditing(income);
    setDialogOpen(true);
  }

  return (
    <div className='space-y-6'>
      <title>Entradas | deManage</title>
      <PageHeader
        title='Entradas'
        description='Salário, freelances e outras fontes de renda.'
        actions={
          <Button onClick={() => openForm(null)} className='rounded-lg'>
            <Plus className='size-4' />
            Nova entrada
          </Button>
        }
      />

      <IncomeSummaryHero
        count={incomes.length}
        total={total}
        filteredTotal={filteredTotal}
      />

      <SectionPanel>
        <IncomeFiltersBar
          search={search}
          onSearchChange={setSearch}
          type={type}
          onTypeChange={setType}
        />

        {isLoading ? (
          <ListLoading />
        ) : isError ? (
          <ListError message='Não foi possível carregar as entradas.' />
        ) : filtered.length === 0 ? (
          <ListEmpty
            icon={TrendingUp}
            iconClassName='text-neon-green'
            iconBoxClassName='bg-neon-green/10'
            title='Nenhuma entrada encontrada'
            description='Ajuste o filtro ou cadastre uma nova fonte de renda.'
          />
        ) : (
          <>
            <div className='space-y-3 md:hidden'>
              {filtered.map((income) => (
                <IncomeListCard
                  key={income.id}
                  income={income}
                  now={now}
                  receiptPending={actions.receiptPending}
                  deletePending={actions.deletePending}
                  onReceipt={actions.setReceipt}
                  onEdit={() => openForm(income)}
                  onDelete={() => actions.askDelete(income)}
                />
              ))}
            </div>
            <IncomeTable
              incomes={filtered}
              now={now}
              receiptPending={actions.receiptPending}
              deletePending={actions.deletePending}
              onReceipt={actions.setReceipt}
              onEdit={openForm}
              onDelete={actions.askDelete}
            />
          </>
        )}

        <ListFooter
          count={filtered.length}
          noun='entrada'
          filteredTotal={filteredTotal}
          total={total}
        />
      </SectionPanel>

      <IncomeFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        income={editing}
      />
      <IncomeDeleteDialog
        income={actions.confirmDelete}
        onCancel={() => actions.askDelete(null)}
        onConfirm={() => void actions.runDelete()}
      />
    </div>
  );
}
