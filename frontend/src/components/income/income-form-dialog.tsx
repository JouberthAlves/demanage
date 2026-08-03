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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { INCOME_FREQUENCY_LABELS, INCOME_TYPE_LABELS } from '@/data/labels';
import { parseCurrencyInput } from '@/lib/format';
import { useFinanceStore } from '@/stores/finance-store';
import type { Income, IncomeFrequency, IncomeType } from '@/types/finance';

type IncomeFormDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  income: Income | null;
};

type FormState = {
  name: string;
  amount: string;
  type: IncomeType;
  frequency: IncomeFrequency;
  date: string;
};

const emptyForm: FormState = {
  name: '',
  amount: '',
  type: 'salario',
  frequency: 'mensal',
  date: '',
};

export function IncomeFormDialog({
  open,
  onOpenChange,
  income,
}: IncomeFormDialogProps) {
  const addIncome = useFinanceStore((state) => state.addIncome);
  const updateIncome = useFinanceStore((state) => state.updateIncome);
  const [form, setForm] = useState<FormState>(emptyForm);

  useEffect(() => {
    if (!open) return;

    if (income) {
      setForm({
        name: income.name,
        amount: String(income.amount).replace('.', ','),
        type: income.type,
        frequency: income.frequency,
        date: income.date ?? '',
      });
      return;
    }

    setForm(emptyForm);
  }, [income, open]);

  function handleSubmit(event: React.FormEvent) {
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
      date: form.frequency === 'unica' ? form.date || undefined : undefined,
    };

    if (income) {
      updateIncome(income.id, payload);
      toast.success('Entrada atualizada');
    } else {
      addIncome(payload);
      toast.success('Entrada cadastrada');
    }

    onOpenChange(false);
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

        <form onSubmit={handleSubmit} className='space-y-4'>
          <div className='space-y-2'>
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

          <div className='space-y-2'>
            <Label htmlFor='income-amount'>Valor</Label>
            <Input
              id='income-amount'
              value={form.amount}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  amount: event.target.value,
                }))
              }
              placeholder='0,00'
              className='rounded-lg'
            />
          </div>

          <div className='grid grid-cols-2 gap-3'>
            <div className='space-y-2'>
              <Label>Tipo</Label>
              <Select
                value={form.type}
                onValueChange={(value) =>
                  setForm((current) => ({
                    ...current,
                    type: value as IncomeType,
                  }))
                }
              >
                <SelectTrigger className='rounded-lg'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(INCOME_TYPE_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className='space-y-2'>
              <Label>Frequência</Label>
              <Select
                value={form.frequency}
                onValueChange={(value) =>
                  setForm((current) => ({
                    ...current,
                    frequency: value as IncomeFrequency,
                  }))
                }
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
            <div className='space-y-2'>
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
            >
              Cancelar
            </Button>
            <Button type='submit' className='rounded-lg'>
              Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
