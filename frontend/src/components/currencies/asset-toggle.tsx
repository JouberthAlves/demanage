import { Button } from '@/components/ui/button';
import type { Asset } from '@/types/patrimony';

const ASSETS: Asset[] = ['BTC', 'USD'];

type AssetToggleProps = {
  value: Asset;
  onChange: (asset: Asset) => void;
  labelledBy?: string;
  ariaLabel?: string;
};

export function AssetToggle({
  value,
  onChange,
  labelledBy,
  ariaLabel,
}: AssetToggleProps) {
  return (
    <div
      role='group'
      aria-labelledby={labelledBy}
      aria-label={labelledBy ? undefined : ariaLabel}
      className='flex gap-2'
    >
      {ASSETS.map((item) => (
        <Button
          key={item}
          type='button'
          aria-pressed={value === item}
          variant={value === item ? 'default' : 'outline'}
          onClick={() => onChange(item)}
        >
          {item}
        </Button>
      ))}
    </div>
  );
}
