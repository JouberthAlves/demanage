import { useState } from 'react';
import { toast } from 'sonner';

import { useFinancialNow } from '@/hooks/use-financial-now';
import {
  useCreateAssetTransaction,
  useUpdateAssetTransaction,
} from '@/hooks/use-patrimony';
import { getApiErrorMessage } from '@/lib/api-error';
import {
  type BtcQuantityUnit,
  btcToSats,
  convertBtcInput,
  normalizeBtcQuantity,
} from '@/lib/btc-quantity';
import { todayKey } from '@/lib/dates';
import {
  brlMaskToDecimalString,
  normalizePtBrDecimal,
  toPtBrDecimalInput,
} from '@/lib/decimal-input';
import { formatBrlInputValue } from '@/lib/format';
import type {
  Asset,
  AssetTransaction,
  AssetTransactionType,
} from '@/types/patrimony';

type Options = {
  asset: Asset;
  onAssetChange: (asset: Asset) => void;
};

export function useAssetTransactionForm({ asset, onAssetChange }: Options) {
  const now = useFinancialNow();
  const createTransaction = useCreateAssetTransaction();
  const updateTransaction = useUpdateAssetTransaction();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [type, setType] = useState<AssetTransactionType>('BUY');
  const [quantity, setQuantity] = useState('');
  const [btcUnit, setBtcUnit] = useState<BtcQuantityUnit>('BTC');
  const [cash, setCash] = useState('');
  const [fee, setFee] = useState('');
  const [feePercent, setFeePercent] = useState('');
  const [date, setDate] = useState(() => todayKey(now));
  const [note, setNote] = useState('');
  const [costBasisKnown, setCostBasisKnown] = useState(false);

  const pending = createTransaction.isPending || updateTransaction.isPending;

  function reset() {
    setEditingId(null);
    setType('BUY');
    setQuantity('');
    setBtcUnit('BTC');
    setCash('');
    setFee('');
    setFeePercent('');
    setDate(todayKey(now));
    setNote('');
    setCostBasisKnown(false);
  }

  function chooseAsset(next: Asset) {
    if (editingId) reset();
    onAssetChange(next);
  }

  function switchBtcUnit(next: BtcQuantityUnit) {
    if (next === btcUnit) return;
    setQuantity(convertBtcInput(quantity, btcUnit, next));
    setBtcUnit(next);
  }

  function startEditing(transaction: AssetTransaction) {
    onAssetChange(transaction.asset);
    setEditingId(transaction.id);
    setType(transaction.type);

    const sats =
      transaction.asset === 'BTC' && Math.abs(Number(transaction.quantity)) < 0.001
        ? btcToSats(transaction.quantity)
        : null;
    if (sats != null) {
      setBtcUnit('SATS');
      setQuantity(sats);
    } else {
      setBtcUnit('BTC');
      setQuantity(toPtBrDecimalInput(transaction.quantity));
    }

    setCash(formatMoneyInput(transaction.cashAmountBrl));
    setFee(
      Number(transaction.feeAmountBrl) === 0
        ? ''
        : formatMoneyInput(transaction.feeAmountBrl),
    );
    setFeePercent(toPtBrDecimalInput(transaction.feePercent));
    setDate(transaction.date.slice(0, 10));
    setNote(transaction.note ?? '');
    setCostBasisKnown(transaction.costBasisKnown);
    window.requestAnimationFrame(() => {
      document
        .getElementById('asset-transaction-form')
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();

    const normalizedQuantity =
      asset === 'BTC'
        ? normalizeBtcQuantity(quantity, btcUnit)
        : normalizePtBrDecimal(quantity);
    const quantityNumber = Number(normalizedQuantity);

    if (
      !normalizedQuantity ||
      quantityNumber === 0 ||
      (type !== 'MANUAL_ADJUSTMENT' && quantityNumber < 0)
    ) {
      toast.error(
        asset === 'BTC' && btcUnit === 'SATS'
          ? 'Informe uma quantidade válida de sats'
          : 'Informe uma quantidade válida',
      );
      return;
    }

    const cashAmount = brlMaskToDecimalString(cash);
    if (type !== 'MANUAL_ADJUSTMENT' && (!cashAmount || Number(cashAmount) <= 0)) {
      toast.error('Informe o valor da operação em BRL');
      return;
    }

    const feeAmount = brlMaskToDecimalString(fee);
    let normalizedFeePercent: string | undefined;
    if (feePercent.trim()) {
      const parsed = normalizePtBrDecimal(feePercent);
      if (parsed == null || Number(parsed) < 0) {
        toast.error('Informe uma taxa percentual válida');
        return;
      }
      normalizedFeePercent = parsed;
    }

    const payload = {
      type,
      quantity: normalizedQuantity,
      cashAmountBrl: cashAmount ?? '0',
      feeAmountBrl: feeAmount ?? undefined,
      feePercent: normalizedFeePercent,
      costBasisKnown,
      date,
      note: note.trim() || null,
    };
    const isEditing = Boolean(editingId);

    try {
      if (editingId) {
        await updateTransaction.mutateAsync({ id: editingId, payload });
      } else {
        await createTransaction.mutateAsync({ asset, payload });
      }
      reset();
      toast.success(
        isEditing ? 'Movimentação atualizada' : 'Movimentação registrada',
      );
    } catch (error) {
      toast.error(
        getApiErrorMessage(
          error,
          isEditing
            ? 'Não foi possível atualizar'
            : 'Não foi possível registrar',
        ),
      );
    }
  }

  return {
    asset,
    maxDate: todayKey(now),
    editingId,
    type,
    setType,
    quantity,
    setQuantity,
    btcUnit,
    cash,
    setCash,
    fee,
    setFee,
    feePercent,
    setFeePercent,
    date,
    setDate,
    note,
    setNote,
    costBasisKnown,
    setCostBasisKnown,
    pending,
    reset,
    chooseAsset,
    switchBtcUnit,
    startEditing,
    submit,
  };
}

export type AssetTransactionFormState = ReturnType<
  typeof useAssetTransactionForm
>;

function formatMoneyInput(raw: string) {
  return formatBrlInputValue(Number(raw));
}
