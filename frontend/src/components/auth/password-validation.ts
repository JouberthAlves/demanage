import { passwordPolicyError } from '@/lib/password-policy';

export type PasswordIssue = {
  /** Sufixo do id do campo com erro (`${idPrefix}-${field}`). */
  field: 'password' | 'confirm-password';
  message: string;
};

/** Primeiro problema do par senha/confirmação, ou null quando válido. */
export function validatePasswordPair(
  password: string,
  confirmPassword: string,
): PasswordIssue | null {
  if (password !== confirmPassword) {
    return { field: 'confirm-password', message: 'As senhas não coincidem' };
  }

  const message = passwordPolicyError(password);
  return message ? { field: 'password', message } : null;
}
