import { DomainError } from '@/lib/errors';

export const MAX_EXTERNAL_JSON_BYTES = 1024 * 1024;

export class ExternalJsonTooLargeError extends DomainError {
  constructor() {
    super('Resposta do provider excede o limite permitido', 'EXTERNAL_JSON_TOO_LARGE');
  }
}

export async function readBoundedJson<T>(
  response: Response,
  maxBytes = MAX_EXTERNAL_JSON_BYTES,
): Promise<T> {
  const contentLength = response.headers.get('content-length');
  if (/^\d+$/.test(contentLength ?? '') && Number(contentLength) > maxBytes) {
    await response.body?.cancel();
    throw new ExternalJsonTooLargeError();
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('Resposta do provider sem corpo');

  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > maxBytes) {
        await reader.cancel();
        throw new ExternalJsonTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as T;
}
