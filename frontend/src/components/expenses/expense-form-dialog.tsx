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
import { Textarea } from '@/components/ui/textarea';
import { EXPENSE_CATEGORY_LABELS } from '@/data/labels';
import { useCreateExpense, useUpdateExpense } from '@/hooks/use-expenses';
import { parseCurrencyInput } from '@/lib/format';
import { useFinanceStore } from '@/stores/finance-store';
import type { ExpenseCategory, RecurringExpense } from '@/types/finance';

type ExpenseFormDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  expense: RecurringExpense | null;
};

type FormState = {
  name: string;
  amount: string;
  category: ExpenseCategory;
  cardId: string;
  dueDay: string;
  notes: string;
};

const emptyForm: FormState = {
  name: '',
  amount: '',
  category: 'assinatura',
  cardId: 'none',
  dueDay: '',
  notes: '',
};

export function ExpenseFormDialog({
  open,
  onOpenChange,
  expense,
}: ExpenseFormDialogProps) {
  const cards = useFinanceStore((state) => state.profile.cards);
  const createExpense = useCreateExpense();
  const updateExpense = useUpdateExpense();
  const [form, setForm] = useState<FormState>(emptyForm);
  const submitting = createExpense.isPending || updateExpense.isPending;

  useEffect(() => {
    if (!open) return;

    if (expense) {
      setForm({
        name: expense.name,
        amount: String(expense.amount).replace('.', ','),
        category: expense.category,
        cardId: expense.cardId ?? 'none',
        dueDay: expense.dueDay ? String(expense.dueDay) : '',
        notes: expense.notes ?? '',
      });
      return;
    }

    setForm(emptyForm);
  }, [expense, open]);

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
      category: form.category,
      frequency: 'mensal' as const,
      cardId: form.cardId === 'none' ? null : form.cardId,
      dueDay: form.dueDay ? Number(form.dueDay) : null,
      notes: form.notes.trim() || null,
    };

    try {
      if (expense) {
        await updateExpense.mutateAsync({ id: expense.id, payload });
        toast.success('Despesa atualizada');
      } else {
        await createExpense.mutateAsync(payload);
        toast.success('Despesa cadastrada');
      }
      onOpenChange(false);
    } catch (err) {
      const message = isAxiosError(err)
        ? (err.response?.data?.error ?? 'Não foi possível salvar a despesa')
        : 'Não foi possível salvar a despesa';
      toast.error(message);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='rounded-xl sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>
            {expense ? 'Editar despesa' : 'Nova despesa recorrente'}
          </DialogTitle>
          <DialogDescription>
            Cadastre assinaturas, parcelas e outras despesas mensais.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(event) => void handleSubmit(event)}
          className='flex flex-col gap-4'
        >
          <div className='flex flex-col gap-2'>
            <Label htmlFor='expense-name'>Nome</Label>
            <Input
              id='expense-name'
              value={form.name}
              onChange={(event) =>
                setForm((current) => ({ ...current, name: event.target.value }))
              }
              placeholder='Ex: Netflix'
              className='rounded-lg'
            />
          </div>

          <div className='grid grid-cols-2 gap-3'>
            <div className='flex flex-col gap-2'>
              <Label htmlFor='expense-amount'>Valor</Label>
              <Input
                id='expense-amount'
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
            <div className='flex flex-col gap-2'>
              <Label htmlFor='expense-due'>Dia vencimento</Label>
              <Input
                id='expense-due'
                type='number'
                min={1}
                max={31}
                value={form.dueDay}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    dueDay: event.target.value,
                  }))
                }
                placeholder='10'
                className='rounded-lg'
              />
            </div>
          </div>

          <div className='grid grid-cols-2 gap-3'>
            <div className='flex flex-col gap-2'>
              <Label>Categoria</Label>
              <Select
                value={form.category}
                onValueChange={(value) =>
                  setForm((current) => ({
                    ...current,
                    category: value as ExpenseCategory,
                  }))
                }
              >
                <SelectTrigger className='rounded-lg'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(EXPENSE_CATEGORY_LABELS).map(
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
              <Label>Cartão</Label>
              <Select
                value={form.cardId}
                onValueChange={(value) => {
                  if (value) {
                    setForm((current) => ({ ...current, cardId: value }));
                  }
                }}
              >
                <SelectTrigger className='rounded-lg'>
                  <SelectValue placeholder='Opcional' />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='none'>Nenhum</SelectItem>
                  {cards.map((card) => (
                    <SelectItem key={card.id} value={card.id}>
                      {card.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className='flex flex-col gap-2'>
            <Label htmlFor='expense-notes'>Observações</Label>
            <Textarea
              id='expense-notes'
              value={form.notes}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  notes: event.target.value,
                }))
              }
              placeholder='Opcional'
              className='min-h-20 rounded-lg'
            />
          </div>

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
