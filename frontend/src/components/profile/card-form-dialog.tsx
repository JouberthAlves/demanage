import { useState } from 'react';
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
import { getApiErrorMessage } from '@/lib/api-error';
import type { CardPayload } from '@/lib/cards-api';
import {
  applyCardExpiryInput,
  cardExpiryError,
  formatBrlInputValue,
  formatCardExpiry,
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

/** Valores iniciais do formulário: o dia de fechamento é o que está em vigor. */
function initialForm(card: Card | null): FormState {
  if (!card) return emptyForm;
  return {
    name: card.name,
    limit: card.limit != null ? formatBrlInputValue(card.limit) : '',
    noLimit: card.limit == null,
    closingDay: card.closingDay ? String(card.closingDay).padStart(2, '0') : '',
    expiresAt: formatCardExpiry(card.expiresAt),
  };
}

/** `mutateAsync` não tipa o retorno; só lemos o campo de agendamento. */
function hasScheduledClosing(value: unknown) {
  return (
    typeof value === 'object' &&
    value !== null &&
    'pendingClosingDay' in value &&
    value.pendingClosingDay != null
  );
}

export function CardFormDialog({
  open,
  onOpenChange,
  card,
}: CardFormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[min(90dvh,720px)] overflow-y-auto rounded-xl sm:max-w-md'>
        {/* Radix desmonta o conteúdo ao fechar: cada abertura parte dos dados do cartão. */}
        <CardForm
          key={card?.id ?? 'new'}
          card={card}
          onDone={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

type CardFormProps = {
  card: Card | null;
  onDone: () => void;
};

function CardForm({ card, onDone }: CardFormProps) {
  const createCard = useCreateCard();
  const updateCard = useUpdateCard();
  const submitting = createCard.isPending || updateCard.isPending;

  const [form, setForm] = useState<FormState>(() => initialForm(card));
  const [expiryError, setExpiryError] = useState<string | null>(null);

  const pendingClosingDay =
    card?.pendingClosingDay != null
      ? String(card.pendingClosingDay).padStart(2, '0')
      : null;

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

    const expiryIssue = cardExpiryError(form.expiresAt);
    if (expiryIssue) {
      setExpiryError(expiryIssue);
      toast.error(expiryIssue);
      return;
    }
    const expiresAt =
      parseCardExpiryInput(form.expiresAt)?.toISOString() ?? null;

    const closingNormalized = normalizeClosingDayInput(form.closingDay);
    if (!closingNormalized) {
      toast.error('Informe o dia de fechamento (01-31)');
      return;
    }
    const closingDay = Number(closingNormalized);

    const parsedLimit = form.noLimit ? null : parseCurrencyInput(form.limit);
    if (!form.noLimit && (!parsedLimit || parsedLimit <= 0)) {
      toast.error('Informe um limite válido');
      return;
    }

    // Só envia o fechamento quando o dia exibido foi alterado: salvar outros
    // campos não deve reagendar a mudança pendente.
    const closingDayChanged = !card || closingDay !== card.closingDay;

    const payload: CardPayload = {
      name: form.name.trim().slice(0, 100),
      limit: parsedLimit,
      closingDay: closingDayChanged ? closingDay : undefined,
      expiresAt,
    };

    try {
      if (card) {
        const updated: unknown = await updateCard.mutateAsync({
          id: card.id,
          payload,
        });
        toast.success(
          closingDayChanged && hasScheduledClosing(updated)
            ? 'Fechamento agendado para depois do ciclo atual'
            : 'Cartão atualizado',
        );
      } else {
        await createCard.mutateAsync(payload);
        toast.success('Cartão adicionado');
      }
      onDone();
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Não foi possível salvar o cartão'));
    }
  }

  return (
    <>
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
                const { value } = applyCardExpiryInput(event.target.value);
                setForm((current) => ({ ...current, expiresAt: value }));
                setExpiryError(null);
              }}
              onBlur={() => setExpiryError(cardExpiryError(form.expiresAt))}
              aria-invalid={expiryError ? true : undefined}
              aria-describedby={expiryError ? 'card-expiry-error' : undefined}
              placeholder='MM/AA'
              className='rounded-lg'
            />
            {expiryError ? (
              <p id='card-expiry-error' className='text-xs text-destructive'>
                {expiryError}
              </p>
            ) : null}
          </div>
        </div>

        {card ? (
          <div className='space-y-1 text-xs text-muted-foreground'>
            {pendingClosingDay ? (
              <p className='text-neon-amber'>
                Fechamento agendado para o dia {pendingClosingDay} após o ciclo
                atual. O campo acima mostra o dia em vigor; altere-o apenas para
                trocar esse agendamento.
              </p>
            ) : null}
            <p>
              Uma mudança no dia de fechamento entra em vigor após o próximo
              ciclo. O primeiro ciclo ajustado terá pelo menos 28 dias.
            </p>
          </div>
        ) : null}

        <DialogFooter>
          <Button
            type='button'
            variant='outline'
            className='rounded-lg'
            onClick={() => onDone()}
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
    </>
  );
}
