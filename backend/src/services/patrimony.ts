import { orUnavailable } from '@/http/errors';
import { getPatrimonyHistory, savePatrimonySettings } from '@/lib/patrimony';
import { prisma } from '@/lib/prisma';

const UNAVAILABLE_MESSAGE =
  'Dados patrimoniais indisponíveis e sem cache suficiente';

type StoredSettings = {
  baseDate: Date;
  openingCashBrl: { toString(): string };
};

export function serializePatrimonySettings(settings: StoredSettings) {
  return {
    baseDate: settings.baseDate.toISOString().slice(0, 10),
    openingCashBrl: settings.openingCashBrl.toString(),
  };
}

export async function readPatrimonySettings(userId: string) {
  const settings = await prisma.patrimonySettings.findUnique({
    where: { userId },
  });
  return settings ? serializePatrimonySettings(settings) : null;
}

export async function writePatrimonySettings(
  userId: string,
  baseDate: unknown,
  openingCashBrl: unknown,
) {
  const settings = await savePatrimonySettings(
    userId,
    baseDate,
    openingCashBrl,
  );
  return serializePatrimonySettings(settings);
}

/** Erros de validação (`PatrimonyError`) viram 400; o resto, 503. */
export function patrimonySummary(userId: string) {
  return orUnavailable(UNAVAILABLE_MESSAGE, async () => {
    const result = await getPatrimonyHistory(userId);
    return {
      settings: result.settings,
      summary: result.summary,
      stale: result.stale,
    };
  });
}

export function patrimonyHistory(
  userId: string,
  from: string | undefined,
  to: string | undefined,
) {
  return orUnavailable(UNAVAILABLE_MESSAGE, () =>
    getPatrimonyHistory(userId, from, to),
  );
}
