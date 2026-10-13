import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { AutoDebitField } from '@/components/piggy/auto-debit-field';
import { YieldField } from '@/components/piggy/yield-field';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { CurrencyInput } from '@/components/ui/currency-input';
import { DatePicker } from '@/components/ui/date-picker';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { useFinancialNow } from '@/hooks/use-financial-now';
import {
  useCreatePiggyBank,
  useUpdatePiggyBank,
} from '@/hooks/use-piggy-banks';
import { getApiErrorMessage } from '@/lib/api-error';
import { formatCurrency, parseCurrencyInput } from '@/lib/format';
import {
  buildPiggyPayload,
  formFromBank,
  type PiggyFormState,
} from '@/lib/piggy-form';
import { computeMonthlyGoal, monthsUntilTarget } from '@/lib/piggy-math';
import type { PiggyBank } from '@/types/finance';

type PiggyFormDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bank: PiggyBank | null;
};

export function PiggyFormDialog({
  open,
  onOpenChange,
  bank,
}: PiggyFormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[min(90dvh,760px)] overflow-y-auto rounded-xl sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>{bank ? 'Editar cofre' : 'Novo cofre'}</DialogTitle>
          <DialogDescription>
            Meta e data são opcionais. O rendimento também é opcional e usa o
            CDI bruto diário informado pelo Banco Central.
          </DialogDescription>
        </DialogHeader>
        {/* Content unmounts when closed, so every open starts from the bank. */}
        <PiggyForm
          key={bank?.id ?? 'new'}
          bank={bank}
          onClose={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function PiggyForm({
  bank,
  onClose,
}: {
  bank: PiggyBank | null;
  onClose: () => void;
}) {
  const now = useFinancialNow();
  const createBank = useCreatePiggyBank();
  const updateBank = useUpdatePiggyBank();
  const [form, setForm] = useState<PiggyFormState>(() => formFromBank(bank));
  const submitting = createBank.isPending || updateBank.isPending;

  function patch(changes: Partial<PiggyFormState>) {
    setForm((current) => ({ ...current, ...changes }));
  }

  const previewMonthly = useMemo(() => {
    const goal = form.goalAmount ? parseCurrencyInput(form.goalAmount) : 0;
    if (!goal || !form.targetDate) return 0;
    return computeMonthlyGoal(goal, form.targetDate);
  }, [form.goalAmount, form.targetDate]);

  const previewMonths = form.targetDate
    ? monthsUntilTarget(form.targetDate, now)
    : 0;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const result = buildPiggyPayload(form, previewMonthly);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }

    try {
      if (bank) {
        await updateBank.mutateAsync({ id: bank.id, payload: result.payload });
        toast.success('Cofre atualizado');
      } else {
        await createBank.mutateAsync(result.payload);
        toast.success('Cofre criado');
      }
      onClose();
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Não foi possível salvar o cofre'));
    }
  }

  return (
    <form
      onSubmit={(event) => void handleSubmit(event)}
      className='flex flex-col gap-4'
    >
      <div className='flex flex-col gap-2'>
        <Label htmlFor='piggy-name'>Nome</Label>
        <Input
          id='piggy-name'
          value={form.name}
          onChange={(event) => patch({ name: event.target.value })}
          placeholder='Ex: Reserva'
          maxLength={50}
          className='rounded-lg'
        />
      </div>

      <div className='flex flex-col gap-2'>
        <Label htmlFor='piggy-goal'>Meta final (opcional)</Label>
        <CurrencyInput
          id='piggy-goal'
          value={form.goalAmount}
          onValueChange={(goalAmount) => patch({ goalAmount })}
          className='rounded-lg'
        />
      </div>

      <div className='flex flex-col gap-2'>
        <Label htmlFor='piggy-date'>Data de conclusão (opcional)</Label>
        <DatePicker
          id='piggy-date'
          value={form.targetDate}
          onValueChange={(targetDate) => patch({ targetDate })}
          placeholder='Sem data obrigatória'
        />
      </div>

      {previewMonthly > 0 ? (
        <p className='rounded-lg border border-border bg-black/20 px-3 py-2 text-sm text-muted-foreground'>
          Meta mensal sugerida:{' '}
          <span className='font-medium text-foreground'>
            {formatCurrency(previewMonthly)}
          </span>{' '}
          · {previewMonths} mês{previewMonths === 1 ? '' : 'es'}
        </p>
      ) : null}

      <YieldField
        enabled={form.yieldEnabled}
        cdiPercent={form.cdiPercent}
        onEnabledChange={(yieldEnabled) => patch({ yieldEnabled })}
        onCdiPercentChange={(cdiPercent) => patch({ cdiPercent })}
      />

      <AutoDebitField
        enabled={form.autoDebit}
        day={form.autoDebitDay}
        amount={form.monthlyDebitAmount}
        askAmount={previewMonthly <= 0}
        onEnabledChange={(autoDebit) => patch({ autoDebit })}
        onDayChange={(autoDebitDay) => patch({ autoDebitDay })}
        onAmountChange={(monthlyDebitAmount) => patch({ monthlyDebitAmount })}
      />

      <label
        htmlFor='piggy-emergency'
        className='flex cursor-pointer items-center gap-2 text-sm'
      >
        <Checkbox
          id='piggy-emergency'
          checked={form.isEmergency}
          onCheckedChange={(checked) => patch({ isEmergency: checked === true })}
        />
        Reserva de emergência
      </label>

      <DialogFooter>
        <Button type='button' variant='ghost' onClick={onClose}>
          Cancelar
        </Button>
        <Button type='submit' disabled={submitting}>
          {submitting ? <Spinner data-icon='inline-start' /> : null}
          Salvar
        </Button>
      </DialogFooter>
    </form>
  );
}
