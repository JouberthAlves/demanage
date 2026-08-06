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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { computeMonthlyGoal, monthsUntilTarget } from '@/lib/piggy-math';
import type { PiggyBank } from '@/types/finance';

type PiggyFormDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bank: PiggyBank | null;
};

type FormState = {
  name: string;
  goalAmount: string;
  targetDate: string;
  autoDebit: boolean;
  isEmergency: boolean;
};

const emptyForm: FormState = {
  name: '',
  goalAmount: '',
  targetDate: '',
  autoDebit: false,
  isEmergency: false,
};

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
        goalAmount: formatBrlInputValue(bank.goalAmount),
        targetDate: bank.targetDate,
        autoDebit: bank.autoDebit,
        isEmergency: bank.isEmergency,
      });
      return;
    }
    setForm(emptyForm);
  }, [bank, open]);

  const previewMonthly = useMemo(() => {
    const goal = form.goalAmount ? parseCurrencyInput(form.goalAmount) : 0;
    if (!goal || !form.targetDate) return 0;
    return computeMonthlyGoal(goal, form.targetDate);
  }, [form.goalAmount, form.targetDate]);

  const previewMonths = form.targetDate
    ? monthsUntilTarget(form.targetDate)
    : 0;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!form.name.trim()) {
      toast.error('Informe o nome do cofre');
      return;
    }
    const goalAmount = parseCurrencyInput(form.goalAmount);
    if (!goalAmount || goalAmount <= 0) {
      toast.error('Informe a meta final');
      return;
    }
    if (!form.targetDate) {
      toast.error('Informe a data de conclusão');
      return;
    }

    const payload = {
      name: form.name.trim(),
      goalAmount,
      targetDate: form.targetDate,
      autoDebit: form.autoDebit,
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
      <DialogContent className='rounded-xl sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>{bank ? 'Editar cofre' : 'Novo cofre'}</DialogTitle>
          <DialogDescription>
            Defina a meta final e a data — a meta mensal é calculada
            automaticamente.
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
              className='rounded-lg'
            />
          </div>

          <div className='flex flex-col gap-2'>
            <Label htmlFor='piggy-goal'>Meta final</Label>
            <CurrencyInput
              id='piggy-goal'
              value={form.goalAmount}
              onValueChange={(goalAmount) =>
                setForm((current) => ({ ...current, goalAmount }))
              }
              className='rounded-lg'
            />
          </div>

          <div className='flex flex-col gap-2'>
            <Label htmlFor='piggy-date'>Data de conclusão</Label>
            <Input
              id='piggy-date'
              type='date'
              value={form.targetDate}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  targetDate: event.target.value,
                }))
              }
              className='rounded-lg'
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

          <label className='flex flex-col gap-1 text-sm'>
            <span className='flex items-center gap-2'>
              <input
                type='checkbox'
                checked={form.autoDebit}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    autoDebit: event.target.checked,
                  }))
                }
                className='size-4 rounded border-border'
              />
              Débito automático no dia 1 de cada mês
            </span>
            <span className='pl-6 text-xs text-muted-foreground'>
              Não debita ao criar o cofre — só a partir do próximo dia 1. Até
              lá, use Guardar quando quiser.
            </span>
          </label>

          <label className='flex items-center gap-2 text-sm'>
            <input
              type='checkbox'
              checked={form.isEmergency}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  isEmergency: event.target.checked,
                }))
              }
              className='size-4 rounded border-border'
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
