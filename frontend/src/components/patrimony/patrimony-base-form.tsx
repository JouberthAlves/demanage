import { useState } from 'react';
import { toast } from 'sonner';

import { SectionPanel } from '@/components/layout/section-panel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useFinancialNow } from '@/hooks/use-financial-now';
import { useSavePatrimonySettings } from '@/hooks/use-patrimony';
import { getApiErrorMessage } from '@/lib/api-error';
import { todayKey } from '@/lib/dates';
import { normalizePtBrDecimal, toPtBrDecimalInput } from '@/lib/decimal-input';
import { formatCurrency } from '@/lib/format';
import type { PatrimonySettings } from '@/types/patrimony';

type PatrimonyBaseFormProps = {
  /** Saved settings when editing; null for the first-time setup. */
  settings: PatrimonySettings | null;
  /** Current balance suggested by the dashboard. */
  suggestedBalance: number;
  onSaved: () => void;
  onCancel?: () => void;
};

/**
 * Mount this fresh each time the form opens: the fields are seeded by state
 * initialisers only, so background refetches never overwrite what the user
 * is typing.
 */
export function PatrimonyBaseForm({
  settings,
  suggestedBalance,
  onSaved,
  onCancel,
}: PatrimonyBaseFormProps) {
  const now = useFinancialNow();
  const saveSettings = useSavePatrimonySettings();
  const [baseDate, setBaseDate] = useState(
    () => settings?.baseDate ?? todayKey(now),
  );
  const [openingCash, setOpeningCash] = useState(() =>
    settings
      ? toPtBrDecimalInput(settings.openingCashBrl)
      : toPtBrDecimalInput(suggestedBalance.toFixed(2)),
  );

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const cash = normalizePtBrDecimal(openingCash);
    if (cash == null) {
      toast.error('Informe um saldo válido em reais');
      return;
    }
    if (!baseDate) {
      toast.error('Informe a data-base');
      return;
    }
    try {
      await saveSettings.mutateAsync({ baseDate, openingCashBrl: cash });
      toast.success('Base patrimonial salva');
      onSaved();
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Não foi possível salvar'));
    }
  }

  return (
    <SectionPanel
      title={settings ? 'Editar base patrimonial' : 'Configuração inicial'}
      description={`Sugestão do Dashboard atual: ${formatCurrency(suggestedBalance)}. Você pode corrigir esse valor antes de salvar.`}
    >
      <form onSubmit={(event) => void submit(event)} className='grid gap-4 sm:grid-cols-2'>
        <div className='space-y-2'>
          <Label htmlFor='patrimony-base-date'>Data-base</Label>
          <Input
            id='patrimony-base-date'
            type='date'
            max={todayKey(now)}
            value={baseDate}
            onChange={(event) => setBaseDate(event.target.value)}
          />
        </div>
        <div className='space-y-2'>
          <Label htmlFor='patrimony-opening-cash'>Saldo em reais na data-base</Label>
          <Input
            id='patrimony-opening-cash'
            inputMode='decimal'
            value={openingCash}
            onChange={(event) => setOpeningCash(event.target.value)}
            placeholder='0,00'
          />
        </div>
        <div className='flex flex-wrap gap-2 sm:col-span-2'>
          <Button type='submit' disabled={saveSettings.isPending}>
            {saveSettings.isPending ? 'Salvando…' : 'Salvar base'}
          </Button>
          <Button
            type='button'
            variant='outline'
            onClick={() =>
              setOpeningCash(toPtBrDecimalInput(suggestedBalance.toFixed(2)))
            }
          >
            Usar saldo do Dashboard
          </Button>
          {onCancel ? (
            <Button type='button' variant='ghost' onClick={onCancel}>
              Cancelar
            </Button>
          ) : null}
        </div>
      </form>
    </SectionPanel>
  );
}
