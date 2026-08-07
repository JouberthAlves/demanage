import { format, isValid } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { CalendarIcon, X } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';

type DatePickerProps = {
  id?: string;
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  allowClear?: boolean;
  min?: string;
  max?: string;
};

function parseDateValue(value: string): Date | undefined {
  if (!value.trim()) return undefined;
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return undefined;
  const date = new Date(year, month - 1, day);
  return isValid(date) ? date : undefined;
}

function toDateValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function DatePicker({
  id,
  value,
  onValueChange,
  placeholder = 'Selecione a data',
  disabled,
  className,
  allowClear = false,
  min,
  max,
}: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const selected = parseDateValue(value);
  const minDate = min ? parseDateValue(min) : undefined;
  const maxDate = max ? parseDateValue(max) : undefined;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className={cn('relative', className)}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type='button'
            variant='outline'
            disabled={disabled}
            data-empty={!selected}
            className={cn(
              'h-9 w-full justify-start rounded-lg border-transparent bg-input/50 px-3 font-normal hover:bg-input/70',
              !selected && 'text-muted-foreground',
              allowClear && selected && 'pr-9',
            )}
          >
            <CalendarIcon className='size-4 text-muted-foreground' />
            {selected
              ? format(selected, 'dd/MM/yyyy', { locale: ptBR })
              : placeholder}
          </Button>
        </PopoverTrigger>
        {allowClear && selected ? (
          <Button
            type='button'
            variant='ghost'
            size='icon-xs'
            disabled={disabled}
            className='absolute top-1/2 right-1.5 -translate-y-1/2 text-muted-foreground hover:text-foreground'
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onValueChange('');
            }}
            aria-label='Limpar data'
          >
            <X className='size-3.5' />
          </Button>
        ) : null}
      </div>
      <PopoverContent
        align='start'
        className='w-auto rounded-2xl border border-border bg-popover p-0'
      >
        <Calendar
          mode='single'
          locale={ptBR}
          selected={selected}
          defaultMonth={selected}
          captionLayout='dropdown'
          startMonth={new Date(new Date().getFullYear() - 5, 0)}
          endMonth={new Date(new Date().getFullYear() + 15, 11)}
          disabled={[
            ...(minDate ? [{ before: minDate }] : []),
            ...(maxDate ? [{ after: maxDate }] : []),
          ]}
          onSelect={(date) => {
            onValueChange(date ? toDateValue(date) : '');
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
