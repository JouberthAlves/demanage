import { isAxiosError } from 'axios';
import { Archive, PiggyBank as PiggyIcon, Plus, ShieldAlert, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { PageHeader } from '@/components/layout/page-header';
import { PageHero } from '@/components/layout/page-hero';
import { SectionPanel } from '@/components/layout/section-panel';
import { PiggyFormDialog } from '@/components/piggy/piggy-form-dialog';
import { PiggyMoneyDialog } from '@/components/piggy/piggy-money-dialog';
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
import { piggyHasGoal } from '@/lib/piggy-math';
import type { PiggyBank, PiggyTransaction } from '@/types/finance';

function errorMessage(error: unknown, fallback: string) {
  return isAxiosError(error)
    ? (error.response?.data?.error ?? fallback)
    : fallback;
}

function transactionLabel(transaction: PiggyTransaction) {
  if (transaction.type === 'interest') return 'Rendimento CDI';
  if (transaction.type === 'deposit') {
    return transaction.source === 'auto_debit' ? 'Depósito automático' : 'Depósito';
  }
  return 'Saque';
}

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
    } catch (error) {
      toast.error(errorMessage(error, 'Não foi possível arquivar'));
    }
  }

  async function handleDelete(bank: PiggyBank) {
    const warning =
      bank.balance > 0
        ? `O cofre possui ${formatCurrency(bank.balance)}. Excluir mesmo assim?`
        : `Excluir o cofre "${bank.name}"?`;
    if (!window.confirm(warning)) return;
    try {
      await deleteBank.mutateAsync(bank.id);
      toast.success('Cofre removido');
      if (historyBankId === bank.id) setHistoryBankId(null);
    } catch (error) {
      toast.error(errorMessage(error, 'Não foi possível excluir'));
    }
  }

  return (
    <div className='flex flex-col gap-6'>
      <title>Cofrinho | deManage</title>
      <PageHeader
        title='Cofrinho'
        description='Reservas internas do patrimônio. Meta, data e rendimento são opcionais.'
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
        description='Guardar move dinheiro do saldo em reais para o Cofrinho sem reduzir o patrimônio. Se houver rendimento, o CDI é capitalizado diariamente.'
      >
        <div className='min-w-0 rounded-xl border border-border bg-black/25 p-4'>
          <p className='text-xs text-muted-foreground'>Total nos cofres</p>
          <p className='mt-2 text-2xl font-semibold tabular-nums text-violet-300'>
            {formatCurrency(totalBalance)}
          </p>
        </div>
      </PageHero>

      {isLoading ? (
        <div className='flex h-40 items-center justify-center'>
          <Spinner className='size-5' />
        </div>
      ) : isError ? (
        <p className='text-sm text-destructive'>Não foi possível carregar os cofres.</p>
      ) : banks.length === 0 ? (
        <SectionPanel>
          <div className='flex flex-col items-center gap-3 py-12 text-center'>
            <div className='flex size-12 items-center justify-center rounded-2xl bg-violet-500/15'>
              <PiggyIcon className='size-6 text-violet-300' />
            </div>
            <p className='font-medium'>Nenhum cofre ainda</p>
            <p className='text-sm text-muted-foreground'>
              Crie uma reserva com ou sem meta. Você decide se ela rende CDI.
            </p>
            <Button onClick={openCreate}>Criar cofre</Button>
          </div>
        </SectionPanel>
      ) : (
        <div className='grid gap-4 lg:grid-cols-2'>
          {banks.map((bank) => {
            const hasGoal = piggyHasGoal(bank.goalAmount);
            const goalDone =
              hasGoal && (Boolean(bank.completedAt) || bank.progress >= 1);
            return (
              <SectionPanel key={bank.id}>
                <div className='space-y-4'>
                  <div className='flex items-start justify-between gap-3'>
                    <div className='min-w-0'>
                      <h3 className='truncate text-base font-medium'>{bank.name}</h3>
                      <div className='mt-2 flex flex-wrap gap-2'>
                        {bank.isEmergency ? (
                          <Badge variant='outline' className='border-rose-500/40 text-rose-300'>
                            <ShieldAlert data-icon='inline-start' />
                            Emergência
                          </Badge>
                        ) : null}
                        {bank.yieldEnabled ? (
                          <Badge variant='outline'>{bank.cdiPercent}% do CDI</Badge>
                        ) : (
                          <Badge variant='outline'>Não rende</Badge>
                        )}
                        {bank.autoDebit ? (
                          <Badge variant='outline'>Auto · dia {String(bank.autoDebitDay).padStart(2, '0')}</Badge>
                        ) : null}
                      </div>
                    </div>
                    <Button variant='ghost' size='icon-sm' onClick={() => void handleDelete(bank)}>
                      <Trash2 />
                    </Button>
                  </div>

                  <div>
                    <p className='text-xs text-muted-foreground'>Saldo atual</p>
                    <p className='mt-1 text-xl font-semibold tabular-nums'>
                      {formatCurrency(bank.balance)}
                    </p>
                  </div>

                  {hasGoal ? (
                    <div>
                      <div className='mb-1 flex justify-between text-sm'>
                        <span className='text-muted-foreground'>Meta {formatCurrency(bank.goalAmount ?? 0)}</span>
                        <span>{formatPercent(bank.progress)}</span>
                      </div>
                      <div className='h-2 overflow-hidden rounded-full bg-white/5'>
                        <div
                          className='h-full rounded-full bg-violet-400'
                          style={{ width: `${Math.min(bank.progress * 100, 100)}%` }}
                        />
                      </div>
                      {bank.targetDate ? (
                        <p className='mt-2 text-xs text-muted-foreground'>
                          Data alvo: {bank.targetDate.split('-').reverse().join('/')}
                        </p>
                      ) : null}
                    </div>
                  ) : bank.targetDate ? (
                    <p className='text-xs text-muted-foreground'>
                      Data informativa: {bank.targetDate.split('-').reverse().join('/')}
                    </p>
                  ) : null}

                  <div className='flex flex-wrap gap-2'>
                    <Button size='sm' disabled={goalDone} onClick={() => openMoney(bank, 'deposit')}>
                      Guardar
                    </Button>
                    <Button size='sm' variant='secondary' disabled={bank.balance <= 0} onClick={() => openMoney(bank, 'withdraw')}>
                      Sacar
                    </Button>
                    <Button size='sm' variant='ghost' onClick={() => openEdit(bank)}>Editar</Button>
                    <Button
                      size='sm'
                      variant='ghost'
                      onClick={() => setHistoryBankId((current) => (current === bank.id ? null : bank.id))}
                    >
                      {historyBankId === bank.id ? 'Ocultar histórico' : 'Histórico'}
                    </Button>
                    {goalDone || !hasGoal ? (
                      <Button size='sm' variant='outline' disabled={archiveBank.isPending} onClick={() => void handleArchive(bank)}>
                        <Archive data-icon='inline-start' />
                        Arquivar
                      </Button>
                    ) : null}
                  </div>

                  {historyBankId === bank.id ? (
                    <div className='rounded-xl border border-border bg-black/20 p-3'>
                      <p className='mb-2 text-sm font-medium'>Histórico auditável</p>
                      {historyLoading ? (
                        <Spinner className='size-4' />
                      ) : history.length === 0 ? (
                        <p className='text-sm text-muted-foreground'>Sem movimentações.</p>
                      ) : (
                        <ul className='space-y-2'>
                          {history.map((transaction) => (
                            <li key={transaction.id} className='flex items-start justify-between gap-3 text-sm'>
                              <div>
                                <p className='font-medium'>{transactionLabel(transaction)}</p>
                                <p className='text-xs text-muted-foreground'>
                                  {transaction.date.split('-').reverse().join('/')}
                                  {transaction.type === 'interest' && transaction.cdiRate != null
                                    ? ` · CDI ${transaction.cdiRate}% · ${transaction.cdiPercent ?? bank.cdiPercent}% aplicado`
                                    : ''}
                                </p>
                                {transaction.type === 'interest' && transaction.baseBalance != null ? (
                                  <p className='text-xs text-muted-foreground'>
                                    Base {formatCurrency(transaction.baseBalance)} → {formatCurrency(transaction.resultingBalance ?? transaction.baseBalance)}
                                  </p>
                                ) : null}
                              </div>
                              <span className={transaction.type === 'withdraw' ? 'tabular-nums text-neon-green' : 'tabular-nums text-violet-300'}>
                                {transaction.type === 'withdraw' ? '−' : '+'}{formatCurrency(transaction.amount)}
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

      <PiggyFormDialog open={formOpen} onOpenChange={setFormOpen} bank={editing} />
      <PiggyMoneyDialog open={moneyOpen} onOpenChange={setMoneyOpen} bank={activeBank} mode={moneyMode} />
    </div>
  );
}
