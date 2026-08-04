import { isAxiosError } from 'axios';
import { Pencil, Plus, Search, Trash2, TrendingUp } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { IncomeFormDialog } from '@/components/income/income-form-dialog';
import { PageHeader } from '@/components/layout/page-header';
import { PageHero } from '@/components/layout/page-hero';
import { SectionPanel } from '@/components/layout/section-panel';
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
import { INCOME_FREQUENCY_LABELS, INCOME_TYPE_LABELS } from '@/data/labels';
import { useDeleteEntry, useEntries } from '@/hooks/use-entries';
import { formatCurrency } from '@/lib/format';
import { selectMonthlyIncome, useFinanceStore } from '@/stores/finance-store';
import type { Income, IncomeType } from '@/types/finance';

const typeColors: Record<IncomeType, string> = {
  salario: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  freelance: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  outro: 'bg-zinc-500/15 text-zinc-300 border-zinc-500/30',
};

export function IncomePage() {
  const { data: incomes = [], isLoading, isError } = useEntries();
  const removeEntry = useDeleteEntry();
  const total = useFinanceStore(selectMonthlyIncome);

  const [search, setSearch] = useState('');
  const [type, setType] = useState<string>('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Income | null>(null);

  const filtered = useMemo(() => {
    return incomes.filter((income) => {
      const matchesSearch = income.name
        .toLowerCase()
        .includes(search.toLowerCase());
      const matchesType = type === 'all' || income.type === type;
      return matchesSearch && matchesType;
    });
  }, [incomes, search, type]);

  const filteredTotal = useMemo(
    () => filtered.reduce((sum, income) => sum + income.amount, 0),
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
        description='Organize o que entra todo mês e o que é pontual.'
      >
        <div className='grid gap-3 sm:grid-cols-2'>
          <div className='rounded-xl border border-border bg-black/25 p-4'>
            <p className='text-xs text-muted-foreground'>
              Recorrentes / mês
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
              {Object.entries(INCOME_TYPE_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className='overflow-hidden rounded-xl border border-border bg-black/15'>
          <Table>
            <TableHeader>
              <TableRow className='hover:bg-transparent'>
                <TableHead>Nome</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Frequência</TableHead>
                <TableHead className='text-right'>Valor</TableHead>
                <TableHead className='w-24 text-right'>Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className='h-28 text-center'>
                    <Spinner className='mx-auto size-5' />
                  </TableCell>
                </TableRow>
              ) : isError ? (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className='h-28 text-center text-destructive'
                  >
                    Não foi possível carregar as entradas.
                  </TableCell>
                </TableRow>
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className='h-40'>
                    <div className='flex flex-col items-center justify-center gap-2 text-center'>
                      <div className='flex size-12 items-center justify-center rounded-2xl bg-neon-green/10'>
                        <TrendingUp className='size-6 text-neon-green' />
                      </div>
                      <p className='font-medium'>Nenhuma entrada encontrada</p>
                      <p className='text-sm text-muted-foreground'>
                        Ajuste o filtro ou cadastre uma nova fonte de renda.
                      </p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((income) => (
                  <TableRow key={income.id}>
                    <TableCell className='font-medium'>{income.name}</TableCell>
                    <TableCell>
                      <Badge
                        variant='outline'
                        className={typeColors[income.type]}
                      >
                        {INCOME_TYPE_LABELS[income.type]}
                      </Badge>
                    </TableCell>
                    <TableCell className='text-muted-foreground'>
                      {INCOME_FREQUENCY_LABELS[income.frequency]}
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
                            onClick={() =>
                              void handleDelete(income.id, income.name)
                            }
                          >
                            <Trash2 className='size-4' />
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        <p className='mt-3 text-sm text-muted-foreground'>
          {filtered.length} entrada{filtered.length === 1 ? '' : 's'} •{' '}
          {formatCurrency(total)} / mês (recorrentes)
        </p>
      </SectionPanel>

      <IncomeFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        income={editing}
      />
    </div>
  );
}
