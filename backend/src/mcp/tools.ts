import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

import { getPatrimonyHistory } from '@/lib/patrimony';
import { balanceDecimalFromTransactions } from '@/lib/piggy/ledger';
import { listCustomTags } from '@/services/custom-tags';
import {
  commitFinanceOperation,
  digestFinanceAction,
  getCommittedOperation,
} from '@/services/finance-operation-store';
import { listPiggyBanks } from '@/services/piggy-banks';

import type { McpIdentity } from './auth';
import { previewFinanceOperation, verifyIntentWithNonce } from './finance-preview';

function response(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value) }] };
}

function failure(message: string) {
  return { isError: true, content: [{ type: 'text' as const, text: message }] };
}

function readableError(error: unknown): string {
  if (error instanceof Error && 'statusCode' in error) return error.message;
  return 'Não foi possível concluir a operação. Nenhum sucesso financeiro foi confirmado.';
}

/** Each MCP request gets its own verified identity. Tool arguments never include a userId. */
export function registerFinanceTools(server: McpServer, identity: McpIdentity) {
  const canRead = identity.scopes.has('finance:read');
  const canWrite = identity.scopes.has('finance:write');

  server.registerTool(
    'get_financial_overview',
    {
      description: 'Consultar saldo e patrimônio reais da sua conta deManage, quando configurados. Nunca presumir saldo zero se os dados estiverem indisponíveis.',
      inputSchema: {},
    },
    async () => {
      if (!canRead) return failure('Sem permissão finance:read.');
      try {
        const { summary, stale } = await getPatrimonyHistory(identity.userId);
        return response({ summary, stale });
      } catch {
        return failure('Resumo patrimonial indisponível ou ainda não configurado; consulte os registros individualmente.');
      }
    },
  );

  server.registerTool(
    'list_piggy_banks',
    {
      description: 'Listar seus cofrinhos, nomes, IDs, saldos e metas. Use o ID exato para operações. Não escolha entre cofrinhos ambíguos.',
      inputSchema: {},
    },
    async () => {
      if (!canRead) return failure('Sem permissão finance:read.');
      try {
        const banks = await listPiggyBanks(identity.userId, false);
        return response(banks.map((bank) => ({
          id: bank.id,
          name: bank.name,
          balanceBrl: balanceDecimalFromTransactions(bank.transactions).toFixed(2),
          goalBrl: bank.goalAmount?.toFixed(2) ?? null,
          completed: bank.completedAt !== null,
        })));
      } catch (error) {
        return failure(readableError(error));
      }
    },
  );

  server.registerTool(
    'list_income_tags',
    {
      description: 'Listar tags de entradas da sua conta. Distingua tag (categoria) de descrição livre. Quando clara, a tag pode ser criada durante uma nova entrada.',
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
}
