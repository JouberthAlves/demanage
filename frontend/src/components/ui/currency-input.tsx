import type { ComponentProps } from 'react';

import { Input } from '@/components/ui/input';
import { maskBrlInput } from '@/lib/format';
import { cn } from '@/lib/utils';

type CurrencyInputProps = Omit<
  ComponentProps<'input'>,
  'value' | 'onChange' | 'type' | 'inputMode'
> & {
  value: string;
  onValueChange: (value: string) => void;
  showPrefix?: boolean;
};

export function CurrencyInput({
  value,
  onValueChange,
  showPrefix = true,
  className,
  ...props
}: CurrencyInputProps) {
  return (
    <div className='relative'>
      {showPrefix ? (
        <span className='pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground'>
          R$
        </span>
      ) : null}
      <Input
        inputMode='numeric'
        autoComplete='off'
        value={value}
        onChange={(event) => onValueChange(maskBrlInput(event.target.value))}
        placeholder='0,00'
        className={cn(showPrefix && 'pl-10', className)}
        {...props}
      />
    </div>
  );
}
