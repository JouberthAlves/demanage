import { isAxiosError } from 'axios';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { CurrencyInput } from '@/components/ui/currency-input';
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
import { INCOME_FREQUENCY_LABELS, CREATABLE_INCOME_TYPE_LABELS } from '@/data/labels';
import { useCreateEntry, useUpdateEntry } from '@/hooks/use-entries';
import { formatBrlInputValue, parseCurrencyInput } from '@/lib/format';
import type { Income, IncomeFrequency, IncomeType } from '@/types/finance';

type IncomeFormDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  income: Income | null;
};

type FormState = {
  name: string;
  amount: string;
  type: Exclude<IncomeType, 'salario'>;
  frequency: IncomeFrequency;
  date: string;
};

const emptyForm: FormState = {
  name: '',
  amount: '',
  type: 'freelance',
  frequency: 'mensal',
  date: '',
};

export function IncomeFormDialog({
  open,
  onOpenChange,
  income,
}: IncomeFormDialogProps) {
  const createEntry = useCreateEntry();
  const updateEntry = useUpdateEntry();
  const [form, setForm] = useState<FormState>(emptyForm);
  const submitting = createEntry.isPending || updateEntry.isPending;

  useEffect(() => {
    if (!open) return;

    if (income) {
      if (income.type === 'salario') {
        onOpenChange(false);
        toast.error('O salário é gerenciado na aba Perfil');
        return;
      }

      setForm({
        name: income.name,
        amount: formatBrlInputValue(income.amount),
        type: income.type,
        frequency: income.frequency,
        date: income.date ?? '',
      });
      return;
    }

    setForm(emptyForm);
  }, [income, open, onOpenChange]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    const amount = parseCurrencyInput(form.amount);
    if (!form.name.trim() || amount <= 0) {
      toast.error('Informe nome e um valor válido');
      return;
    }

    const payload = {
      name: form.name.trim(),
      amount,
      type: form.type,
      frequency: form.frequency,
      date: form.frequency === 'unica' ? form.date || null : null,
    };

    try {
      if (income) {
        await updateEntry.mutateAsync({ id: income.id, payload });
        toast.success('Entrada atualizada');
      } else {
        await createEntry.mutateAsync(payload);
        toast.success('Entrada cadastrada');
      }
      onOpenChange(false);
    } catch (err) {
      const message = isAxiosError(err)
        ? (err.response?.data?.error ?? 'Não foi possível salvar a entrada')
        : 'Não foi possível salvar a entrada';
      toast.error(message);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='rounded-xl sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>
            {income ? 'Editar entrada' : 'Nova entrada'}
          </DialogTitle>
          <DialogDescription>
            Cadastre fontes de renda mensais ou únicas.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(event) => void handleSubmit(event)}
          className='flex flex-col gap-4'
        >
          <div className='flex flex-col gap-2'>
            <Label htmlFor='income-name'>Nome</Label>
            <Input
              id='income-name'
              value={form.name}
              onChange={(event) =>
                setForm((current) => ({ ...current, name: event.target.value }))
              }
              placeholder='Ex: Salário'
              className='rounded-lg'
            />
          </div>

          <div className='flex flex-col gap-2'>
            <Label htmlFor='income-amount'>Valor</Label>
            <CurrencyInput
              id='income-amount'
              value={form.amount}
              onValueChange={(amount) =>
                setForm((current) => ({ ...current, amount }))
              }
              className='rounded-lg'
            />
          </div>

          <div className='grid grid-cols-2 gap-3'>
            <div className='flex flex-col gap-2'>
              <Label>Tipo</Label>
              <Select
                value={form.type}
                onValueChange={(value) => {
                  if (value === 'freelance' || value === 'outro') {
                    setForm((current) => ({
                      ...current,
                      type: value,
                    }));
                  }
                }}
              >
                <SelectTrigger className='rounded-lg'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(CREATABLE_INCOME_TYPE_LABELS).map(
                    ([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className='flex flex-col gap-2'>
              <Label>Frequência</Label>
              <Select
                value={form.frequency}
                onValueChange={(value) => {
                  if (value) {
                    setForm((current) => ({
                      ...current,
                      frequency: value as IncomeFrequency,
                    }));
                  }
                }}
              >
                <SelectTrigger className='rounded-lg'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(INCOME_FREQUENCY_LABELS).map(
                    ([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>

          {form.frequency === 'unica' ? (
            <div className='flex flex-col gap-2'>
              <Label htmlFor='income-date'>Data</Label>
              <Input
                id='income-date'
                type='date'
                value={form.date}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    date: event.target.value,
                  }))
                }
                className='rounded-lg'
              />
            </div>
          ) : null}

          <DialogFooter>
            <Button
              type='button'
              variant='outline'
              className='rounded-lg'
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancelar
            </Button>
            <Button type='submit' className='rounded-lg' disabled={submitting}>
              {submitting ? <Spinner data-icon='inline-start' /> : null}
              Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
