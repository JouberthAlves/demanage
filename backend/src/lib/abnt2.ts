/**
 * Caracteres tipáveis no teclado brasileiro ABNT2
 * (letras latinas + acentos, números e símbolos comuns).
 */
const ABNT2_DISALLOWED =
  /[^A-Za-z0-9À-ÖØ-öø-ÿ\s!@#$%¨&*()_+=\-´`[\]{}~^?;:.,/\\|'"<>°ºª§¢£¬]/g;

export function sanitizeAbnt2(value: string) {
  return value.replace(ABNT2_DISALLOWED, '');
}

export function isAbnt2Text(value: string) {
  return value === sanitizeAbnt2(value);
}

export function parseAbnt2Text(
  value: unknown,
  options?: { maxLength?: number; required?: boolean },
): string | null {
  if (typeof value !== 'string') return null;
  let text = sanitizeAbnt2(value).trim();
  if (options?.maxLength != null) {
    text = text.slice(0, options.maxLength);
  }
  if (options?.required && !text) return null;
  return text;
}
