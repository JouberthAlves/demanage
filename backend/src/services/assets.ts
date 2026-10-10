import type { Asset, AssetTransaction } from '@/generated/prisma/client';
import { badRequest, notFound, orUnavailable } from '@/http/errors';
import { parseBoolean, parseOptionalNote } from '@/http/request';
import {
  assetSummary,
  createAssetTransaction,
  type CreateAssetTransactionInput,
  deleteAssetTransaction,
  updateAssetTransaction,
  type UpdateAssetTransactionInput,
} from '@/lib/assets';
import { prisma } from '@/lib/prisma';

export { serializeAssetTransaction } from '@/lib/assets';

const TRANSACTION_TYPES = ['BUY', 'SELL', 'MANUAL_ADJUSTMENT'] as const;
export type AssetTransactionKind = (typeof TRANSACTION_TYPES)[number];

const NOT_FOUND_MESSAGE = 'Movimentação não encontrada';
const INVALID_TYPE_MESSAGE = 'Tipo de movimentação inválido';

function isTransactionKind(value: unknown): value is AssetTransactionKind {
  return (TRANSACTION_TYPES as readonly unknown[]).includes(value);
}

/** Campos monetários/quantidade seguem crus: a validação decimal é da lib. */
type RawTransactionFields = Omit<UpdateAssetTransactionInput, 'type' | 'note'>;

function rawFieldsOf(body: Record<string, unknown>): RawTransactionFields {
  return {
    quantity: body.quantity,
    cashAmountBrl: body.cashAmountBrl,
    feeAmountBrl: body.feeAmountBrl,
    feePercent: body.feePercent,
    costBasisKnown: parseBoolean(body.costBasisKnown, 'costBasisKnown'),
    date: body.date,
  };
}

export function parseCreateAssetTransaction(
  body: Record<string, unknown>,
): Omit<CreateAssetTransactionInput, 'userId' | 'asset'> {
  if (!isTransactionKind(body.type)) throw badRequest(INVALID_TYPE_MESSAGE);
  return {
    type: body.type,
    ...rawFieldsOf(body),
    note: parseOptionalNote(body.note),
  };
}

/** PATCH parcial: `type` é opcional e os demais campos vêm da linha armazenada. */
export type AssetTransactionPatch = {
  type?: AssetTransactionKind;
  fields: Partial<RawTransactionFields>;
  note?: string | null;
};

export function parseAssetTransactionPatch(
  body: Record<string, unknown>,
): AssetTransactionPatch {
  if (body.type !== undefined && !isTransactionKind(body.type)) {
    throw badRequest(INVALID_TYPE_MESSAGE);
  }

  const fields: Partial<RawTransactionFields> = {};
  for (const [key, value] of Object.entries(rawFieldsOf(body))) {
    if (value !== undefined) {
      (fields as Record<string, unknown>)[key] = value;
    }
  }
  return {
    type: body.type,
    fields,
    note: body.note === undefined ? undefined : parseOptionalNote(body.note),
  };
}

/**
 * Mescla o patch com a linha armazenada, produzindo a entrada completa que a
 * lib valida. A taxa em R$ é recalculada pelo percentual quando o valor
 * efetivo ou o percentual mudam sem uma taxa explícita.
 */
export function mergeAssetTransactionPatch(
  stored: AssetTransaction,
  patch: AssetTransactionPatch,
): UpdateAssetTransactionInput {
  const { fields } = patch;
  const feePercent =
    fields.feePercent !== undefined
      ? fields.feePercent
      : (stored.feePercent?.toString() ?? null);
  const recalcFee =
    fields.feeAmountBrl === undefined &&
    feePercent != null &&
    feePercent !== '' &&
    (fields.feePercent !== undefined || fields.cashAmountBrl !== undefined);

  return {
    type: patch.type ?? stored.type,
    quantity:
      fields.quantity !== undefined
        ? fields.quantity
        : stored.quantity.toString(),
    cashAmountBrl:
      fields.cashAmountBrl !== undefined
        ? fields.cashAmountBrl
        : stored.cashAmountBrl.toString(),
    feeAmountBrl: recalcFee
      ? 0
      : fields.feeAmountBrl !== undefined
        ? fields.feeAmountBrl
        : stored.feeAmountBrl.toString(),
    feePercent,
    costBasisKnown:
      fields.costBasisKnown !== undefined
        ? fields.costBasisKnown
        : stored.costBasisKnown,
    date: fields.date !== undefined ? fields.date : stored.date.toISOString(),
    note: patch.note !== undefined ? patch.note : stored.note,
  };
}

export async function getAssetSummaries(userId: string) {
  return orUnavailable(
    'Não foi possível obter as cotações e não há cache suficiente',
    async () => {
      const [btc, usd] = await Promise.all([
        assetSummary(userId, 'BTC'),
        assetSummary(userId, 'USD'),
      ]);
      return { BTC: btc, USD: usd };
    },
  );
}

export function getAssetSummary(userId: string, asset: Asset) {
  return orUnavailable('Cotação indisponível e sem cache', () =>
    assetSummary(userId, asset),
  );
}

export function listAssetTransactions(userId: string, asset: Asset) {
  return prisma.assetTransaction.findMany({
    where: { userId, asset },
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
  });
}

export function createTransaction(
  userId: string,
  asset: Asset,
  input: Omit<CreateAssetTransactionInput, 'userId' | 'asset'>,
) {
  return createAssetTransaction({ userId, asset, ...input });
}

async function findOwnedTransaction(userId: string, id: string) {
  const stored = await prisma.assetTransaction.findFirst({
    where: { id, userId },
  });
  if (!stored) throw notFound(NOT_FOUND_MESSAGE);
  return stored;
}

export async function patchTransaction(
  userId: string,
  id: string,
  patch: AssetTransactionPatch,
) {
  const stored = await findOwnedTransaction(userId, id);
  return updateAssetTransaction(
    userId,
    id,
    mergeAssetTransactionPatch(stored, patch),
  );
}

export async function removeTransaction(userId: string, id: string) {
  await findOwnedTransaction(userId, id);
  await deleteAssetTransaction(userId, id);
}
