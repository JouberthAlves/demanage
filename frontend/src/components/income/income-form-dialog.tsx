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
import {
  BUILTIN_INCOME_TYPE_LABELS,
  INCOME_FREQUENCY_LABELS,
} from '@/data/labels';
import { useCreateEntry, useUpdateEntry } from '@/hooks/use-entries';
import { useCustomTags } from '@/hooks/use-custom-tags';
import {
  formatBrlInputValue,
  maskClosingDayInput,
  normalizeClosingDayInput,
  parseCurrencyInput,
} from '@/lib/format';
import type { Income, IncomeFrequency, IncomeType } from '@/types/finance';

type IncomeFormDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  income: Income | null;
};

type FormState = {
  name: string;
  amount: string;
  typeKey: string;
  frequency: IncomeFrequency;
  receiveDay: string;
  endsAt: string;
  date: string;
};

const NEW_TYPE_VALUE = '__new_type__';

const emptyForm: FormState = {
  name: '',
  amount: '',
  typeKey: 'freelance',
  frequency: 'mensal',
  receiveDay: '05',
  endsAt: '',
  date: '',
};

function typeKeyFromIncome(income: Income) {
  if (income.customTagId) return `tag:${income.customTagId}`;
  return income.type;
}

export function IncomeFormDialog({
  open,
  onOpenChange,
  income,
}: IncomeFormDialogProps) {
  const { data: customTags = [] } = useCustomTags('income');
  const createEntry = useCreateEntry();
  const updateEntry = useUpdateEntry();
  const [form, setForm] = useState<FormState>(emptyForm);
  const [tagDialogOpen, setTagDialogOpen] = useState(false);
  const submitting = createEntry.isPending || updateEntry.isPending;
  const isRecurring =
    form.frequency === 'mensal' || form.frequency === 'semanal';

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
        typeKey: typeKeyFromIncome(income),
        frequency: income.frequency,
        receiveDay: income.receiveDay
          ? String(income.receiveDay).padStart(2, '0')
          : '05',
        endsAt: income.endsAt ?? '',
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

    const isCustom = form.typeKey.startsWith('tag:');
    const customTagId = isCustom ? form.typeKey.slice(4) : null;
    const type: IncomeType = isCustom
      ? 'outro'
      : (form.typeKey as IncomeType);

    let receiveDay: number | null = null;
    if (isRecurring) {
      const normalized = normalizeClosingDayInput(form.receiveDay);
      receiveDay = normalized ? Number(normalized) : NaN;
      if (!Number.isInteger(receiveDay) || receiveDay < 1 || receiveDay > 31) {
        toast.error('Informe o dia em que recebe (01-31)');
        return;
      }
    }

    const payload = {
      name: form.name.trim(),
      amount,
      type,
      frequency: form.frequency,
      receiveDay,
      endsAt: isRecurring ? form.endsAt || null : null,
      date: form.frequency === 'unica' ? form.date || null : null,
      customTagId,
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
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className='rounded-xl sm:max-w-md'>
          <DialogHeader>
            <DialogTitle>
              {income ? 'Editar entrada' : 'Nova entrada'}
            </DialogTitle>
            <DialogDescription>
              Cadastre fontes de renda mensais, semanais ou únicas.
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
                  setForm((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
                placeholder='Ex: Freelance'
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
                  value={form.typeKey}
                  onValueChange={(value) => {
                    if (!value) return;
                    if (value === NEW_TYPE_VALUE) {
                      setTagDialogOpen(true);
                      return;
                    }
                    setForm((current) => ({
                      ...current,
                      typeKey: value,
                    }));
                  }}
                >
                  <SelectTrigger className='rounded-lg'>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(BUILTIN_INCOME_TYPE_LABELS).map(
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

            {isRecurring ? (
              <div className='grid grid-cols-2 gap-3'>
                <div className='flex flex-col gap-2'>
                  <Label htmlFor='income-receive-day'>Quando recebe</Label>
                  <Input
                    id='income-receive-day'
                    inputMode='numeric'
                    maxLength={2}
                    value={form.receiveDay}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        receiveDay: maskClosingDayInput(event.target.value),
                      }))
                    }
                    onBlur={() =>
                      setForm((current) => ({
                        ...current,
                        receiveDay: normalizeClosingDayInput(
                          current.receiveDay,
                        ),
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
                  <Label htmlFor='income-ends-at'>Data de término</Label>
                  <Input
                    id='income-ends-at'
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

      <CustomTagFormDialog
        open={tagDialogOpen}
        onOpenChange={setTagDialogOpen}
        scope='income'
        onCreated={(tag) => {
          setForm((current) => ({
            ...current,
            typeKey: `tag:${tag.id}`,
          }));
        }}
      />
    </>
  );
}
