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
import { Spinner } from '@/components/ui/spinner';
import { useCreateCard, useUpdateCard } from '@/hooks/use-cards';
import { formatBrlInputValue, parseCurrencyInput } from '@/lib/format';
import type { Card } from '@/types/finance';

type CardFormDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  card: Card | null;
};

type FormState = {
  name: string;
  limit: string;
  closingDay: string;
  dueDay: string;
};

const emptyForm: FormState = {
  name: '',
  limit: '',
  closingDay: '',
  dueDay: '',
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
        limit:
          card.limit != null ? formatBrlInputValue(card.limit) : '',
        closingDay: card.closingDay ? String(card.closingDay) : '',
        dueDay: card.dueDay ? String(card.dueDay) : '',
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

    const payload = {
      name: form.name.trim(),
      limit: form.limit ? parseCurrencyInput(form.limit) : null,
      closingDay: form.closingDay ? Number(form.closingDay) : null,
      dueDay: form.dueDay ? Number(form.dueDay) : null,
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
      <DialogContent className='rounded-xl sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>{card ? 'Editar cartão' : 'Novo cartão'}</DialogTitle>
          <DialogDescription>
            Cadastre limite, fechamento e vencimento.
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
              className='rounded-lg'
            />
          </div>

          <div className='flex flex-col gap-2'>
            <Label htmlFor='card-limit'>Limite</Label>
            <CurrencyInput
              id='card-limit'
              value={form.limit}
              onValueChange={(limit) =>
                setForm((current) => ({ ...current, limit }))
              }
              className='rounded-lg'
            />
          </div>

          <div className='grid grid-cols-2 gap-3'>
            <div className='flex flex-col gap-2'>
              <Label htmlFor='card-closing'>Fechamento</Label>
              <Input
                id='card-closing'
                type='number'
                min={1}
                max={31}
                value={form.closingDay}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    closingDay: event.target.value,
                  }))
                }
                className='rounded-lg'
              />
            </div>
            <div className='flex flex-col gap-2'>
              <Label htmlFor='card-due'>Vencimento</Label>
              <Input
                id='card-due'
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
