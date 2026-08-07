import { isAxiosError } from 'axios';
import { useEffect, useState } from 'react';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { useCreateCard, useUpdateCard } from '@/hooks/use-cards';
import {
  formatBrlInputValue,
  formatCardExpiry,
  applyCardExpiryInput,
  maskClosingDayInput,
  normalizeClosingDayInput,
  parseCardExpiryInput,
  parseCurrencyInput,
} from '@/lib/format';
import type { Card } from '@/types/finance';

type CardFormDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  card: Card | null;
};

type FormState = {
  name: string;
  limit: string;
  noLimit: boolean;
  closingDay: string;
  expiresAt: string;
};

const emptyForm: FormState = {
  name: '',
  limit: '',
  noLimit: false,
  closingDay: '',
  expiresAt: '',
};

export function CardFormDialog({
  open,
  onOpenChange,
  card,
}: CardFormDialogProps) {
  const createCard = useCreateCard();
  const updateCard = useUpdateCard();
  const [form, setForm] = useState<FormState>(emptyForm);
  const submitting = createCard.isPending || updateCard.isPending;

  useEffect(() => {
    if (!open) return;

    if (card) {
      setForm({
        name: card.name,
        limit: card.limit != null ? formatBrlInputValue(card.limit) : '',
        noLimit: card.limit == null,
        closingDay: card.closingDay
          ? String(card.closingDay).padStart(2, '0')
          : '',
        expiresAt: formatCardExpiry(card.expiresAt),
      });
      return;
    }

    setForm(emptyForm);
  }, [card, open]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    if (!form.name.trim()) {
      toast.error('Informe o nome do cartão');
      return;
    }

    if (!form.noLimit && !form.limit.trim()) {
      toast.error('Informe o limite ou marque Sem limite');
      return;
    }

    let expiresAt: string | null = null;
    if (form.expiresAt.trim()) {
      const parsed = parseCardExpiryInput(form.expiresAt);
      if (!parsed) {
        toast.error('Validade inválida. Use MM/AA');
        return;
      }
      expiresAt = parsed.toISOString();
    }

    const closingNormalized = normalizeClosingDayInput(form.closingDay);
    if (!closingNormalized) {
      toast.error('Informe o dia de fechamento (01-31)');
      return;
    }

    const parsedLimit = form.noLimit
      ? null
      : parseCurrencyInput(form.limit);

    if (!form.noLimit && (!parsedLimit || parsedLimit <= 0)) {
      toast.error('Informe um limite válido');
      return;
    }

    const payload = {
      name: form.name.trim().slice(0, 100),
      limit: parsedLimit,
      closingDay: Number(closingNormalized),
      expiresAt,
    };

    try {
      if (card) {
        await updateCard.mutateAsync({ id: card.id, payload });
        toast.success('Cartão atualizado');
      } else {
        await createCard.mutateAsync(payload);
        toast.success('Cartão adicionado');
      }
      onOpenChange(false);
    } catch (err) {
      const message = isAxiosError(err)
        ? (err.response?.data?.error ?? 'Não foi possível salvar o cartão')
        : 'Não foi possível salvar o cartão';
      toast.error(message);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[min(90dvh,720px)] overflow-y-auto rounded-xl sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>{card ? 'Editar cartão' : 'Novo cartão'}</DialogTitle>
          <DialogDescription>
            Fechamento da fatura e validade do cartão (MM/AA).
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(event) => void handleSubmit(event)}
          className='flex flex-col gap-4'
        >
          <div className='flex flex-col gap-2'>
            <Label htmlFor='card-name'>Nome</Label>
            <Input
              id='card-name'
              value={form.name}
              onChange={(event) =>
                setForm((current) => ({ ...current, name: event.target.value }))
              }
              placeholder='Ex: Nubank'
              maxLength={100}
              className='rounded-lg'
            />
          </div>

          <div className='flex flex-col gap-2'>
            <div className='flex items-center justify-between gap-3'>
              <Label htmlFor='card-limit'>Limite</Label>
              <label
                htmlFor='card-no-limit'
                className='flex cursor-pointer items-center gap-2 text-sm text-muted-foreground'
              >
                <Checkbox
                  id='card-no-limit'
                  checked={form.noLimit}
                  onCheckedChange={(checked) => {
                    const noLimit = checked === true;
                    setForm((current) => ({
                      ...current,
                      noLimit,
                      limit: noLimit ? '' : current.limit,
                    }));
                  }}
                />
                Sem limite
              </label>
            </div>
            <CurrencyInput
              id='card-limit'
              value={form.limit}
              onValueChange={(limit) =>
                setForm((current) => ({
                  ...current,
                  limit,
                  noLimit: false,
                }))
              }
              disabled={form.noLimit}
              className='rounded-lg'
            />
            {form.noLimit ? (
              <p className='text-xs text-muted-foreground'>
                O cartão não entra no gráfico de comprometimento do limite.
              </p>
            ) : null}
          </div>

          <div className='grid grid-cols-2 gap-3'>
            <div className='flex flex-col gap-2'>
              <Label htmlFor='card-closing'>Fechamento (obrigatório)</Label>
              <Input
                id='card-closing'
                inputMode='numeric'
                maxLength={2}
                value={form.closingDay}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    closingDay: maskClosingDayInput(event.target.value),
                  }))
                }
                onBlur={() =>
                  setForm((current) => ({
                    ...current,
                    closingDay: normalizeClosingDayInput(current.closingDay),
                  }))
                }
                placeholder='05'
                className='rounded-lg'
              />
            </div>
            <div className='flex flex-col gap-2'>
              <Label htmlFor='card-expiry'>Validade</Label>
              <Input
                id='card-expiry'
                inputMode='numeric'
                value={form.expiresAt}
                onChange={(event) => {
                  const result = applyCardExpiryInput(event.target.value);
                  if (result.error) {
                    toast.error(result.error);
                  }
                  setForm((current) => ({
                    ...current,
                    expiresAt: result.value,
                  }));
                }}
                placeholder='MM/AA'
                className='rounded-lg'
              />
            </div>
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
