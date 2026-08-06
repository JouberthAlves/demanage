import { isAxiosError } from 'axios';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { CustomTagFormDialog } from '@/components/shared/custom-tag-form-dialog';
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
import { Textarea } from '@/components/ui/textarea';
import {
  BUILTIN_EXPENSE_CATEGORY_LABELS,
  EXPENSE_FREQUENCY_LABELS,
} from '@/data/labels';
import { useCustomTags } from '@/hooks/use-custom-tags';
import { useCreateExpense, useUpdateExpense } from '@/hooks/use-expenses';
import {
  formatBrlInputValue,
  maskClosingDayInput,
  normalizeClosingDayInput,
  parseCurrencyInput,
} from '@/lib/format';
import { useFinanceStore } from '@/stores/finance-store';
import type {
  ExpenseCategory,
  ExpenseFrequency,
  RecurringExpense,
} from '@/types/finance';

type ExpenseFormDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  expense: RecurringExpense | null;
};

type FormState = {
  name: string;
  amount: string;
  categoryKey: string;
  frequency: ExpenseFrequency;
  cardId: string;
  dueDay: string;
  endsAt: string;
  notes: string;
};

const NEW_TYPE_VALUE = '__new_type__';

const emptyForm: FormState = {
  name: '',
  amount: '',
  categoryKey: 'assinatura',
  frequency: 'mensal',
  cardId: 'none',
  dueDay: '05',
  endsAt: '',
  notes: '',
};

function categoryKeyFromExpense(expense: RecurringExpense) {
  if (expense.customTagId) return `tag:${expense.customTagId}`;
  return expense.category;
}

export function ExpenseFormDialog({
  open,
  onOpenChange,
  expense,
}: ExpenseFormDialogProps) {
  const cards = useFinanceStore((state) => state.profile.cards);
  const { data: customTags = [] } = useCustomTags('expense');
  const createExpense = useCreateExpense();
  const updateExpense = useUpdateExpense();
  const [form, setForm] = useState<FormState>(emptyForm);
  const [tagDialogOpen, setTagDialogOpen] = useState(false);
  const submitting = createExpense.isPending || updateExpense.isPending;
  const isUnique = form.frequency === 'unica';
  const isRecurring =
    form.frequency === 'mensal' || form.frequency === 'semanal';

  useEffect(() => {
    if (!open) return;

    if (expense) {
      setForm({
        name: expense.name,
        amount: formatBrlInputValue(expense.amount),
        categoryKey: categoryKeyFromExpense(expense),
        frequency: expense.frequency,
        cardId: expense.cardId ?? 'none',
        dueDay: expense.dueDay
          ? String(expense.dueDay).padStart(2, '0')
          : '05',
        endsAt: expense.endsAt ?? '',
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

    const isCustom = form.categoryKey.startsWith('tag:');
    const customTagId = isCustom ? form.categoryKey.slice(4) : null;
    const category: ExpenseCategory = isCustom
      ? 'outro'
      : (form.categoryKey as ExpenseCategory);

    let dueDay: number | null = null;
    if (isRecurring) {
      const normalized = normalizeClosingDayInput(form.dueDay);
      dueDay = normalized ? Number(normalized) : NaN;
      if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) {
        toast.error('Informe o dia em que será descontado (01-31)');
        return;
      }
    }

    const payload = {
      name: form.name.trim(),
      amount,
      category,
      frequency: form.frequency,
      cardId: form.cardId === 'none' ? null : form.cardId,
      dueDay,
      endsAt: isRecurring ? form.endsAt || null : null,
      notes: form.notes.trim() || null,
      customTagId,
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
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className='rounded-xl sm:max-w-md'>
          <DialogHeader>
            <DialogTitle>
              {expense ? 'Editar despesa' : 'Nova despesa'}
            </DialogTitle>
            <DialogDescription>
              Cadastre assinaturas, parcelas e outras despesas.
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
                  setForm((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
                placeholder='Ex: Netflix'
                className='rounded-lg'
              />
            </div>

            <div className='flex flex-col gap-2'>
              <Label htmlFor='expense-amount'>Valor</Label>
              <CurrencyInput
                id='expense-amount'
                value={form.amount}
                onValueChange={(amount) =>
                  setForm((current) => ({ ...current, amount }))
                }
                className='rounded-lg'
              />
            </div>

            <div className='grid grid-cols-2 gap-3'>
              <div className='flex flex-col gap-2'>
                <Label>Categoria</Label>
                <Select
                  value={form.categoryKey}
                  onValueChange={(value) => {
                    if (!value) return;
                    if (value === NEW_TYPE_VALUE) {
                      setTagDialogOpen(true);
                      return;
                    }
                    setForm((current) => ({
                      ...current,
                      categoryKey: value,
                    }));
                  }}
                >
                  <SelectTrigger className='rounded-lg'>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(BUILTIN_EXPENSE_CATEGORY_LABELS).map(
                      ([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ),
                    )}
                    {customTags.map((tag) => (
                      <SelectItem key={tag.id} value={`tag:${tag.id}`}>
                        <span className='inline-flex items-center gap-2'>
                          <span
                            className='size-2.5 rounded-full'
                            style={{ backgroundColor: tag.color }}
                          />
                          {tag.name}
                        </span>
                      </SelectItem>
                    ))}
                    <SelectItem value={NEW_TYPE_VALUE}>Outro…</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className='flex flex-col gap-2'>
                <Label>Frequência</Label>
                <Select
                  value={form.frequency}
                  onValueChange={(value) => {
                    if (!value) return;
                    setForm((current) => ({
                      ...current,
                      frequency: value as ExpenseFrequency,
                      dueDay: value === 'unica' ? '' : current.dueDay || '05',
                      endsAt: value === 'unica' ? '' : current.endsAt,
                    }));
                  }}
                >
                  <SelectTrigger className='rounded-lg'>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(EXPENSE_FREQUENCY_LABELS).map(
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

            {isRecurring ? (
              <div className='grid grid-cols-2 gap-3'>
                <div className='flex flex-col gap-2'>
                  <Label htmlFor='expense-due'>Quando será descontado</Label>
                  <Input
                    id='expense-due'
                    inputMode='numeric'
                    maxLength={2}
                    value={form.dueDay}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        dueDay: maskClosingDayInput(event.target.value),
                      }))
                    }
                    onBlur={() =>
                      setForm((current) => ({
                        ...current,
                        dueDay: normalizeClosingDayInput(current.dueDay),
                      }))
                    }
                    placeholder='05'
                    className='rounded-lg'
                  />
                  <p className='text-xs text-muted-foreground'>
                    Dia do mês em que entra no saldo.
                  </p>
                </div>
                <div className='flex flex-col gap-2'>
                  <Label htmlFor='expense-ends-at'>Data de término</Label>
                  <Input
                    id='expense-ends-at'
                    type='date'
                    value={form.endsAt}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        endsAt: event.target.value,
                      }))
                    }
                    className='rounded-lg'
                  />
                  <p className='text-xs text-muted-foreground'>
                    Opcional. Vazio = sem fim.
                  </p>
                </div>
              </div>
            ) : null}

            {isUnique ? (
              <p className='text-xs text-muted-foreground'>
                Despesa única usa a data de hoje e não tem vencimento.
              </p>
            ) : null}

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
                  {cards
                    .filter((card) => !card.expired)
                    .map((card) => (
                      <SelectItem key={card.id} value={card.id}>
                        {card.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              {cards.some((card) => card.expired) ? (
                <p className='text-xs text-muted-foreground'>
                  Cartões vencidos não podem receber novas despesas.
                </p>
              ) : null}
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

      <CustomTagFormDialog
        open={tagDialogOpen}
        onOpenChange={setTagDialogOpen}
        scope='expense'
        onCreated={(tag) => {
          setForm((current) => ({
            ...current,
            categoryKey: `tag:${tag.id}`,
          }));
        }}
      />
    </>
  );
}
