import { badRequest, conflict, notFound } from '@/http/errors';
import { getRecentFinanceOperations, undoFinanceOperation } from '@/services/finance-operation-store';
import { getMcpIntentSecret } from '@/utils/var';

import { createSignedFinanceIntent, type FinanceIntentIdentity, verifySignedFinanceIntent } from './finance-intent';

/** Purely read-only preview; execution repeats all dependency checks under lock. */
export async function previewUndoFinanceOperation(
  identity: FinanceIntentIdentity,
  originalKey: string,
) {
  const operation = (await getRecentFinanceOperations(identity.userId, identity.clientId))
    .find((row) => row.idempotencyKey === originalKey);
  if (!operation) throw notFound('Operação não encontrada entre as 20 operações recentes deste aplicativo');
  if (operation.status === 'undone') throw conflict('Operação já desfeita');
  const action = {
    kind: 'undo_mcp_operation',
    operationId: operation.operationId,
    originalKey,
  };
  return {
    status: 'ready',
    operation: {
      kind: operation.kind,
      amountBrl: operation.amountBrl,
      committedAt: operation.committedAt,
      originalKey,
    },
    warning: 'O desfazer remove apenas lançamentos feitos por esta operação do MCP; se houver alterações dependentes posteriores, será recusado. Tags compartilhadas permanecem.',
    undoIntentToken: createSignedFinanceIntent(identity, action, getMcpIntentSecret()).token,
  };
}

export async function commitUndoFinanceOperation(identity: FinanceIntentIdentity, undoIntentToken: string) {
  const { action, nonce } = verifySignedFinanceIntent(undoIntentToken, identity, getMcpIntentSecret());
  if (
    Object.keys(action).sort().join(',') !== 'kind,operationId,originalKey' ||
    action.kind !== 'undo_mcp_operation' ||
    typeof action.operationId !== 'string' || action.operationId.length > 256 ||
    typeof action.originalKey !== 'string' || action.originalKey.length > 200
  ) throw badRequest('Intent de desfazer inválido');
  return undoFinanceOperation({
    ...identity, operationId: action.operationId,
    originalKey: action.originalKey, intentNonce: nonce,
  });
}
