import type { ReactNode } from 'react';

import {
  type DateRangePreset,
  DEFAULT_RANGE_PRESETS,
} from '@/components/charts/date-range';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type DateRangeFilterProps = {
  from: string;
  to: string;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
  onPreset: (days: number) => void;
  presets?: DateRangePreset[];
  /** Lower bound for both inputs (e.g. the patrimony base date). */
  min?: string;
  /** Upper bound for both inputs (usually today). */
  max: string;
  /** Extra buttons rendered after the presets (e.g. "Máx"). */
  extra?: ReactNode;
};

export function DateRangeFilter({
  from,
  to,
  onFromChange,
  onToChange,
  onPreset,
  presets = DEFAULT_RANGE_PRESETS,
  min,
  max,
  extra,
}: DateRangeFilterProps) {
  return (
    <div className='mb-4 flex flex-wrap gap-2'>
      {presets.map((preset) => (
        <Button
          key={preset.label}
          type='button'
          size='sm'
          variant='outline'
          onClick={() => onPreset(preset.days)}
        >
          {preset.label}
        </Button>
      ))}
      {extra}
      <Input
        type='date'
        aria-label='Data inicial'
        min={min}
        max={to || max}
        value={from}
        onChange={(event) => onFromChange(event.target.value)}
        className='w-auto'
      />
      <Input
        type='date'
        aria-label='Data final'
        min={from || min}
        max={max}
        value={to}
        onChange={(event) => onToChange(event.target.value)}
        className='w-auto'
      />
    </div>
  );
}
