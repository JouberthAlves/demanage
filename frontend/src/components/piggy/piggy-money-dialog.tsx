import { isAxiosError } from 'axios';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { CurrencyInput } from '@/components/ui/currency-input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import {
  useDepositPiggyBank,
  useWithdrawPiggyBank,
} from '@/hooks/use-piggy-banks';
import { celebrateGoal } from '@/lib/confetti';
import { formatCurrency, parseCurrencyInput } from '@/lib/format';
import type { PiggyBank } from '@/types/finance';

type PiggyMoneyDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bank: PiggyBank | null;
  mode: 'deposit' | 'withdraw';
};

export function PiggyMoneyDialog({
  open,
  onOpenChange,
  bank,
  mode,
}: PiggyMoneyDialogProps) {
  const deposit = useDepositPiggyBank();
  const withdraw = useWithdrawPiggyBank();
  const [amount, setAmount] = useState('');
  const submitting = deposit.isPending || withdraw.isPending;

  useEffect(() => {
    if (open) setAmount('');
  }, [open, mode, bank?.id]);

  const monthlyHint = useMemo(() => {
    if (!bank || mode !== 'deposit' || bank.remaining <= 0) return null;
    return {
      monthly: bank.monthlyGoal,
      remaining: bank.remaining,
    };
  }, [bank, mode]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!bank) return;

    const value = parseCurrencyInput(amount);
    if (!value || value <= 0) {
      toast.error('Informe um valor válido');
      return;
    }

    try {
      if (mode === 'deposit') {
        const result = await deposit.mutateAsync({ id: bank.id, amount: value });
        toast.success(
          `Guardado ${formatCurrency(result.depositAmount)} em ${bank.name}`,
        );
        if (result.completed) {
          celebrateGoal();
          toast.success(`Meta de "${bank.name}" atingida!`);
        }
      } else {
        await withdraw.mutateAsync({ id: bank.id, amount: value });
        toast.success(
          `Resgatado ${formatCurrency(value)} — valor voltou ao saldo`,
        );
      }
      onOpenChange(false);
    } catch (err) {
      const message = isAxiosError(err)
        ? (err.response?.data?.error ?? 'Operação não concluída')
        : 'Operação não concluída';
      toast.error(message);
    }
  }

  const isDeposit = mode === 'deposit';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='rounded-xl sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>
            {isDeposit ? 'Guardar no cofre' : 'Sacar do cofre'}
          </DialogTitle>
          <DialogDescription>
            {isDeposit
              ? `Isso cria uma despesa "Cofrinho" e reduz o saldo do mês. Restam ${formatCurrency(bank?.remaining ?? 0)} para a meta.`
              : bank?.isEmergency
                ? 'Atenção: este é um cofre de emergência. O valor volta ao saldo do mês.'
                : 'O valor volta ao saldo do mês como entrada de resgate.'}
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(event) => void handleSubmit(event)}
          className='flex flex-col gap-4'
        >
          {isDeposit && monthlyHint ? (
            <div className='rounded-lg border border-violet-500/30 bg-violet-500/10 px-3 py-2 text-sm text-violet-100'>
              <p className='font-medium'>
                Meta por mês para bater o objetivo:{' '}
                {formatCurrency(monthlyHint.monthly)}
              </p>
              <p className='mt-1 text-xs text-violet-200/80'>
                Ainda faltam {formatCurrency(monthlyHint.remaining)}. Você
                escolhe o valor — só guarda ao confirmar abaixo.
              </p>
            </div>
          ) : null}

          <div className='flex flex-col gap-2'>
            <Label htmlFor='piggy-amount'>Valor</Label>
            <CurrencyInput
              id='piggy-amount'
              value={amount}
              onValueChange={setAmount}
              className='rounded-lg'
            />
          </div>

          {!isDeposit && bank ? (
            <p className='text-sm text-muted-foreground'>
              Disponível no cofre: {formatCurrency(bank.balance)}
            </p>
          ) : null}

          <DialogFooter>
            <Button
              type='button'
              variant='ghost'
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button
              type='submit'
              variant={isDeposit ? 'default' : 'destructive'}
              disabled={submitting}
            >
              {submitting ? <Spinner data-icon='inline-start' /> : null}
              {isDeposit ? 'Confirmar depósito' : 'Sacar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
