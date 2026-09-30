export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_BYTES = 72;

export function passwordPolicyError(password: string) {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `A senha deve ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres`;
  }
  if (new TextEncoder().encode(password).byteLength > MAX_PASSWORD_BYTES) {
    return `A senha deve ter no máximo ${MAX_PASSWORD_BYTES} bytes em UTF-8`;
  }
  return null;
}
