import { isAxiosError } from 'axios';
import {
  Archive,
  PiggyBank as PiggyIcon,
  Plus,
  ShieldAlert,
  Trash2,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { PiggyFormDialog } from '@/components/piggy/piggy-form-dialog';
import { PiggyMoneyDialog } from '@/components/piggy/piggy-money-dialog';
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
import { Spinner } from '@/components/ui/spinner';
import {
  useArchivePiggyBank,
  useDeletePiggyBank,
  usePiggyBanks,
  usePiggyTransactions,
} from '@/hooks/use-piggy-banks';
import { formatCurrency, formatPercent } from '@/lib/format';
import type { PiggyBank } from '@/types/finance';

export function PiggyPage() {
  const { data: banks = [], isLoading, isError } = usePiggyBanks();
  const archiveBank = useArchivePiggyBank();
  const deleteBank = useDeletePiggyBank();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<PiggyBank | null>(null);
  const [moneyOpen, setMoneyOpen] = useState(false);
  const [moneyMode, setMoneyMode] = useState<'deposit' | 'withdraw'>('deposit');
  const [activeBank, setActiveBank] = useState<PiggyBank | null>(null);
  const [historyBankId, setHistoryBankId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<PiggyBank | null>(null);

  const { data: history = [], isLoading: historyLoading } =
    usePiggyTransactions(historyBankId);

  const totalBalance = useMemo(
    () => banks.reduce((sum, bank) => sum + bank.balance, 0),
    [banks],
  );

  function openCreate() {
    setEditing(null);
    setFormOpen(true);
  }

  function openEdit(bank: PiggyBank) {
    setEditing(bank);
    setFormOpen(true);
  }

  function openMoney(bank: PiggyBank, mode: 'deposit' | 'withdraw') {
    setActiveBank(bank);
    setMoneyMode(mode);
    setMoneyOpen(true);
  }

  async function handleArchive(bank: PiggyBank) {
    try {
      await archiveBank.mutateAsync(bank.id);
      toast.success(`"${bank.name}" arquivado`);
      if (historyBankId === bank.id) setHistoryBankId(null);
    } catch (err) {
      const message = isAxiosError(err)
        ? (err.response?.data?.error ?? 'Não foi possível arquivar')
        : 'Não foi possível arquivar';
      toast.error(message);
    }
  }

  async function handleDelete(bank: PiggyBank) {
    try {
      await deleteBank.mutateAsync(bank.id);
      toast.success(`Cofre "${bank.name}" removido`);
      if (historyBankId === bank.id) setHistoryBankId(null);
    } catch (err) {
      const message = isAxiosError(err)
        ? (err.response?.data?.error ?? 'Não foi possível excluir')
        : 'Não foi possível excluir';
      toast.error(message);
    }
  }

  return (
    <div className='flex flex-col gap-6'>
      <title>Cofrinho | deManage</title>
      <PageHeader
        title='Cofrinho'
        description='Guarde com meta mensal. Cada depósito vira despesa Cofrinho e reduz o saldo.'
        actions={
          <Button onClick={openCreate} className='rounded-lg'>
            <Plus data-icon='inline-start' />
            Novo cofre
          </Button>
        }
      />

      <PageHero
        eyebrow='Reservas'
        title={`${banks.length} cofre${banks.length === 1 ? '' : 's'}`}
        description='Meta mensal = meta final ÷ meses até a data. Auto-débito no dia 1, se ligado.'
      >
        <div className='rounded-xl border border-border bg-black/25 p-4'>
          <p className='text-xs text-muted-foreground'>Total nos cofres</p>
          <p className='mt-2 text-2xl font-semibold text-violet-300'>
            {formatCurrency(totalBalance)}
          </p>
        </div>
      </PageHero>

      {isLoading ? (
        <div className='flex h-40 items-center justify-center'>
          <Spinner className='size-5' />
        </div>
      ) : isError ? (
        <p className='text-sm text-destructive'>
          Não foi possível carregar os cofres.
        </p>
      ) : banks.length === 0 ? (
        <SectionPanel>
          <div className='flex flex-col items-center justify-center gap-3 py-12 text-center'>
            <div className='flex size-12 items-center justify-center rounded-2xl bg-violet-500/15'>
              <PiggyIcon className='size-6 text-violet-300' />
            </div>
            <p className='font-medium'>Nenhum cofre ainda</p>
            <p className='text-sm text-muted-foreground'>
              Crie um cofre com meta e data para começar a guardar.
            </p>
            <Button onClick={openCreate} className='rounded-lg'>
              <Plus data-icon='inline-start' />
              Criar cofre
            </Button>
          </div>
        </SectionPanel>
      ) : (
        <div className='grid gap-4 lg:grid-cols-2'>
          {banks.map((bank) => {
            const goalDone = Boolean(bank.completedAt) || bank.progress >= 1;

            return (
              <SectionPanel key={bank.id}>
                <div className='flex flex-col gap-4'>
                  <div className='flex items-start justify-between gap-3'>
                    <div className='min-w-0'>
                      <div className='flex flex-wrap items-center gap-2'>
                        <h3 className='truncate text-base font-medium'>
                          {bank.name}
                        </h3>
                        {bank.isEmergency ? (
                          <Badge
                            variant='outline'
                            className='border-rose-500/40 text-rose-300'
                          >
                            <ShieldAlert data-icon='inline-start' />
                            Emergência
                          </Badge>
                        ) : null}
                        {bank.autoDebit ? (
                          <Badge variant='outline'>Auto-débito</Badge>
                        ) : null}
                        {goalDone ? (
                          <Badge className='bg-neon-green/20 text-neon-green'>
                            Meta atingida
                          </Badge>
                        ) : null}
                      </div>
                      <p className='mt-1 text-sm text-muted-foreground'>
                        Meta {formatCurrency(bank.goalAmount)} · até{' '}
                        {bank.targetDate.split('-').reverse().join('/')}
                      </p>
                    </div>
                    <Button
                      variant='ghost'
                      size='icon-sm'
                      onClick={() => setConfirmDelete(bank)}
                    >
                      <Trash2 />
                    </Button>
                  </div>

                  <div>
                    <div className='mb-1 flex justify-between text-sm'>
                      <span className='text-muted-foreground'>Progresso</span>
                      <span className='font-medium tabular-nums'>
                        {formatCurrency(bank.balance)} ·{' '}
                        {formatPercent(bank.progress)}
                      </span>
                    </div>
                    <div className='h-2 overflow-hidden rounded-full bg-white/5'>
                      <div
                        className='h-full rounded-full bg-violet-400 transition-all'
                        style={{
                          width: `${Math.min(bank.progress * 100, 100)}%`,
                        }}
                      />
                    </div>
                    <p className='mt-2 text-xs text-muted-foreground'>
                      Meta mensal {formatCurrency(bank.monthlyGoal)}
                      {bank.remaining > 0
                        ? ` · faltam ${formatCurrency(bank.remaining)}`
                        : ''}
                    </p>
                  </div>

                  <div className='flex flex-wrap gap-2'>
                    <Button
                      size='sm'
                      className='rounded-lg'
                      disabled={goalDone}
                      onClick={() => openMoney(bank, 'deposit')}
                    >
                      Guardar…
                    </Button>
                    <Button
                      size='sm'
                      variant='secondary'
                      className='rounded-lg'
                      disabled={bank.balance <= 0}
                      onClick={() => openMoney(bank, 'withdraw')}
                    >
                      Sacar
                    </Button>
                    <Button
                      size='sm'
                      variant='ghost'
                      className='rounded-lg'
                      onClick={() => openEdit(bank)}
                    >
                      Editar
                    </Button>
                    <Button
                      size='sm'
                      variant='ghost'
                      className='rounded-lg'
                      onClick={() =>
                        setHistoryBankId((current) =>
                          current === bank.id ? null : bank.id,
                        )
                      }
                    >
                      {historyBankId === bank.id ? 'Ocultar histórico' : 'Histórico'}
                    </Button>
                    {goalDone ? (
                      <Button
                        size='sm'
                        variant='outline'
                        className='rounded-lg'
                        disabled={archiveBank.isPending}
                        onClick={() => void handleArchive(bank)}
                      >
                        <Archive data-icon='inline-start' />
                        Arquivar
                      </Button>
                    ) : null}
                  </div>

                  {historyBankId === bank.id ? (
                    <div className='rounded-xl border border-border bg-black/20 p-3'>
                      <p className='mb-2 text-sm font-medium'>Histórico</p>
                      {historyLoading ? (
                        <Spinner className='size-4' />
                      ) : history.length === 0 ? (
                        <p className='text-sm text-muted-foreground'>
                          Sem movimentações ainda.
                        </p>
                      ) : (
                        <ul className='flex flex-col gap-2'>
                          {history.map((tx) => (
                            <li
                              key={tx.id}
                              className='flex items-center justify-between gap-3 text-sm'
                            >
                              <div>
                                <p className='font-medium'>
                                  {tx.type === 'deposit' ? 'Depósito' : 'Saque'}
                                  {tx.source === 'auto_debit'
                                    ? ' · auto'
                                    : ''}
                                </p>
                                <p className='text-xs text-muted-foreground'>
                                  {tx.date.split('-').reverse().join('/')}
                                </p>
                              </div>
                              <span
                                className={
                                  tx.type === 'deposit'
                                    ? 'tabular-nums text-violet-300'
                                    : 'tabular-nums text-neon-green'
                                }
                              >
                                {tx.type === 'deposit' ? '+' : '−'}
                                {formatCurrency(tx.amount)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ) : null}
                </div>
              </SectionPanel>
            );
          })}
        </div>
      )}

      <PiggyFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        bank={editing}
      />

      <PiggyMoneyDialog
        open={moneyOpen}
        onOpenChange={setMoneyOpen}
        bank={activeBank}
        mode={moneyMode}
      />

      <AlertDialog
        open={confirmDelete != null}
        onOpenChange={(open) => {
          if (!open) setConfirmDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir cofre?</AlertDialogTitle>
            <AlertDialogDescription>
              {(confirmDelete?.balance ?? 0) > 0
                ? `Este cofre possui saldo de ${formatCurrency(confirmDelete?.balance ?? 0)}. Deseja excluir mesmo assim? As despesas/entradas já lançadas no histórico financeiro permanecem.`
                : `O cofre "${confirmDelete?.name}" será removido.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              variant='destructive'
              onClick={() => {
                if (!confirmDelete) return;
                void handleDelete(confirmDelete);
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
