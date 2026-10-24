import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { parseDayKey, todayKey } from '@/lib/dates';
import { formatCurrency } from '@/lib/format';
import type { Income } from '@/types/finance';

function ConfirmReceiptForm({
  income,
  now,
  pending,
  onCancel,
  onConfirm,
}: {
  income: Income;
  now: Date;
  pending: boolean;
  onCancel: () => void;
  onConfirm: (date: string) => Promise<void>;
}) {
  const today = todayKey(now);
  // Do not silently assume the planned date was the actual day of payment.
  const [receivedOn, setReceivedOn] = useState(today);
  const valid =
    /^\d{4}-\d{2}-\d{2}$/.test(receivedOn) &&
    parseDayKey(receivedOn) !== null &&
    receivedOn <= today;

  return (
    <>
      <DialogHeader>
        <DialogTitle>Confirmar recebimento</DialogTitle>
        <DialogDescription>
          Confirme que {formatCurrency(income.amount)} realmente entrou e
          informe o dia em que recebeu. Previsões não entram no saldo
          automaticamente.
        </DialogDescription>
      </DialogHeader>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (valid && !pending) void onConfirm(receivedOn);
        }}
        className='flex flex-col gap-4'
      >
        <div className='flex flex-col gap-2'>
          <Label htmlFor='income-received-on'>
            Data efetiva do recebimento
          </Label>
          <DatePicker
            id='income-received-on'
            value={receivedOn}
            onValueChange={setReceivedOn}
            max={today}
            disabled={pending}
          />
          {income.date ? (
            <p className='text-xs text-muted-foreground'>
              Data prevista no lançamento:{' '}
              {income.date.split('-').reverse().join('/')}. Escolha a data real,
              mesmo que seja anterior a hoje.
            </p>
          ) : null}
          {!valid ? (
            <p className='text-xs text-destructive'>
              Escolha uma data válida até hoje.
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button
            type='button'
            variant='outline'
            disabled={pending}
            onClick={onCancel}
          >
            Cancelar
          </Button>
          <Button type='submit' disabled={!valid || pending}>
            {pending ? <Spinner data-icon='inline-start' /> : null}
            Confirmar recebimento
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}

export function IncomeConfirmReceiptDialog({
  income,
  now,
  pending,
  onCancel,
  onConfirm,
}: {
  income: Income | null;
  now: Date;
  pending: boolean;
  onCancel: () => void;
  onConfirm: (date: string) => Promise<void>;
}) {
  return (
    <Dialog
      open={income != null}
      onOpenChange={(open) => {
        if (!open && !pending) onCancel();
      }}
    >
      <DialogContent className='rounded-xl sm:max-w-md'>
        {income ? (
          <ConfirmReceiptForm
            key={income.id}
            income={income}
            now={now}
            pending={pending}
            onCancel={onCancel}
            onConfirm={onConfirm}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
