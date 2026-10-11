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
import {
  isExpenseAutoDebitedThisMonth,
  isExpenseInvoicePaidThisMonth,
} from '@/lib/expense-schedule';
import { formatDayKeyBr } from '@/lib/schedule-labels';
import type { RecurringExpense } from '@/types/finance';

type PayDialogProps = {
  expense: RecurringExpense | null;
  now: Date;
  onCancel: () => void;
  onConfirm: () => void;
};

type PayVariant = 'invoice' | 'in_balance' | 'early' | 'already_paid';

function payVariant(expense: RecurringExpense | null, now: Date): PayVariant {
  if (expense?.isInvoice) {
    return isExpenseInvoicePaidThisMonth(expense, now)
      ? 'already_paid'
      : 'invoice';
  }
  if (expense?.frequency === 'mensal') {
    return isExpenseAutoDebitedThisMonth(expense, now)
      ? 'in_balance'
      : 'early';
  }
  return 'already_paid';
}

const PAY_COPY: Record<PayVariant, { title: string; action: string }> = {
  invoice: {
    title: 'Confirmar pagamento da fatura?',
    action: 'Confirmar pagamento',
  },
  in_balance: { title: 'Confirmar pagamento?', action: 'Confirmar pagamento' },
  early: { title: 'Pagar antecipadamente?', action: 'Pagar agora' },
  already_paid: { title: 'Pagamento já registrado', action: 'Entendi' },
};

function PayDescription({
  variant,
  expense,
}: {
  variant: PayVariant;
  expense: RecurringExpense | null;
}) {
  if (variant === 'invoice') {
    return (
      <>
        Isso registra o pagamento da fatura fechada em{' '}
        {formatDayKeyBr(expense?.billingPeriodEnd) ?? 'data indisponível'}. O
        valor sairá do caixa na data da confirmação.
      </>
    );
  }
  if (variant === 'in_balance') {
    return (
      <>
        Isso registra que o ciclo deste mês de &quot;{expense?.name}&quot; foi
        pago. O saldo já considerava o desconto na data prevista; essa
        confirmação atualiza o histórico de pagamentos.
      </>
    );
  }
  if (variant === 'early') {
    return (
      <>
        Isso marca o ciclo deste mês de &quot;{expense?.name}&quot; como pago
        agora. A recorrência continua normalmente nos próximos meses e o valor
        entra no saldo imediatamente.
      </>
    );
  }
  return (
    <>
      Despesas avulsas já representam valores pagos no histórico. Use o botão
      de excluir somente para remover um lançamento.
    </>
  );
}

export function ExpensePayDialog({
  expense,
  now,
  onCancel,
  onConfirm,
}: PayDialogProps) {
  const variant = payVariant(expense, now);
  const copy = PAY_COPY[variant];

  return (
    <AlertDialog
      open={expense != null}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{copy.title}</AlertDialogTitle>
          <AlertDialogDescription>
            <PayDescription variant={variant} expense={expense} />
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>{copy.action}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function ExpenseDeleteDialog({
  expense,
  onCancel,
  onConfirm,
}: {
  expense: RecurringExpense | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog
      open={expense != null}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Excluir despesa?</AlertDialogTitle>
          <AlertDialogDescription>
            A despesa &quot;{expense?.name}&quot; será removida permanentemente.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction variant='destructive' onClick={onConfirm}>
            Excluir
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
