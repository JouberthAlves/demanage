import { isAxiosError } from 'axios';
import { Pencil, Plus, Receipt, Search, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { ExpenseFormDialog } from '@/components/expenses/expense-form-dialog';
import {
  ExpenseListCard,
  categoryColors,
} from '@/components/expenses/expense-list-card';
import { PageHeader } from '@/components/layout/page-header';
import { PageHero } from '@/components/layout/page-hero';
import { SectionPanel } from '@/components/layout/section-panel';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  BUILTIN_EXPENSE_CATEGORY_LABELS,
  EXPENSE_FREQUENCY_LABELS,
  MONTH_LABELS,
  expenseTypeLabel,
  tagBadgeStyle,
} from '@/data/labels';
import { useCustomTags } from '@/hooks/use-custom-tags';
import {
  useDeleteExpense,
  useExpenses,
  useMarkExpensePaid,
} from '@/hooks/use-expenses';
import { getCardTone } from '@/lib/card-tone';
import {
  canPayExpenseEarly,
  expenseContributionThisMonth,
  expenseMonthKey,
  isExpenseAutoDebitedThisMonth,
  isExpensePaidThisMonth,
} from '@/lib/expense-schedule';
import {
  expenseCashAmount,
  formatExpensePaymentLabel,
} from '@/lib/expense-splits';
import { formatCurrency } from '@/lib/format';
import { selectMonthlyExpenses, useFinanceStore } from '@/stores/finance-store';
import type { RecurringExpense } from '@/types/finance';

function dateFromDayKey(dayKey: string) {
  const [year, month, day] = dayKey.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function expensePayState(
  expense: RecurringExpense,
  now: Date,
  pending: boolean,
) {
  const isRecurring = expense.frequency !== 'unica' && !expense.isInvoice;
  if (!isRecurring) return { label: 'Pago', disabled: pending };

  const hasCash = expenseCashAmount(expense) > 0;
  if (!hasCash) return { label: 'Via fatura', disabled: true };
  if (isExpensePaidThisMonth(expense, now)) {
    return { label: 'Pago', disabled: true };
  }
  if (isExpenseAutoDebitedThisMonth(expense, now)) {
    return { label: 'Descontada', disabled: true };
  }
  if (canPayExpenseEarly(expense, now)) {
    return { label: 'Pagar agora', disabled: pending };
  }
  return { label: 'Aguardando', disabled: true };
}

export function ExpensesPage() {
  const { data: expenses = [], isLoading, isError } = useExpenses();
  const { data: customTags = [] } = useCustomTags('expense');
  const cards = useFinanceStore((state) => state.profile.cards);
  const calendarDayKey = useFinanceStore((state) => state.calendarDayKey);
  const removeExpense = useDeleteExpense();
  const markExpensePaid = useMarkExpensePaid();
  const total = useFinanceStore(selectMonthlyExpenses);
  const now = useMemo(() => dateFromDayKey(calendarDayKey), [calendarDayKey]);
  const mutationPending = removeExpense.isPending || markExpensePaid.isPending;

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string>('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<RecurringExpense | null>(null);
  const [confirmPay, setConfirmPay] = useState<RecurringExpense | null>(null);
  const [confirmDelete, setConfirmDelete] =
    useState<RecurringExpense | null>(null);

  const filtered = useMemo(() => {
    return expenses.filter((expense) => {
      const matchesSearch = expense.name
        .toLowerCase()
        .includes(search.toLowerCase());
      const matchesCategory =
        category === 'all' ||
        (category.startsWith('tag:')
          ? expense.customTagId === category.slice(4)
          : expense.category === category && !expense.customTagId);
      return matchesSearch && matchesCategory;
    });
  }, [expenses, search, category]);

  const filteredTotal = useMemo(
    () =>
      filtered.reduce(
        (sum, expense) => sum + expenseContributionThisMonth(expense, now),
        0,
      ),
    [filtered, now],
  );

  function openCreate() {
    setEditing(null);
    setDialogOpen(true);
  }

  function openEdit(expense: RecurringExpense) {
    setEditing(expense);
    setDialogOpen(true);
  }

  async function handlePay(expense: RecurringExpense) {
    try {
      if (!expense.isInvoice && expense.frequency === 'mensal') {
        await markExpensePaid.mutateAsync({
          id: expense.id,
          month: expenseMonthKey(now),
        });
        toast.success(`"${expense.name}" paga antecipadamente neste mês`);
        return;
      }

      await removeExpense.mutateAsync(expense.id);
      toast.success(`"${expense.name}" marcada como paga`);
    } catch (err) {
      const message = isAxiosError(err)
        ? (err.response?.data?.error ?? 'Não foi possível marcar como paga')
        : 'Não foi possível marcar como paga';
      toast.error(message);
    }
  }

  async function handleDelete(id: string, name: string) {
    try {
      await removeExpense.mutateAsync(id);
      toast.success(`Despesa "${name}" removida`);
    } catch (err) {
      const message = isAxiosError(err)
        ? (err.response?.data?.error ?? 'Não foi possível remover a despesa')
        : 'Não foi possível remover a despesa';
      toast.error(message);
    }
  }

  const confirmPayIsRecurring =
    confirmPay != null &&
    !confirmPay.isInvoice &&
    confirmPay.frequency === 'mensal';

  return (
    <div className='space-y-6'>
      <title>Despesas | deManage</title>
      <PageHeader
        title='Despesas'
        description='Assinaturas, parcelas, dívidas e outros gastos recorrentes.'
        actions={
          <Button onClick={openCreate} className='rounded-lg'>
            <Plus className='size-4' />
            Nova despesa
          </Button>
        }
      />

      <PageHero
        eyebrow='Recorrências'
        title={`${expenses.length} despesa${expenses.length === 1 ? '' : 's'}`}
        description='O saldo conta o pagamento antecipado na hora ou desconta automaticamente no dia configurado.'
      >
        <div className='grid gap-3 sm:grid-cols-2'>
          <div className='rounded-xl border border-border bg-black/25 p-4'>
            <p className='text-xs text-muted-foreground'>Já no saldo / mês</p>
            <p className='mt-2 text-2xl font-semibold text-neon-amber'>
              {formatCurrency(total)}
            </p>
          </div>
          <div className='rounded-xl border border-border bg-black/25 p-4'>
            <p className='text-xs text-muted-foreground'>Resultado do filtro</p>
            <p className='mt-2 text-2xl font-semibold'>
              {formatCurrency(filteredTotal)}
            </p>
          </div>
        </div>
      </PageHero>

      <SectionPanel>
        <div className='mb-4 flex flex-col gap-3 sm:flex-row'>
          <div className='relative flex-1'>
            <Search className='pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground' />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder='Buscar despesas por nome...'
              className='rounded-lg pl-9'
            />
          </div>
          <Select
            value={category}
            onValueChange={(value) => {
              if (value) setCategory(value);
            }}
          >
            <SelectTrigger className='w-full rounded-lg sm:w-48'>
              <SelectValue placeholder='Categoria' />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='all'>Todas</SelectItem>
              <SelectItem value='cofrinho'>Cofrinho</SelectItem>
              {Object.entries(BUILTIN_EXPENSE_CATEGORY_LABELS).map(
                ([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ),
              )}
              {customTags.map((tag) => (
                <SelectItem key={tag.id} value={`tag:${tag.id}`}>
                  {tag.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <div className='flex h-28 items-center justify-center rounded-xl border border-border bg-black/15'>
            <Spinner className='size-5' />
          </div>
        ) : isError ? (
          <div className='flex h-28 items-center justify-center rounded-xl border border-border bg-black/15 text-destructive'>
            Não foi possível carregar as despesas.
          </div>
        ) : filtered.length === 0 ? (
          <div className='flex h-40 flex-col items-center justify-center gap-2 rounded-xl border border-border bg-black/15 text-center'>
            <div className='flex size-12 items-center justify-center rounded-2xl bg-neon-amber/10'>
              <Receipt className='size-6 text-neon-amber' />
            </div>
            <p className='font-medium'>Nenhuma despesa encontrada</p>
            <p className='text-sm text-muted-foreground'>
              Ajuste o filtro ou cadastre uma nova recorrência.
            </p>
          </div>
        ) : (
          <>
            <div className='space-y-3 md:hidden'>
              {filtered.map((expense) => (
                <ExpenseListCard
                  key={expense.id}
                  expense={expense}
                  cards={cards}
                  pending={mutationPending}
                  onPay={() => setConfirmPay(expense)}
                  onEdit={() => openEdit(expense)}
                  onDelete={() => setConfirmDelete(expense)}
                />
              ))}
            </div>

            <div className='hidden max-h-[70vh] overflow-auto rounded-xl border border-border bg-black/15 md:block'>
              <Table>
                <TableHeader className='sticky top-0 z-10 bg-card'>
                  <TableRow className='hover:bg-transparent'>
                    <TableHead>Nome</TableHead>
                    <TableHead>Categoria</TableHead>
                    <TableHead>Frequência</TableHead>
                    <TableHead>Cartão</TableHead>
                    <TableHead>Desconto</TableHead>
                    <TableHead>Término</TableHead>
                    <TableHead className='text-right'>Valor</TableHead>
                    <TableHead className='w-40 text-right'>Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((expense) => {
                    const paymentLabel = formatExpensePaymentLabel(
                      expense,
                      cards,
                    );
                    const card = cards.find(
                      (item) => item.id === expense.cardId,
                    );
                    const tone = card ? getCardTone(card) : null;
                    const hasCash = expenseCashAmount(expense) > 0;
                    const paidEarly = isExpensePaidThisMonth(expense, now);
                    const autoDebited =
                      hasCash && isExpenseAutoDebitedThisMonth(expense, now);
                    const isRecurring =
                      expense.frequency !== 'unica' && !expense.isInvoice;
                    const payState = expensePayState(
                      expense,
                      now,
                      mutationPending,
                    );

                    return (
                      <TableRow key={expense.id}>
                        <TableCell className='font-medium'>
                          {expense.name}
                          {isRecurring && hasCash ? (
                            paidEarly ? (
                              <span className='mt-0.5 block text-xs text-neon-green'>
                                Pago antecipadamente
                              </span>
                            ) : autoDebited ? (
                              <span className='mt-0.5 block text-xs text-neon-green'>
                                Descontada automaticamente
                              </span>
                            ) : (
                              <span className='mt-0.5 block text-xs text-muted-foreground'>
                                Aguardando dia {expense.dueDay ?? '—'}
                              </span>
                            )
                          ) : null}
                        </TableCell>
                        <TableCell>
                          {expense.customTag ? (
                            <Badge
                              variant='outline'
                              style={tagBadgeStyle(expense.customTag.color)}
                            >
                              {expense.customTag.name}
                            </Badge>
                          ) : (
                            <Badge
                              variant='outline'
                              className={categoryColors[expense.category]}
                            >
                              {expenseTypeLabel(expense)}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className='text-muted-foreground'>
                          {EXPENSE_FREQUENCY_LABELS[expense.frequency]}
                        </TableCell>
                        <TableCell>
                          {paymentLabel ? (
                            <span className='inline-flex max-w-52 items-center gap-2 text-muted-foreground'>
                              {card && (expense.splits?.length ?? 0) <= 1 ? (
                                <span
                                  className='size-2.5 shrink-0 rounded-sm'
                                  style={{ backgroundColor: tone?.fill }}
                                />
                              ) : null}
                              <span className='min-w-0 break-words [overflow-wrap:anywhere]'>
                                {paymentLabel}
                              </span>
                            </span>
                          ) : (
                            <span className='text-muted-foreground'>—</span>
                          )}
                        </TableCell>
                        <TableCell className='text-muted-foreground'>
                          {expense.frequency === 'unica'
                            ? expense.registeredAt
                              ? expense.registeredAt
                                  .split('-')
                                  .reverse()
                                  .join('/')
                              : 'Hoje'
                            : expense.dueDay
                              ? `Dia ${String(expense.dueDay).padStart(2, '0')}${
                                  expense.startsAt
                                    ? ` · ${MONTH_LABELS[Number(expense.startsAt.slice(5, 7))] ?? ''}`
                                    : ''
                                }`
                              : '—'}
                        </TableCell>
                        <TableCell className='text-muted-foreground'>
                          {expense.frequency === 'unica' || expense.isInvoice
                            ? '—'
                            : expense.endsAt
                              ? expense.endsAt.split('-').reverse().join('/')
                              : '—'}
                        </TableCell>
                        <TableCell className='text-right font-semibold'>
                          {formatCurrency(expense.amount)}
                        </TableCell>
                        <TableCell className='text-right'>
                          <div className='flex justify-end gap-1'>
                            <Button
                              variant='secondary'
                              size='sm'
                              className='rounded-lg'
                              disabled={payState.disabled}
                              onClick={() => setConfirmPay(expense)}
                            >
                              {payState.label}
                            </Button>
                            {!expense.isInvoice ? (
                              <Button
                                variant='ghost'
                                size='icon-sm'
                                onClick={() => openEdit(expense)}
                              >
                                <Pencil className='size-4' />
                              </Button>
                            ) : null}
                            <Button
                              variant='ghost'
                              size='icon-sm'
                              disabled={mutationPending}
                              onClick={() => setConfirmDelete(expense)}
                            >
                              <Trash2 className='size-4' />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </>
        )}

        <p className='mt-3 text-sm text-muted-foreground'>
          {filtered.length} despesa{filtered.length === 1 ? '' : 's'} •{' '}
          {formatCurrency(filteredTotal)} filtrado
          {filteredTotal !== total
            ? ` · ${formatCurrency(total)} no total`
            : ' / mês'}
        </p>
      </SectionPanel>

      <ExpenseFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        expense={editing}
      />

      <AlertDialog
        open={confirmPay != null}
        onOpenChange={(open) => {
          if (!open) setConfirmPay(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmPayIsRecurring ? 'Pagar antecipadamente?' : 'Marcar como paga?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmPayIsRecurring ? (
                <>
                  Isso marca o ciclo deste mês de &quot;{confirmPay?.name}&quot;
                  como pago agora. A recorrência continua normalmente nos
                  próximos meses e o valor entra no saldo imediatamente.
                </>
              ) : (
                <>
                  Isso marca &quot;{confirmPay?.name}&quot; como paga e remove esse
                  item concluído da lista.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!confirmPay) return;
                void handlePay(confirmPay);
                setConfirmPay(null);
              }}
            >
              {confirmPayIsRecurring ? 'Pagar agora' : 'Marcar como paga'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={confirmDelete != null}
        onOpenChange={(open) => {
          if (!open) setConfirmDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir despesa?</AlertDialogTitle>
            <AlertDialogDescription>
              A despesa &quot;{confirmDelete?.name}&quot; será removida
              permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              variant='destructive'
              onClick={() => {
                if (!confirmDelete) return;
                void handleDelete(confirmDelete.id, confirmDelete.name);
                setConfirmDelete(null);
              }}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
