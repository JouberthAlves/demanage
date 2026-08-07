import { isAxiosError } from 'axios';
import { Pencil, Plus, Search, Trash2, TrendingUp } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { IncomeFormDialog } from '@/components/income/income-form-dialog';
import {
  IncomeListCard,
  typeColors,
} from '@/components/income/income-list-card';
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
  BUILTIN_INCOME_TYPE_LABELS,
  INCOME_FREQUENCY_LABELS,
  INCOME_TYPE_LABELS,
  MONTH_LABELS,
  incomeTypeLabel,
  tagBadgeStyle,
} from '@/data/labels';
import { useCustomTags } from '@/hooks/use-custom-tags';
import { useDeleteEntry, useEntries } from '@/hooks/use-entries';
import { formatCurrency } from '@/lib/format';
import {
  incomeContributionThisMonth,
  isIncomeReceivedThisMonth,
} from '@/lib/income-schedule';
import { selectMonthlyIncome, useFinanceStore } from '@/stores/finance-store';
import type { Income } from '@/types/finance';

export function IncomePage() {
  const { data: incomes = [], isLoading, isError } = useEntries();
  const { data: customTags = [] } = useCustomTags('income');
  const removeEntry = useDeleteEntry();
  const total = useFinanceStore(selectMonthlyIncome);

  const [search, setSearch] = useState('');
  const [type, setType] = useState<string>('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Income | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Income | null>(null);

  const filtered = useMemo(() => {
    return incomes.filter((income) => {
      const matchesSearch = income.name
        .toLowerCase()
        .includes(search.toLowerCase());
      const matchesType =
        type === 'all' ||
        (type.startsWith('tag:')
          ? income.customTagId === type.slice(4)
          : income.type === type && !income.customTagId);
      return matchesSearch && matchesType;
    });
  }, [incomes, search, type]);

  const filteredTotal = useMemo(
    () =>
      filtered.reduce(
        (sum, income) => sum + incomeContributionThisMonth(income),
        0,
      ),
    [filtered],
  );

  function openCreate() {
    setEditing(null);
    setDialogOpen(true);
  }

  function openEdit(income: Income) {
    setEditing(income);
    setDialogOpen(true);
  }

  async function handleDelete(id: string, name: string) {
    try {
      await removeEntry.mutateAsync(id);
      toast.success(`Entrada "${name}" removida`);
    } catch (err) {
      const message = isAxiosError(err)
        ? (err.response?.data?.error ?? 'Não foi possível remover a entrada')
        : 'Não foi possível remover a entrada';
      toast.error(message);
    }
  }

  return (
    <div className='space-y-6'>
      <title>Entradas | deManage</title>
      <PageHeader
        title='Entradas'
        description='Salário, freelances e outras fontes de renda.'
        actions={
          <Button onClick={openCreate} className='rounded-lg'>
            <Plus className='size-4' />
            Nova entrada
          </Button>
        }
      />

      <PageHero
        eyebrow='Receitas'
        title={`${incomes.length} entrada${incomes.length === 1 ? '' : 's'}`}
        description='O saldo do mês só conta entradas a partir do dia de recebimento.'
      >
        <div className='grid gap-3 sm:grid-cols-2'>
          <div className='rounded-xl border border-border bg-black/25 p-4'>
            <p className='text-xs text-muted-foreground'>
              Já no saldo / mês
            </p>
            <p className='mt-2 text-2xl font-semibold text-neon-green'>
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
              placeholder='Buscar entradas por nome...'
              className='rounded-lg pl-9'
            />
          </div>
          <Select
            value={type}
            onValueChange={(value) => {
              if (value) setType(value);
            }}
          >
            <SelectTrigger className='w-full rounded-lg sm:w-48'>
              <SelectValue placeholder='Tipo' />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='all'>Todos</SelectItem>
              <SelectItem value='salario'>
                {INCOME_TYPE_LABELS.salario}
              </SelectItem>
              {Object.entries(BUILTIN_INCOME_TYPE_LABELS).map(
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
            Não foi possível carregar as entradas.
          </div>
        ) : filtered.length === 0 ? (
          <div className='flex h-40 flex-col items-center justify-center gap-2 rounded-xl border border-border bg-black/15 text-center'>
            <div className='flex size-12 items-center justify-center rounded-2xl bg-neon-green/10'>
              <TrendingUp className='size-6 text-neon-green' />
            </div>
            <p className='font-medium'>Nenhuma entrada encontrada</p>
            <p className='text-sm text-muted-foreground'>
              Ajuste o filtro ou cadastre uma nova fonte de renda.
            </p>
          </div>
        ) : (
          <>
            <div className='space-y-3 md:hidden'>
              {filtered.map((income) => (
                <IncomeListCard
                  key={income.id}
                  income={income}
                  pending={removeEntry.isPending}
                  onEdit={() => openEdit(income)}
                  onDelete={() => setConfirmDelete(income)}
                />
              ))}
            </div>

            <div className='hidden max-h-[70vh] overflow-auto rounded-xl border border-border bg-black/15 md:block'>
              <Table>
                <TableHeader className='sticky top-0 z-10 bg-card'>
                  <TableRow className='hover:bg-transparent'>
                    <TableHead>Nome</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Frequência</TableHead>
                    <TableHead>Recebe</TableHead>
                    <TableHead>Término</TableHead>
                    <TableHead className='text-right'>Valor</TableHead>
                    <TableHead className='w-24 text-right'>Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((income) => {
                    const received = isIncomeReceivedThisMonth(income);

                    return (
                      <TableRow key={income.id}>
                        <TableCell className='font-medium'>
                          {income.name}
                          {income.frequency !== 'unica' && !received ? (
                            <span className='mt-0.5 block text-xs text-muted-foreground'>
                              Aguardando dia {income.receiveDay ?? '—'}
                            </span>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          {income.customTag ? (
                            <Badge
                              variant='outline'
                              style={tagBadgeStyle(income.customTag.color)}
                            >
                              {income.customTag.name}
                            </Badge>
                          ) : (
                            <Badge
                              variant='outline'
                              className={typeColors[income.type]}
                            >
                              {incomeTypeLabel(income)}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className='text-muted-foreground'>
                          {INCOME_FREQUENCY_LABELS[income.frequency]}
                        </TableCell>
                        <TableCell className='text-muted-foreground'>
                          {income.frequency === 'unica'
                            ? income.date
                              ? income.date.split('-').reverse().join('/')
                              : '—'
                            : income.receiveDay
                              ? `Dia ${String(income.receiveDay).padStart(2, '0')}${
                                  income.startsAt
                                    ? ` · ${MONTH_LABELS[Number(income.startsAt.slice(5, 7))] ?? ''}`
                                    : ''
                                }`
                              : '—'}
                        </TableCell>
                        <TableCell className='text-muted-foreground'>
                          {income.type === 'salario'
                            ? '—'
                            : income.endsAt
                              ? income.endsAt.split('-').reverse().join('/')
                              : '—'}
                        </TableCell>
                        <TableCell className='text-right font-semibold text-neon-green'>
                          {formatCurrency(income.amount)}
                        </TableCell>
                        <TableCell className='text-right'>
                          {income.type === 'salario' ? (
                            <span className='text-xs text-muted-foreground'>
                              Perfil
                            </span>
                          ) : (
                            <div className='flex justify-end gap-1'>
                              <Button
                                variant='ghost'
                                size='icon-sm'
                                onClick={() => openEdit(income)}
                              >
                                <Pencil className='size-4' />
                              </Button>
                              <Button
                                variant='ghost'
                                size='icon-sm'
                                disabled={removeEntry.isPending}
                                onClick={() => setConfirmDelete(income)}
                              >
                                <Trash2 className='size-4' />
                              </Button>
                            </div>
                          )}
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
          {filtered.length} entrada{filtered.length === 1 ? '' : 's'} •{' '}
          {formatCurrency(filteredTotal)} filtrado
          {filteredTotal !== total
            ? ` · ${formatCurrency(total)} no total`
            : ' / mês'}
        </p>
      </SectionPanel>

      <IncomeFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        income={editing}
      />

      <AlertDialog
        open={confirmDelete != null}
        onOpenChange={(open) => {
          if (!open) setConfirmDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir entrada?</AlertDialogTitle>
            <AlertDialogDescription>
              A entrada &quot;{confirmDelete?.name}&quot; será removida
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
