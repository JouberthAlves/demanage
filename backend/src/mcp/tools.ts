import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

import { Prisma } from '@/generated/prisma/client';
import { signedAmount } from '@/lib/piggy/ledger';
import { prisma } from '@/lib/prisma';
import { listCustomTags } from '@/services/custom-tags';
import {
  commitFinanceOperation,
  digestFinanceAction,
  getCommittedOperation,
  getRecentFinanceOperations,
} from '@/services/finance-operation-store';

import type { McpIdentity } from './auth';
import { previewFinanceOperation, verifyIntentWithNonce } from './finance-preview';
import { commitUndoFinanceOperation, previewUndoFinanceOperation } from './finance-undo';
import { getFinancialOverview } from './financial-overview';

const READ_ONLY_ANNOTATIONS = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const FINANCIAL_WRITE_ANNOTATIONS = { readOnlyHint: false, destructiveHint: true, openWorldHint: false };

function response(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value) }] };
}

function failure(message: string) {
  return { isError: true, content: [{ type: 'text' as const, text: message }] };
}

function readableError(error: unknown): string {
  if (error instanceof Error && ('statusCode' in error || ('status' in error &&
    typeof error.status === 'number' && error.status >= 400 && error.status < 500))) return error.message;
  return 'Não foi possível concluir a operação. Nenhum sucesso financeiro foi confirmado.';
}

/** Page bank metadata first, then ask PostgreSQL to sum only this page's ledger. */
export async function readPiggyBankPage(userId: string, limit = 50, cursor?: string) {
  if (cursor && !(await prisma.piggyBank.findFirst({
    where: { id: cursor, userId, archivedAt: null }, select: { id: true },
  }))) throw new Error('Cursor de cofrinho inválido');
  const rows = await prisma.piggyBank.findMany({
    where: { userId, archivedAt: null },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: { id: true, name: true, goalAmount: true, completedAt: true },
  });
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const grouped = page.length ? await prisma.piggyTransaction.groupBy({
    by: ['piggyBankId', 'type'],
    where: { userId, piggyBankId: { in: page.map(({ id }) => id) } },
    _sum: { amount: true },
  }) : [];
  const balances = new Map(page.map(({ id }) => [id, new Prisma.Decimal(0)]));
  for (const group of grouped) {
    balances.set(group.piggyBankId, balances.get(group.piggyBankId)!
      .plus(signedAmount(group.type, group._sum.amount ?? 0)));
  }
  return {
    banks: page.map((bank) => ({
      id: bank.id,
      name: bank.name,
      balanceBrl: balances.get(bank.id)!.toFixed(2),
      goalBrl: bank.goalAmount?.toFixed(2) ?? null,
      completed: bank.completedAt !== null,
    })),
    nextCursor: hasMore ? page[page.length - 1]!.id : null,
  };
}

/** Each MCP request gets its own verified identity. Tool arguments never include a userId. */
export function registerFinanceTools(server: McpServer, identity: McpIdentity) {
  const canRead = identity.scopes.has('finance:read');
  const canWrite = identity.scopes.has('finance:write');

  server.registerTool(
    'get_financial_overview',
    {
      description: 'Consultar saldo do mês até hoje: pagamentos e recebimentos registrados pela data efetiva, mais recorrências vencidas sem baixa; patrimônio opcional, que pode vir indisponível para históricos muito grandes. Não é saldo bancário absoluto.',
      annotations: { ...READ_ONLY_ANNOTATIONS, openWorldHint: true },
      inputSchema: {},
    },
    async () => {
      if (!canRead) return failure('Sem permissão finance:read.');
      try {
        return response(await getFinancialOverview(identity.userId));
      } catch {
        return failure('Resumo financeiro indisponível: não foi possível ler todas as movimentações. Não presuma saldo zero.');
      }
    },
  );

  server.registerTool(
    'list_piggy_banks',
    {
      description: 'Listar seus cofrinhos, nomes, IDs, saldos e metas em páginas de até 100. Continue com nextCursor até null. Use o ID exato para operações; não escolha cofrinhos ambíguos.',
      annotations: READ_ONLY_ANNOTATIONS,
      // Historical rows may carry pre-UUID CUIDs; only DB user ownership validates cursors.
      inputSchema: { cursor: z.string().min(1).max(191).optional(), limit: z.number().int().min(1).max(100).default(50) },
    },
    async ({ cursor, limit }) => {
      if (!canRead) return failure('Sem permissão finance:read.');
      try {
        return response(await readPiggyBankPage(identity.userId, limit, cursor));
      } catch (error) {
        return failure(readableError(error));
      }
    },
  );

  server.registerTool(
    'list_income_tags',
    {
      description: 'Listar tags de entradas da sua conta. Distingua tag (categoria) de descrição livre. Quando clara, a tag pode ser criada durante uma nova entrada.',
      annotations: READ_ONLY_ANNOTATIONS,
      inputSchema: {},
    },
    async () => {
      if (!canRead) return failure('Sem permissão finance:read.');
      try {
        const tags = await listCustomTags(identity.userId, 'income');
        return response(tags.map(({ id, name, color }) => ({ id, name, color })));
      } catch (error) {
        return failure(readableError(error));
      }
    },
  );

  server.registerTool(
    'preview_financial_operation',
    {
      description: 'Validar uma intenção financeira sem lançar valores. Envie draft estruturado: kind receive_income, receive_and_save ou deposit_existing_cash, amountCents (centavos), dateKey YYYY-MM-DD, descrição e tag (distintas), e bankName/bankId quando cabível. Sempre pergunte ao usuário se houver dupla interpretação, incluindo a origem do dinheiro e se deve descontar do saldo. Nunca execute com clarification_required.',
      annotations: READ_ONLY_ANNOTATIONS,
      inputSchema: { draft: z.record(z.string(), z.unknown()) },
    },
    async ({ draft }) => {
      if (!canRead || !canWrite) return failure('Prévia de alteração requer finance:read e finance:write.');
      try {
        return response(await previewFinanceOperation(identity, draft));
      } catch (error) {
        return failure(readableError(error));
      }
    },
  );

  server.registerTool(
    'execute_financial_operation',
    {
      description: 'EXECUTAR UMA VEZ a operação previamente validada e assinada. Exige intentToken retornado pela prévia e idempotencyKey UUID estável. Se houver timeout, consulte get_operation_status e reutilize a MESMA chave; nunca crie outra chave para repetir o lançamento. Apenas confirme sucesso quando status committed.',
      annotations: { ...FINANCIAL_WRITE_ANNOTATIONS, openWorldHint: true },
      inputSchema: { intentToken: z.string().min(20).max(8192), idempotencyKey: z.string().uuid() },
    },
    async ({ intentToken, idempotencyKey }) => {
      if (!canWrite || !canRead) return failure('Execução requer finance:read e finance:write.');
      try {
        const { action, nonce } = verifyIntentWithNonce(intentToken, identity);
        const { result, replayed } = await commitFinanceOperation({
          userId: identity.userId,
          clientId: identity.clientId,
          idempotencyKey,
          intentNonce: nonce,
          payloadDigest: digestFinanceAction(action),
          action,
          oauthGrantId: identity.oauthGrantId,
        });
        return response({ status: 'committed', replayed, idempotencyKey, ...result });
      } catch (error) {
        return failure(readableError(error));
      }
    },
  );

  server.registerTool(
    'get_operation_status',
    {
      description: 'Consultar se uma operação financeira com a chave original foi confirmada. Resultado ausente NÃO significa que se pode repetir com uma nova chave; use a mesma.',
      annotations: READ_ONLY_ANNOTATIONS,
      inputSchema: { idempotencyKey: z.string().uuid() },
    },
    async ({ idempotencyKey }) => {
      if (!canWrite) return failure('Sem permissão finance:write.');
      try {
        const committed = await getCommittedOperation(identity.userId, identity.clientId, idempotencyKey);
        return response(committed ?? { status: 'not_found' });
      } catch (error) {
        return failure(readableError(error));
      }
    },
  );

  server.registerTool(
    'list_financial_operation_history',
    {
      description: 'Listar até 20 operações financeiras recentes que ESTE aplicativo MCP executou, inclusive as desfeitas. Use a chave original antes de solicitar undo. Nunca inclui lançamentos feitos manualmente no deManage.',
      annotations: READ_ONLY_ANNOTATIONS,
      inputSchema: {},
    },
    async () => {
      if (!canRead) return failure('Sem permissão finance:read.');
      try {
        return response(await getRecentFinanceOperations(identity.userId, identity.clientId));
      } catch (error) {
        return failure(readableError(error));
      }
    },
  );

  server.registerTool(
    'preview_undo_financial_operation',
    {
      description: 'Preparar SEM ALTERAR DADOS o desfazer de uma operação do histórico deste aplicativo MCP. Exige chave original. Mostre o resumo e obtenha confirmação explícita do usuário antes de executar.',
      annotations: READ_ONLY_ANNOTATIONS,
      inputSchema: { idempotencyKey: z.string().uuid() },
    },
    async ({ idempotencyKey }) => {
      if (!canRead || !canWrite) return failure('Desfazer exige finance:read e finance:write.');
      try {
        return response(await previewUndoFinanceOperation(identity, idempotencyKey));
      } catch (error) {
        return failure(readableError(error));
      }
    },
  );

  server.registerTool(
    'undo_financial_operation',
    {
      description: 'Desfazer de modo atômico UMA operação criada pelo mesmo cliente MCP, previamente revisada e confirmada pelo usuário. Exige undoIntentToken da prévia. Não altera outras operações, não pode apagar lançamentos manuais e falha se houver dependências posteriores. Em caso de timeout consulte get_operation_status.',
      annotations: FINANCIAL_WRITE_ANNOTATIONS,
      inputSchema: { undoIntentToken: z.string().min(20).max(8192) },
    },
    async ({ undoIntentToken }) => {
      if (!canRead || !canWrite) return failure('Desfazer exige finance:read e finance:write.');
      try {
        return response(await commitUndoFinanceOperation(identity, undoIntentToken));
      } catch (error) {
        return failure(readableError(error));
      }
    },
  );
}
