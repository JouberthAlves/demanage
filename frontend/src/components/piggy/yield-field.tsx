import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type YieldFieldProps = {
  enabled: boolean;
  cdiPercent: string;
  onEnabledChange: (enabled: boolean) => void;
  onCdiPercentChange: (value: string) => void;
};

export function YieldField({
  enabled,
  cdiPercent,
  onEnabledChange,
  onCdiPercentChange,
}: YieldFieldProps) {
  return (
    <div className='rounded-xl border border-border p-3'>
      <label
        htmlFor='piggy-yield'
        className='flex cursor-pointer items-start gap-2 text-sm'
      >
        <Checkbox
          id='piggy-yield'
          checked={enabled}
          onCheckedChange={(checked) => onEnabledChange(checked === true)}
          className='mt-0.5'
        />
        <span className='flex flex-col gap-1'>
          <span>Este Cofrinho rende?</span>
          <span className='text-xs text-muted-foreground'>
            O rendimento é calculado diariamente e capitalizado no saldo.
          </span>
        </span>
      </label>
      {enabled ? (
        <div className='mt-3 flex flex-col gap-2 pl-6'>
          <Label htmlFor='piggy-cdi-percent'>Quantos % do CDI?</Label>
          <Input
            id='piggy-cdi-percent'
            inputMode='decimal'
            value={cdiPercent}
            onChange={(event) => onCdiPercentChange(event.target.value)}
            placeholder='100'
          />
          <p className='text-xs text-muted-foreground'>
            Ex.: 100 = 100% do CDI; 120 = 120% do CDI. Sem desconto de IR.
          </p>
        </div>
      ) : null}
    </div>
  );
}
