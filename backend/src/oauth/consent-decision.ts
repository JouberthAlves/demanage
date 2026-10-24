/** The user's explicit consent choice is not an authentication decision.
 * Authentication, signed CSRF, origin and interaction checks precede it.
 * Reject all malformed choices, instead of silently treating them as denial.
 */
export function parseConsentDecision(
  value: unknown,
): 'approve' | 'deny' | null {
  if (value === 'approve' || value === 'deny') return value;
  return null;
}
