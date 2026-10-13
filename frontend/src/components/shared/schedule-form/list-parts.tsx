import type { ComponentType } from 'react';
import { Search } from 'lucide-react';

import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { formatCurrency } from '@/lib/format';
import { cn } from '@/lib/utils';

import type { SelectOption } from './custom-tag-select';

type ListFiltersProps = {
  search: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder: string;
  value: string;
  onValueChange: (value: string) => void;
  selectPlaceholder: string;
  allLabel: string;
  options: SelectOption[];
};

/** Search box plus a category / type select used above the list pages. */
export function ListFilters({
  search,
  onSearchChange,
  searchPlaceholder,
  value,
  onValueChange,
  selectPlaceholder,
  allLabel,
  options,
}: ListFiltersProps) {
  return (
    <div className='mb-4 flex flex-col gap-3 sm:flex-row'>
      <div className='relative flex-1'>
        <Search className='pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground' />
        <Input
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={searchPlaceholder}
          className='rounded-lg pl-9'
        />
      </div>
      <Select
        value={value}
        onValueChange={(next) => {
          if (next) onValueChange(next);
        }}
      >
        <SelectTrigger className='w-full rounded-lg sm:w-48'>
          <SelectValue placeholder={selectPlaceholder} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value='all'>{allLabel}</SelectItem>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** "Já no saldo" and "Resultado do filtro" tiles of the page hero. */
export function SummaryTiles({
  total,
  filteredTotal,
  totalClassName,
}: {
  total: number;
  filteredTotal: number;
  totalClassName: string;
}) {
  return (
    <div className='grid gap-3 sm:grid-cols-2'>
      <div className='rounded-xl border border-border bg-black/25 p-4'>
        <p className='text-xs text-muted-foreground'>Já no saldo / mês</p>
        <p className={cn('mt-2 text-2xl font-semibold', totalClassName)}>
          {formatCurrency(total)}
        </p>
      </div>
      <div className='rounded-xl border border-border bg-black/25 p-4'>
        <p className='text-xs text-muted-foreground'>Resultado do filtro</p>
        <p className='mt-2 text-2xl font-semibold'>
          {formatCurrency(filteredTotal)}
        </p>
      </div>
    </div>
  );
}

const STATE_BOX =
  'flex items-center justify-center rounded-xl border border-border bg-black/15';

export function ListLoading() {
  return (
    <div className={cn(STATE_BOX, 'h-28')}>
      <Spinner className='size-5' />
    </div>
  );
}

export function ListError({ message }: { message: string }) {
  return <div className={cn(STATE_BOX, 'h-28 text-destructive')}>{message}</div>;
}

export function ListEmpty({
  icon: Icon,
  iconClassName,
  iconBoxClassName,
  title,
  description,
}: {
  icon: ComponentType<{ className?: string }>;
  iconClassName: string;
  iconBoxClassName: string;
  title: string;
  description: string;
}) {
  return (
    <div className={cn(STATE_BOX, 'h-40 flex-col gap-2 text-center')}>
      <div
        className={cn(
          'flex size-12 items-center justify-center rounded-2xl',
          iconBoxClassName,
        )}
      >
        <Icon className={cn('size-6', iconClassName)} />
      </div>
      <p className='font-medium'>{title}</p>
      <p className='text-sm text-muted-foreground'>{description}</p>
    </div>
  );
}

/** "3 despesas • R$ 10,00 filtrado / mês" footer. */
export function ListFooter({
  count,
  noun,
  filteredTotal,
  total,
}: {
  count: number;
  noun: string;
  filteredTotal: number;
  total: number;
}) {
  return (
    <p className='mt-3 text-sm text-muted-foreground'>
      {count} {noun}
      {count === 1 ? '' : 's'} • {formatCurrency(filteredTotal)} filtrado
      {filteredTotal !== total
        ? ` · ${formatCurrency(total)} no total`
        : ' / mês'}
    </p>
  );
}
