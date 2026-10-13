import { ArrowDownToLine, ArrowUpFromLine, RefreshCw } from 'lucide-react';

import { AssetToggle } from '@/components/currencies/asset-toggle';
import type { AssetTransactionFormState } from '@/components/currencies/use-asset-transaction-form';
import { SectionPanel } from '@/components/layout/section-panel';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { CurrencyInput } from '@/components/ui/currency-input';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { AssetTransactionType } from '@/types/patrimony';

const TYPE_LABELS: Record<AssetTransactionType, string> = {
  BUY: 'Compra',
  SELL: 'Venda',
  MANUAL_ADJUSTMENT: 'Ajuste manual',
};

function quantityLabel(asset: string, unit: string) {
  if (asset !== 'BTC') return '(USD)';
  return unit === 'SATS' ? '(sats, inteiro)' : '(BTC, até 8 casas)';
}

function quantityPlaceholder(asset: string, unit: string) {
  if (asset !== 'BTC') return '100,00';
  return unit === 'SATS' ? '1.000.411' : '0,01000411';
}

export function AssetTransactionForm({
  form,
}: {
  form: AssetTransactionFormState;
}) {
  const isSats = form.asset === 'BTC' && form.btcUnit === 'SATS';
  const SubmitIcon =
    form.type === 'BUY'
      ? ArrowDownToLine
      : form.type === 'SELL'
        ? ArrowUpFromLine
        : RefreshCw;

  return (
    <div id='asset-transaction-form'>
      <SectionPanel
        title={form.editingId ? 'Editar movimentação' : 'Registrar movimentação'}
        description='O valor em BRL é sempre o total efetivamente debitado ou recebido. Taxas são informativas e não são somadas duas vezes.'
      >
        <form
          onSubmit={(event) => void form.submit(event)}
          className='grid gap-4 lg:grid-cols-2'
        >
          <div className='space-y-2'>
            <Label id='asset-toggle-label'>Ativo</Label>
            <AssetToggle
              value={form.asset}
              onChange={form.chooseAsset}
              labelledBy='asset-toggle-label'
            />
          </div>

          <div className='space-y-2'>
            <Label htmlFor='asset-type'>Tipo</Label>
            <Select
              value={form.type}
              onValueChange={(value) => form.setType(value as AssetTransactionType)}
            >
              <SelectTrigger id='asset-type' className='w-full'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(TYPE_LABELS) as AssetTransactionType[]).map(
                  (type) => (
                    <SelectItem key={type} value={type}>
                      {TYPE_LABELS[type]}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
          </div>

          <div className='space-y-2'>
            <div className='flex flex-wrap items-center justify-between gap-2'>
              <Label htmlFor='asset-quantity'>
                Quantidade {quantityLabel(form.asset, form.btcUnit)}
              </Label>
              {form.asset === 'BTC' ? (
                <div className='flex gap-1' role='group' aria-label='Unidade da quantidade'>
                  <Button
                    type='button'
                    size='sm'
                    aria-pressed={form.btcUnit === 'BTC'}
                    variant={form.btcUnit === 'BTC' ? 'default' : 'outline'}
                    onClick={() => form.switchBtcUnit('BTC')}
                  >
                    BTC
                  </Button>
                  <Button
                    type='button'
                    size='sm'
                    aria-pressed={form.btcUnit === 'SATS'}
                    variant={form.btcUnit === 'SATS' ? 'default' : 'outline'}
                    onClick={() => form.switchBtcUnit('SATS')}
                  >
                    sats
                  </Button>
                </div>
              ) : null}
            </div>
            <Input
              id='asset-quantity'
              inputMode={isSats ? 'numeric' : 'decimal'}
              value={form.quantity}
              onChange={(event) => form.setQuantity(event.target.value)}
              placeholder={quantityPlaceholder(form.asset, form.btcUnit)}
            />
            {isSats ? (
              <p className='text-xs text-muted-foreground'>
                1 sat = 0,00000001 BTC. Ex.: 1.000.411 sats = 0,01000411 BTC.
              </p>
            ) : null}
          </div>

          <div className='space-y-2'>
            <Label htmlFor='asset-cash'>Total efetivo em BRL</Label>
            <CurrencyInput
              id='asset-cash'
              value={form.cash}
              onValueChange={form.setCash}
              placeholder='500,00'
            />
          </div>
          <div className='space-y-2'>
            <Label htmlFor='asset-fee'>Taxa em BRL</Label>
            <CurrencyInput
              id='asset-fee'
              value={form.fee}
              onValueChange={form.setFee}
            />
          </div>
          <div className='space-y-2'>
            <Label htmlFor='asset-fee-percent'>Taxa em %</Label>
            <Input
              id='asset-fee-percent'
              inputMode='decimal'
              value={form.feePercent}
              onChange={(event) => form.setFeePercent(event.target.value)}
              placeholder='0,20'
            />
          </div>
          <div className='space-y-2'>
            <Label htmlFor='asset-date'>Data</Label>
            <Input
              id='asset-date'
              type='date'
              value={form.date}
              max={form.maxDate}
              onChange={(event) => form.setDate(event.target.value)}
            />
          </div>
          <div className='space-y-2'>
            <Label htmlFor='asset-note'>Observação</Label>
            <Input
              id='asset-note'
              value={form.note}
              onChange={(event) => form.setNote(event.target.value)}
              maxLength={500}
            />
          </div>

          {form.type === 'MANUAL_ADJUSTMENT' ? (
            <div className='flex items-center gap-2 text-sm lg:col-span-2'>
              <Checkbox
                id='asset-cost-basis-known'
                checked={form.costBasisKnown}
                onCheckedChange={(checked) =>
                  form.setCostBasisKnown(checked === true)
                }
              />
              <Label htmlFor='asset-cost-basis-known' className='cursor-pointer'>
                Informei também o custo real deste saldo manual
              </Label>
            </div>
          ) : null}

          <div className='flex flex-wrap gap-2 lg:col-span-2'>
            <Button type='submit' disabled={form.pending}>
              <SubmitIcon data-icon='inline-start' />
              {form.pending
                ? 'Salvando…'
                : form.editingId
                  ? 'Salvar edição'
                  : 'Registrar'}
            </Button>
            {form.editingId ? (
              <Button type='button' variant='outline' onClick={form.reset}>
                Cancelar edição
              </Button>
            ) : null}
          </div>
        </form>
      </SectionPanel>
    </div>
  );
}
