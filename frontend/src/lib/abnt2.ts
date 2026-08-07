/**
 * Caracteres tipáveis no teclado brasileiro ABNT2
 * (letras latinas + acentos, números e símbolos comuns).
 * Bloqueia emoji, ideogramas e outros alfabetos.
 */
const ABNT2_DISALLOWED =
  /[^A-Za-z0-9À-ÖØ-öø-ÿ\s!@#$%¨&*()_+=\-´`[\]{}~^?;:.,/\\|'"<>°ºª§¢£¬]/g;

export function sanitizeAbnt2(value: string) {
  return value.replace(ABNT2_DISALLOWED, '');
}

export function isAbnt2Text(value: string) {
  return value === sanitizeAbnt2(value);
}
