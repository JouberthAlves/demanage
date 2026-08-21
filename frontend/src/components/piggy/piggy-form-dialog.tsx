import { isAxiosError } from 'axios';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import {
  useCreatePiggyBank,
  useUpdatePiggyBank,
} from '@/hooks/use-piggy-banks';
import {
  formatBrlInputValue,
  formatCurrency,
  parseCurrencyInput,
} from '@/lib/format';
import {
  computeMonthlyGoal,
  monthsUntilTarget,
  piggyHasGoal,
} from '@/lib/piggy-math';
import type { PiggyBank } from '@/types/finance';

type PiggyFormDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bank: PiggyBank | null;
};

type FormState = {
  name: string;
  goalAmount: string;
  skipGoal: boolean;
  targetDate: string;
  autoDebit: boolean;
  autoDebitDay: string;
  monthlyDebitAmount: string;
  isEmergency: boolean;
};

const emptyForm: FormState = {
  name: '',
  goalAmount: '',
  skipGoal: false,
  targetDate: '',
  autoDebit: false,
  autoDebitDay: '1',
  monthlyDebitAmount: '',
  isEmergency: false,
};

const AUTO_DEBIT_DAYS = Array.from({ length: 31 }, (_, index) =>
  String(index + 1),
);

export function PiggyFormDialog({
  open,
  onOpenChange,
  bank,
}: PiggyFormDialogProps) {
  const createBank = useCreatePiggyBank();
  const updateBank = useUpdatePiggyBank();
  const [form, setForm] = useState<FormState>(emptyForm);
  const submitting = createBank.isPending || updateBank.isPending;

  useEffect(() => {
    if (!open) return;
    if (bank) {
      setForm({
        name: bank.name,
        goalAmount: piggyHasGoal(bank.goalAmount)
          ? formatBrlInputValue(bank.goalAmount)
          : '',
        skipGoal: !piggyHasGoal(bank.goalAmount),
        targetDate: bank.targetDate ?? '',
        autoDebit: bank.autoDebit,
        autoDebitDay: String(bank.autoDebitDay || 1),
        monthlyDebitAmount:
          bank.monthlyGoal > 0 ? formatBrlInputValue(bank.monthlyGoal) : '',
        isEmergency: bank.isEmergency,
      });
      return;
    }
    setForm(emptyForm);
  }, [bank, open]);

  const previewMonthly = useMemo(() => {
    if (form.skipGoal) return 0;
    const goal = form.goalAmount ? parseCurrencyInput(form.goalAmount) : 0;
    if (!goal || !form.targetDate) return 0;
    return computeMonthlyGoal(goal, form.targetDate);
  }, [form.goalAmount, form.skipGoal, form.targetDate]);

  const previewMonths = form.targetDate
    ? monthsUntilTarget(form.targetDate)
    : 0;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!form.name.trim()) {
      toast.error('Informe o nome do cofre');
      return;
    }
    const goalAmount = form.skipGoal
      ? null
      : parseCurrencyInput(form.goalAmount);
    if (!form.skipGoal && (!goalAmount || goalAmount <= 0)) {
      toast.error(
        'Informe a meta final ou marque que não deseja informar meta',
      );
      return;
    }

    const targetDate = form.skipGoal ? null : form.targetDate || null;

    const autoDebitDay = Number(form.autoDebitDay);
    if (
      form.autoDebit &&
      (!Number.isInteger(autoDebitDay) || autoDebitDay < 1 || autoDebitDay > 31)
    ) {
      toast.error('Informe o dia do débito automático (1 a 31)');
      return;
    }

    let monthlyGoal = previewMonthly;
    if (form.autoDebit && monthlyGoal <= 0) {
      monthlyGoal = parseCurrencyInput(form.monthlyDebitAmount);
      if (!monthlyGoal || monthlyGoal <= 0) {
        toast.error('Informe o valor do débito automático');
        return;
      }
    }

    const payload = {
      name: form.name.trim().slice(0, 50),
      goalAmount,
      targetDate,
      monthlyGoal: form.autoDebit ? monthlyGoal : 0,
      autoDebit: form.autoDebit,
      autoDebitDay: form.autoDebit ? autoDebitDay : 1,
      isEmergency: form.isEmergency,
    };

    try {
      if (bank) {
        await updateBank.mutateAsync({ id: bank.id, payload });
        toast.success('Cofre atualizado');
      } else {
        await createBank.mutateAsync(payload);
        toast.success('Cofre criado');
      }
      onOpenChange(false);
    } catch (err) {
      const message = isAxiosError(err)
        ? (err.response?.data?.error ?? 'Não foi possível salvar o cofre')
        : 'Não foi possível salvar o cofre';
      toast.error(message);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[min(90dvh,720px)] overflow-y-auto rounded-xl sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>{bank ? 'Editar cofre' : 'Novo cofre'}</DialogTitle>
          <DialogDescription>
            A meta e a data são opcionais. Sem meta, o cofre só acumula saldo —
            sem barra de progresso.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(event) => void handleSubmit(event)}
          className='flex flex-col gap-4'
        >
          <div className='flex flex-col gap-2'>
            <Label htmlFor='piggy-name'>Nome</Label>
            <Input
              id='piggy-name'
              value={form.name}
              onChange={(event) =>
                setForm((current) => ({ ...current, name: event.target.value }))
              }
              placeholder='Ex: Viagem'
              maxLength={50}
              className='rounded-lg'
            />
            <p className='text-xs text-muted-foreground'>
              {form.name.length}/50
            </p>
          </div>

          <div className='flex flex-col gap-2'>
            <Label htmlFor='piggy-goal'>Meta final</Label>
            <CurrencyInput
              id='piggy-goal'
              value={form.goalAmount}
              onValueChange={(goalAmount) =>
                setForm((current) => ({ ...current, goalAmount }))
              }
              disabled={form.skipGoal}
              className='rounded-lg'
            />
            <label
              htmlFor='piggy-skip-goal'
              className='flex cursor-pointer items-start gap-2 text-sm'
            >
              <Checkbox
                id='piggy-skip-goal'
                checked={form.skipGoal}
                onCheckedChange={(checked) =>
                  setForm((current) => ({
                    ...current,
                    skipGoal: checked === true,
                    goalAmount: checked === true ? '' : current.goalAmount,
                    targetDate: checked === true ? '' : current.targetDate,
                  }))
                }
                className='mt-0.5'
              />
              <span className='text-muted-foreground text-xs'>Deseja não informar meta?</span>
            </label>
          </div>

          {form.skipGoal ? null : (
            <div className='flex flex-col gap-2'>
              <Label htmlFor='piggy-date'>Data de conclusão (opcional)</Label>
              <DatePicker
                id='piggy-date'
                value={form.targetDate}
                onValueChange={(targetDate) =>
                  setForm((current) => ({ ...current, targetDate }))
                }
                placeholder='Quando quer atingir a meta'
              />
            </div>
          )}

          {previewMonthly > 0 ? (
            <p className='rounded-lg border border-border bg-black/20 px-3 py-2 text-sm text-muted-foreground'>
              Meta mensal sugerida:{' '}
              <span className='font-medium text-foreground'>
                {formatCurrency(previewMonthly)}
              </span>{' '}
              · {previewMonths} mês{previewMonths === 1 ? '' : 'es'}
            </p>
          ) : null}

          <div className='flex flex-col gap-3'>
            <label
              htmlFor='piggy-auto-debit'
              className='flex cursor-pointer items-start gap-2 text-sm'
            >
              <Checkbox
                id='piggy-auto-debit'
                checked={form.autoDebit}
                onCheckedChange={(checked) =>
                  setForm((current) => ({
                    ...current,
                    autoDebit: checked === true,
                  }))
                }
                className='mt-0.5'
              />
              <span className='flex flex-col gap-1'>
                <span>Débito automático mensal</span>
                <span className='text-xs text-muted-foreground'>
                  Não debita ao criar o cofre — só a partir do próximo ciclo do
                  dia escolhido. Até lá, use Guardar quando quiser.
                </span>
              </span>
            </label>

            {form.autoDebit ? (
              <div className='flex flex-col gap-3 pl-6'>
                {previewMonthly <= 0 ? (
                  <div className='flex flex-col gap-2'>
                    <Label htmlFor='piggy-monthly-debit'>
                      Valor do débito mensal
                    </Label>
                    <CurrencyInput
                      id='piggy-monthly-debit'
                      value={form.monthlyDebitAmount}
                      onValueChange={(monthlyDebitAmount) =>
                        setForm((current) => ({
                          ...current,
                          monthlyDebitAmount,
                        }))
                      }
                      className='rounded-lg'
                    />
                  </div>
                ) : null}
                <div className='flex flex-col gap-2'>
                  <Label>Dia do débito</Label>
                  <Select
                    value={form.autoDebitDay}
                    onValueChange={(value) => {
                      if (!value) return;
                      setForm((current) => ({
                        ...current,
                        autoDebitDay: value,
                      }));
                    }}
                  >
                    <SelectTrigger className='rounded-lg'>
                      <SelectValue placeholder='Dia' />
                    </SelectTrigger>
                    <SelectContent>
                      {AUTO_DEBIT_DAYS.map((day) => (
                        <SelectItem key={day} value={day}>
                          Dia {day.padStart(2, '0')}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className='text-xs text-muted-foreground'>
                    Em meses curtos, usa o último dia disponível.
                  </p>
                </div>
              </div>
            ) : null}
          </div>

          <label
            htmlFor='piggy-emergency'
            className='flex cursor-pointer items-center gap-2 text-sm'
          >
            <Checkbox
              id='piggy-emergency'
              checked={form.isEmergency}
              onCheckedChange={(checked) =>
                setForm((current) => ({
                  ...current,
                  isEmergency: checked === true,
                }))
              }
            />
            Reserva de emergência
          </label>

          <DialogFooter>
            <Button
              type='button'
              variant='ghost'
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button type='submit' disabled={submitting}>
              {submitting ? <Spinner data-icon='inline-start' /> : null}
              Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
