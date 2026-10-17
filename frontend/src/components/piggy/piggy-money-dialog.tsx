import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
import { getApiErrorMessage } from '@/lib/api-error';
import { celebrateGoal } from '@/lib/confetti';
import { formatCurrency, parseCurrencyInput } from '@/lib/format';
import type { depositPiggyBank } from '@/lib/piggy-api';
import type { PiggyCorrectionOrigin } from '@/lib/piggy-api';
import { piggyHasGoal } from '@/lib/piggy-math';
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
  const isDeposit = mode === 'deposit';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[min(90dvh,720px)] overflow-y-auto rounded-xl sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>
            {isDeposit ? 'Guardar no cofre' : 'Sacar do cofre'}
          </DialogTitle>
          <DialogDescription>
            {isDeposit
              ? piggyHasGoal(bank?.goalAmount)
                ? `Restam ${formatCurrency(bank?.remaining ?? 0)} para a meta. O valor será descontado do saldo do mês, a menos que você escolha não descontar.`
                : 'O valor será descontado do saldo do mês, a menos que você escolha não descontar.'
              : bank?.isEmergency
                ? 'Atenção: cofre de emergência. Saques voltam ao saldo; correções removem sem creditar.'
                : 'Sacar devolve o valor ao saldo. Excluir saldo incorreto remove apenas do cofrinho.'}
          </DialogDescription>
        </DialogHeader>
        {/* Content unmounts when closed; the key resets state per bank/mode. */}
        <PiggyMoneyForm
          key={`${bank?.id ?? 'none'}:${mode}`}
          bank={bank}
          mode={mode}
          onClose={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function PiggyMoneyForm({
  bank,
  mode,
  onClose,
}: {
  bank: PiggyBank | null;
  mode: 'deposit' | 'withdraw';
  onClose: () => void;
}) {
  const deposit = useDepositPiggyBank();
  const withdraw = useWithdrawPiggyBank();
  const [amount, setAmount] = useState('');
  const [skipBalanceDeduction, setSkipBalanceDeduction] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [correctionOrigin, setCorrectionOrigin] = useState<PiggyCorrectionOrigin | null>(null);
  const submitting = deposit.isPending || withdraw.isPending;

  const monthlyHint = useMemo(() => {
    if (!bank || mode !== 'deposit' || !piggyHasGoal(bank.goalAmount)) {
      return null;
    }
    if (bank.remaining <= 0) return null;
    return {
      monthly: bank.monthlyGoal,
      remaining: bank.remaining,
    };
  }, [bank, mode]);

  async function submitAmount(creditToBalance: boolean) {
    if (!bank) return;
    if (!creditToBalance && !correctionOrigin) {
      toast.error('Informe se o depósito original descontou do seu saldo');
      return;
    }

    const value = parseCurrencyInput(amount);
    if (!value || value <= 0) {
      toast.error('Informe um valor válido');
      return;
    }

    try {
      if (mode === 'deposit') {
        // The shared mutation hook types its result as unknown.
        const result = (await deposit.mutateAsync({
          id: bank.id,
          amount: value,
          deductFromBalance: !skipBalanceDeduction,
        })) as Awaited<ReturnType<typeof depositPiggyBank>>;
        toast.success(
          `Guardado ${formatCurrency(result.depositAmount)} em ${bank.name}${skipBalanceDeduction ? ' sem descontar do saldo' : ''}`,
        );
        if (result.completed) {
          celebrateGoal();
          toast.success(`Meta de "${bank.name}" atingida!`);
        }
      } else {
        await withdraw.mutateAsync({
          id: bank.id,
          amount: value,
          creditToBalance,
          correctionOrigin: creditToBalance ? undefined : correctionOrigin ?? undefined,
        });
        toast.success(creditToBalance
          ? `Resgatado ${formatCurrency(value)} — valor voltou ao saldo`
          : correctionOrigin === 'debited'
            ? `Depósito incorreto desfeito: ${formatCurrency(value)} removidos e desconto anterior compensado`
            : `Removido ${formatCurrency(value)} do cofrinho sem movimentar o saldo`);
      }
      onClose();
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Operação não concluída'));
    }
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    void submitAmount(!confirmDiscard);
  }

  const isDeposit = mode === 'deposit';

  return (
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
            escolhe o valor que deseja guardar.
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

      {isDeposit ? (
        <div className='rounded-lg border border-border bg-black/20 p-3'>
          <div className='flex items-start gap-3'>
            <Checkbox
              id='piggy-skip-balance-deduction'
              checked={skipBalanceDeduction}
              onCheckedChange={(checked) =>
                setSkipBalanceDeduction(checked === true)
              }
              aria-describedby='piggy-skip-balance-deduction-description'
            />
            <div className='space-y-1'>
              <Label
                htmlFor='piggy-skip-balance-deduction'
                className='cursor-pointer leading-snug'
              >
                Não descontar este valor do meu saldo
              </Label>
              <p
                id='piggy-skip-balance-deduction-description'
                className='text-xs text-muted-foreground'
              >
                Marcando esta opção, o cofrinho recebe o valor sem criar uma
                despesa no mês atual. Saques normais devolvem ao saldo; para
                desfazer um depósito errado, use “Excluir saldo incorreto”.
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {!isDeposit && bank ? (
        <>
          <p className='text-sm text-muted-foreground'>
            Disponível no cofre: {formatCurrency(bank.balance)}
          </p>
          {confirmDiscard ? (
            <div role='alert' className='rounded-lg border border-neon-green/40 bg-neon-green/10 p-3 text-sm'>
              <p className='font-semibold text-neon-green'>Confirmar correção de saldo</p>
              <p className='mt-1 text-muted-foreground'>
                O valor será retirado do cofrinho. Para manter seu saldo correto,
                informe se o depósito original foi descontado. A correção ficará no histórico.
              </p>
              <fieldset className='mt-3 space-y-2'>
                <legend className='font-medium'>Como o dinheiro entrou no cofrinho?</legend>
                <label className='flex cursor-pointer items-start gap-2 rounded-lg border border-border px-3 py-2'>
                  <input
                    type='radio'
                    name='correction-origin'
                    value='not_debited'
                    checked={correctionOrigin === 'not_debited'}
                    onChange={() => setCorrectionOrigin('not_debited')}
                    className='mt-1 accent-green-500'
                  />
                  <span>
                    <span className='font-medium'>Sem descontar do saldo</span>
                    <span className='block text-xs text-muted-foreground'>
                      Apaga o valor incorreto do cofrinho sem aumentar nem reduzir seu saldo.
                    </span>
                  </span>
                </label>
                <label className='flex cursor-pointer items-start gap-2 rounded-lg border border-border px-3 py-2'>
                  <input
                    type='radio'
                    name='correction-origin'
                    value='debited'
                    checked={correctionOrigin === 'debited'}
                    onChange={() => setCorrectionOrigin('debited')}
                    className='mt-1 accent-green-500'
                  />
                  <span>
                    <span className='font-medium'>O depósito descontou do meu saldo</span>
                    <span className='block text-xs text-muted-foreground'>
                      Desfaz o desconto antigo junto com o depósito, sem criar dinheiro extra.
                    </span>
                  </span>
                </label>
              </fieldset>
              <p className='mt-2 text-xs text-muted-foreground'>
                Se o erro era só o número exibido no Dashboard, não exclua um depósito válido.
              </p>
              {bank.yieldEnabled && bank.cdiPercent > 0 ? (
                <p className='mt-2 text-muted-foreground'>
                  Cofrinhos com CDI exigem revisão dos juros antes de desfazer depósitos.
                </p>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}

      <DialogFooter>
        <Button
          type='button'
          variant='ghost'
          onClick={() => onClose()}
        >
          Cancelar
        </Button>
        <Button
          type='submit'
          variant={isDeposit ? 'default' : confirmDiscard ? 'default' : 'destructive'}
          className={!isDeposit && confirmDiscard ? 'bg-neon-green text-black hover:bg-neon-green/90' : undefined}
          disabled={submitting || (!isDeposit && confirmDiscard && correctionOrigin === null)}
        >
          {submitting ? <Spinner data-icon='inline-start' /> : null}
          {isDeposit ? 'Confirmar depósito' : confirmDiscard ? 'Confirmar exclusão' : 'Sacar'}
        </Button>
        {!isDeposit ? (
          <Button
            type='button'
            variant='outline'
            className={confirmDiscard ? undefined : 'border-neon-green/50 text-neon-green hover:bg-neon-green/10'}
            disabled={submitting}
            onClick={() => {
              setConfirmDiscard((current) => !current);
              setCorrectionOrigin(null);
            }}
          >
            {confirmDiscard ? 'Voltar ao saque' : 'Excluir saldo incorreto'}
          </Button>
        ) : null}
      </DialogFooter>
    </form>
  );
}
