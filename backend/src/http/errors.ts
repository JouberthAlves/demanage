import type { ErrorRequestHandler, RequestHandler } from 'express';

import { Prisma } from '@/generated/prisma/client';
import { AssetValidationError } from '@/lib/assets';
import {
  CodedError,
  DomainError,
  InvalidCustomTagError,
  PiggyError,
  ScheduleValidationError,
} from '@/lib/errors';
import { ExpenseSplitError } from '@/lib/expense-splits';
import { ExternalJsonTooLargeError } from '@/lib/external-json';
import { MarketDataError } from '@/lib/market-data';
import { PatrimonyError } from '@/lib/patrimony';

/**
 * Erro com semântica HTTP. Qualquer handler/serviço pode lançá-lo; o middleware
 * de erro único (`errorHandler`) converte em `{ error, code? }`.
 */
export class AppError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(
    status: number,
    message: string,
    code?: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
  }
}

export const badRequest = (message: string, code?: string) =>
  new AppError(400, message, code);
export const unauthorized = (message = 'Não autenticado', code?: string) =>
  new AppError(401, message, code);
export const forbidden = (message: string, code?: string) =>
  new AppError(403, message, code);
export const notFound = (message: string, code?: string) =>
  new AppError(404, message, code);
export const conflict = (message: string, code?: string) =>
  new AppError(409, message, code);
export const serviceUnavailable = (
  message: string,
  options?: { code?: string; cause?: unknown },
) => new AppError(503, message, options?.code, { cause: options?.cause });

export type HttpErrorBody = { error: string; code?: string };
export type ResolvedHttpError = { status: number; body: HttpErrorBody };

export const INTERNAL_ERROR_MESSAGE = 'Internal server error';

/** `true` quando `err` é um erro do Prisma com o `code` informado (ex.: P2002). */
export function isPrismaError(err: unknown, code: string): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === code
  );
}

/** Violação de unique constraint (P2002). */
export const isUniqueViolation = (err: unknown) => isPrismaError(err, 'P2002');

type HttpLikeError = { status?: unknown; statusCode?: unknown; type?: unknown };

function httpStatusOf(err: object): number | null {
  const { status, statusCode } = err as HttpLikeError;
  const value = typeof status === 'number' ? status : statusCode;
  return typeof value === 'number' && value >= 400 && value <= 599
    ? value
    : null;
}

/** Respostas HTTP para os códigos de `PiggyError` (a lib identifica por classe + code). */
const PIGGY_ERROR_RESPONSES: Record<string, ResolvedHttpError> = {
  NOT_FOUND: { status: 404, body: { error: 'Cofre não encontrado' } },
  ARCHIVED: { status: 400, body: { error: 'Cofre arquivado' } },
  ALREADY_COMPLETE: { status: 400, body: { error: 'Meta já atingida' } },
  INSUFFICIENT_BALANCE: {
    status: 400,
    body: { error: 'Saldo insuficiente no cofre' },
  },
  INVALID_TARGET_DATE: {
    status: 400,
    body: { error: 'Data de conclusão inválida' },
  },
  PAST_TARGET_DATE: {
    status: 400,
    body: { error: 'Data de conclusão inválida' },
  },
};

/** Erros do body-parser / http-errors (`err.status` + `err.type`). */
function resolveBodyParserError(err: object): ResolvedHttpError | null {
  const status = httpStatusOf(err);
  if (status == null || status >= 500) return null;
  const type = (err as HttpLikeError).type;

  switch (type) {
    case 'entity.parse.failed':
      return { status: 400, body: { error: 'JSON inválido' } };
    case 'entity.too.large':
      return {
        status: 413,
        body: { error: 'Corpo da requisição excede o limite permitido' },
      };
    case 'encoding.unsupported':
    case 'charset.unsupported':
      return { status: 415, body: { error: 'Codificação não suportada' } };
    default:
      return typeof type === 'string'
        ? { status, body: { error: 'Requisição inválida' } }
        : null;
  }
}

/**
 * Mapeamento de erros conhecidos para HTTP. Retorna `null` quando o erro não é
 * conhecido (será tratado como 500). Mapeia por **classe**, nunca por mensagem.
 */
export function resolveKnownError(err: unknown): ResolvedHttpError | null {
  if (err instanceof AppError) {
    return {
      status: err.status,
      body: {
        error: err.message,
        ...(err.code ? { code: err.code } : {}),
      },
    };
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      return { status: 409, body: { error: 'Registro duplicado' } };
    }
    if (err.code === 'P2025') {
      return { status: 404, body: { error: 'Registro não encontrado' } };
    }
    return null;
  }

  if (
    err instanceof ExpenseSplitError ||
    err instanceof AssetValidationError ||
    err instanceof PatrimonyError
  ) {
    return { status: 400, body: { error: err.message } };
  }

  if (err instanceof PiggyError) {
    return PIGGY_ERROR_RESPONSES[err.code] ?? null;
  }

  if (err instanceof InvalidCustomTagError) {
    return { status: 400, body: { error: 'Tipo personalizado inválido' } };
  }

  if (err instanceof ScheduleValidationError) {
    return { status: 400, body: { error: 'Agenda inválida' } };
  }

  if (err instanceof MarketDataError) {
    return { status: 503, body: { error: err.message } };
  }

  if (err instanceof ExternalJsonTooLargeError) {
    return {
      status: 503,
      body: { error: 'Provedor de dados indisponível' },
    };
  }

  // Demais erros de domínio da lib: mensagem em pt-BR própria. `CodedError`
  // carrega só um código como mensagem e nunca deve vazar para o cliente.
  if (err instanceof DomainError && !(err instanceof CodedError)) {
    return { status: 400, body: { error: err.message } };
  }

  if (typeof err === 'object' && err !== null) {
    return resolveBodyParserError(err);
  }

  return null;
}

export function resolveHttpError(err: unknown): ResolvedHttpError {
  return (
    resolveKnownError(err) ?? {
      status: 500,
      body: { error: INTERNAL_ERROR_MESSAGE },
    }
  );
}

/**
 * Executa `operation` convertendo falhas **inesperadas** (rede, provedor, cache)
 * em 503 com `message`. Erros de domínio/validação conhecidos passam intactos
 * para serem mapeados normalmente (ex.: 400 de validação).
 */
export async function orUnavailable<T>(
  message: string,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (resolveKnownError(error)) throw error;
    throw serviceUnavailable(message, { cause: error });
  }
}

/** Middleware final de rotas inexistentes. */
export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(notFound('Rota não encontrada'));
};

/** Único middleware de erro da aplicação. */
export const errorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }

  const { status, body } = resolveHttpError(err);
  if (status >= 500) {
    console.error(err instanceof AppError && err.cause ? err.cause : err);
  }
  res.status(status).json(body);
};
