import { useState } from 'react';
import { toast } from 'sonner';

import { SectionPanel } from '@/components/layout/section-panel';
import { ConfirmDeleteDialog } from '@/components/shared/confirm-delete-dialog';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import {
  useAssetTransactions,
  useDeleteAssetTransaction,
} from '@/hooks/use-patrimony';
import { getApiErrorMessage } from '@/lib/api-error';
import { formatAssetQuantity } from '@/lib/btc-quantity';
import { formatCurrency } from '@/lib/format';
import type {
  Asset,
  AssetTransaction,
  AssetTransactionType,
} from '@/types/patrimony';

const TYPE_LABELS: Record<AssetTransactionType, string> = {
  BUY: 'Compra',
  SELL: 'Venda',
  MANUAL_ADJUSTMENT: 'Ajuste manual',
};

type TransactionsListProps = {
  asset: Asset;
  /** Disables row actions while the form is saving. */
  busy: boolean;
  onEdit: (transaction: AssetTransaction) => void;
  onDeleted: (id: string) => void;
};

export function TransactionsList({
  asset,
  busy,
  onEdit,
  onDeleted,
}: TransactionsListProps) {
  const query = useAssetTransactions(asset);
  const deleteTransaction = useDeleteAssetTransaction();
  const [pendingDelete, setPendingDelete] = useState<AssetTransaction | null>(
    null,
  );
  const transactions = query.data ?? [];

  async function confirmDelete() {
    if (!pendingDelete) return;
    try {
      await deleteTransaction.mutateAsync(pendingDelete.id);
      onDeleted(pendingDelete.id);
      toast.success('Movimentação removida');
      setPendingDelete(null);
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Não foi possível excluir'));
    }
  }

  return (
    <SectionPanel
      title={`Movimentações ${asset}`}
      description='Compras e vendas ficam vinculadas ao financeiro; ajustes manuais não criam caixa.'
    >
      {query.isLoading ? (
        <Spinner className='size-4' />
      ) : query.isError ? (
        <div role='alert' className='flex flex-wrap items-center gap-3 text-sm text-destructive'>
          <span>Não foi possível carregar as movimentações.</span>
          <Button size='sm' variant='outline' onClick={() => void query.refetch()}>
            Tentar novamente
          </Button>
        </div>
      ) : transactions.length === 0 ? (
        <p className='text-sm text-muted-foreground'>Nenhuma movimentação.</p>
      ) : (
        <div className='space-y-2'>
          {transactions.map((transaction) => (
            <div
              key={transaction.id}
              className='flex flex-col gap-3 rounded-xl border border-border p-3 sm:flex-row sm:items-center sm:justify-between'
            >
              <div>
                <p className='font-medium'>
                  {TYPE_LABELS[transaction.type]} ·{' '}
                  {formatAssetQuantity(asset, transaction.quantity)}
                </p>
                <p className='text-xs text-muted-foreground'>
                  {transaction.date.slice(0, 10).split('-').reverse().join('/')} ·{' '}
                  {formatCurrency(Number(transaction.cashAmountBrl))}
                  {Number(transaction.feeAmountBrl) !== 0
                    ? ` · taxa ${formatCurrency(Number(transaction.feeAmountBrl))}`
                    : ''}
                </p>
              </div>
              <div className='flex flex-wrap gap-2'>
                <Button
                  size='sm'
                  variant='outline'
                  disabled={busy || deleteTransaction.isPending}
                  onClick={() => onEdit(transaction)}
                >
                  Editar
                </Button>
                <Button
                  size='sm'
                  variant='ghost'
                  disabled={busy || deleteTransaction.isPending}
                  onClick={() => setPendingDelete(transaction)}
                >
                  Excluir
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmDeleteDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title='Excluir movimentação?'
        description={
          pendingDelete
            ? `${TYPE_LABELS[pendingDelete.type]} de ${formatAssetQuantity(asset, pendingDelete.quantity)} em ${pendingDelete.date.slice(0, 10).split('-').reverse().join('/')}. Esta ação não pode ser desfeita e pode alterar sua posição e o financeiro vinculado.`
            : ''
        }
        pending={deleteTransaction.isPending}
        onConfirm={confirmDelete}
      />
    </SectionPanel>
  );
}
