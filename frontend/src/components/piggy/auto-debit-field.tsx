import { Checkbox } from '@/components/ui/checkbox';
import { CurrencyInput } from '@/components/ui/currency-input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const AUTO_DEBIT_DAYS = Array.from({ length: 31 }, (_, index) =>
  String(index + 1),
);

type AutoDebitFieldProps = {
  enabled: boolean;
  day: string;
  amount: string;
  /** Ask for the amount only when it cannot be derived from goal + date. */
  askAmount: boolean;
  onEnabledChange: (enabled: boolean) => void;
  onDayChange: (day: string) => void;
  onAmountChange: (amount: string) => void;
};

export function AutoDebitField({
  enabled,
  day,
  amount,
  askAmount,
  onEnabledChange,
  onDayChange,
  onAmountChange,
}: AutoDebitFieldProps) {
  return (
    <div className='flex flex-col gap-3'>
      <label
        htmlFor='piggy-auto-debit'
        className='flex cursor-pointer items-start gap-2 text-sm'
      >
        <Checkbox
          id='piggy-auto-debit'
          checked={enabled}
          onCheckedChange={(checked) => onEnabledChange(checked === true)}
          className='mt-0.5'
        />
        <span className='flex flex-col gap-1'>
          <span>Débito automático mensal</span>
          <span className='text-xs text-muted-foreground'>
            Cria uma transferência interna para o Cofrinho no dia escolhido.
          </span>
        </span>
      </label>

      {enabled ? (
        <div className='flex flex-col gap-3 pl-6'>
          {askAmount ? (
            <div className='flex flex-col gap-2'>
              <Label htmlFor='piggy-monthly-debit'>Valor do débito mensal</Label>
              <CurrencyInput
                id='piggy-monthly-debit'
                value={amount}
                onValueChange={onAmountChange}
                className='rounded-lg'
              />
            </div>
          ) : null}

          <div className='flex flex-col gap-2'>
            <Label htmlFor='piggy-auto-debit-day'>Dia do débito</Label>
            <Select
              value={day}
              onValueChange={(value) => {
                if (value) onDayChange(value);
              }}
            >
              <SelectTrigger id='piggy-auto-debit-day' className='rounded-lg'>
                <SelectValue placeholder='Dia' />
              </SelectTrigger>
              <SelectContent>
                {AUTO_DEBIT_DAYS.map((option) => (
                  <SelectItem key={option} value={option}>
                    Dia {option.padStart(2, '0')}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      ) : null}
    </div>
  );
}
