import { useMemo, useState } from 'react';
import { Plus, Receipt } from 'lucide-react';

import {
  ExpenseDeleteDialog,
  ExpensePayDialog,
} from '@/components/expenses/expense-confirm-dialogs';
import { ExpenseFiltersBar } from '@/components/expenses/expense-filters-bar';
import { ExpenseFormDialog } from '@/components/expenses/expense-form-dialog';
import { ExpenseListCard } from '@/components/expenses/expense-list-card';
import { ExpenseSummaryHero } from '@/components/expenses/expense-summary-hero';
import { ExpenseTable } from '@/components/expenses/expense-table';
import { useExpenseActions } from '@/components/expenses/use-expense-actions';
import { PageHeader } from '@/components/layout/page-header';
import { SectionPanel } from '@/components/layout/section-panel';
import {
  ListEmpty,
  ListError,
  ListFooter,
  ListLoading,
} from '@/components/shared/schedule-form/list-parts';
import { Button } from '@/components/ui/button';
import { useCardList } from '@/hooks/use-cards';
import { useExpenses } from '@/hooks/use-expenses';
import { useFinancialNow } from '@/hooks/use-financial-now';
import { useMonthlyExpenses } from '@/hooks/use-monthly-history';
import { expenseContributionThisMonth } from '@/lib/expense-schedule';
import { matchesListFilter } from '@/lib/list-filter';
import type { RecurringExpense } from '@/types/finance';

export function ExpensesPage() {
  const { data: expenses = [], isLoading, isError } = useExpenses();
  const cards = useCardList();
  const total = useMonthlyExpenses();
  const now = useFinancialNow();
  const actions = useExpenseActions(now);

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<RecurringExpense | null>(null);

  const filtered = useMemo(
    () =>
      expenses.filter((expense) =>
        matchesListFilter(expense, expense.category, search, category),
      ),
    [expenses, search, category],
  );

  const filteredTotal = useMemo(
    () =>
      filtered.reduce(
        (sum, expense) => sum + expenseContributionThisMonth(expense, now),
        0,
      ),
    [filtered, now],
  );

  function openForm(expense: RecurringExpense | null) {
    setEditing(expense);
    setDialogOpen(true);
  }

  return (
    <div className='space-y-6'>
      <title>Despesas | deManage</title>
      <PageHeader
        title='Despesas'
        description='Assinaturas, parcelas, dívidas e outros gastos recorrentes.'
        actions={
          <Button onClick={() => openForm(null)} className='rounded-lg'>
            <Plus className='size-4' />
            Nova despesa
          </Button>
        }
      />

      <ExpenseSummaryHero
        count={expenses.length}
        total={total}
        filteredTotal={filteredTotal}
      />

      <SectionPanel>
        <ExpenseFiltersBar
          search={search}
          onSearchChange={setSearch}
          category={category}
          onCategoryChange={setCategory}
        />

        {isLoading ? (
          <ListLoading />
        ) : isError ? (
          <ListError message='Não foi possível carregar as despesas.' />
        ) : filtered.length === 0 ? (
          <ListEmpty
            icon={Receipt}
            iconClassName='text-neon-amber'
            iconBoxClassName='bg-neon-amber/10'
            title='Nenhuma despesa encontrada'
            description='Ajuste o filtro ou cadastre uma nova recorrência.'
          />
        ) : (
          <>
            <div className='space-y-3 md:hidden'>
              {filtered.map((expense) => (
                <ExpenseListCard
                  key={expense.id}
                  expense={expense}
                  cards={cards}
                  now={now}
                  pending={actions.pending}
                  onPay={() => actions.askPay(expense)}
                  onEdit={() => openForm(expense)}
                  onDelete={() => actions.askDelete(expense)}
                />
              ))}
            </div>
            <ExpenseTable
              expenses={filtered}
              cards={cards}
              now={now}
              pending={actions.pending}
              onPay={actions.askPay}
              onEdit={openForm}
              onDelete={actions.askDelete}
            />
          </>
        )}

        <ListFooter
          count={filtered.length}
          noun='despesa'
          filteredTotal={filteredTotal}
          total={total}
        />
      </SectionPanel>

      <ExpenseFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        expense={editing}
      />
      <ExpensePayDialog
        expense={actions.confirmPay}
        now={now}
        onCancel={() => actions.askPay(null)}
        onConfirm={() => void actions.runPay()}
      />
      <ExpenseDeleteDialog
        expense={actions.confirmDelete}
        onCancel={() => actions.askDelete(null)}
        onConfirm={() => void actions.runDelete()}
      />
    </div>
  );
}
