import { useMemo, useState } from 'react';

import { AssetToggle } from '@/components/currencies/asset-toggle';
import { SectionPanel } from '@/components/layout/section-panel';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatAssetQuantity } from '@/lib/btc-quantity';
import { parsePtBrDecimal } from '@/lib/decimal-input';
import type { Asset } from '@/types/patrimony';

type QuickConverterProps = {
  asset: Asset;
  onAssetChange: (asset: Asset) => void;
  /** BRL quote of the selected asset. */
  quoteBrl: string | undefined;
};

export function QuickConverter({
  asset,
  onAssetChange,
  quoteBrl,
}: QuickConverterProps) {
  const [brl, setBrl] = useState('');

  const result = useMemo(() => {
    const amount = parsePtBrDecimal(brl);
    const quote = Number(quoteBrl ?? 0);
    if (amount == null || amount <= 0 || !(quote > 0)) return '—';
    return formatAssetQuantity(asset, String(amount / quote));
  }, [asset, brl, quoteBrl]);

  return (
    <SectionPanel title='Conversor rápido' description='Somente cálculo. Não cria movimentação.'>
      <div className='space-y-4'>
        <AssetToggle value={asset} onChange={onAssetChange} ariaLabel='Ativo do conversor' />
        <div className='space-y-2'>
          <Label htmlFor='currency-calculator'>Reais</Label>
          <Input
            id='currency-calculator'
            inputMode='decimal'
            value={brl}
            onChange={(event) => setBrl(event.target.value)}
            placeholder='1000,00'
          />
        </div>
        <div className='rounded-xl border border-border bg-black/20 p-4' aria-live='polite'>
          <p className='text-xs text-muted-foreground'>Você receberia aproximadamente</p>
          <p className='mt-1 text-xl font-semibold'>{result}</p>
        </div>
      </div>
    </SectionPanel>
  );
}
