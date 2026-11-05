# Verified trusted-device login after identifier lockout

Issue #122. This is a deliberately scoped alternative to email delivery, which
does not exist or have verified enrollment in this repository. Do not treat
the account email, guessed password, or arbitrary browser as possession proof.

## Contract and custody

- Enrollment requires a **valid cookie-authenticated session and fresh current
  password**, separately bounded to five failed proofs per 15-minute window
  across IPs using the locked PostgreSQL `User` row. A maximum of five active
  enrolled devices per account is enforced under the same lock.
- A 256-bit random device secret is sent only as an HttpOnly cookie. Production
  uses `__Host-`, `Secure`, `Path=/`, no `Domain`, and the existing deployment's
  SameSite setting. PostgreSQL stores only a domain-separated HMAC, UUID and
  metadata; no cookie token, recovery code or password is returned to JavaScript.
- The device grant expires within 30 days, can be explicitly revoked in Profile
  after fresh-password proof, and survives **ordinary logout** so it is useful
  for subsequent login. Logout still revokes existing sessions. A **password
  recovery** rotates both session and device epochs, revokes all trusted device
  records and OAuth grants atomically. Old sessions and devices remain invalid.
- The challenge POST enforces Origin/Referer **even without a JWT cookie**.
  It returns the same shape for unknown, invalid, revoked and valid devices,
  with a random UUID and nonce. A database challenge is created only for a
  correctly held device. The one-time nonce expires in three minutes, is stored
  as a keyed HMAC, and is bound to its specific device. A per-device PostgreSQL
  row lock limits active challenges to three, with only device-local cleanup.
- The alternate login requires matching cookie, unexpired unused challenge,
  matching identity **and the correct account password**. A challenge is
  consumed atomically before password verification, including failed guesses.
  The device row lock serializes five failed password attempts per 15 minutes
  across IP addresses; subsequent attempts, including correct passwords, are
  HTTP 429 until expiration. The existing 10/15-minute email-HMAC limiter on
  `/auth/login` is unmodified; both endpoints retain independent IP limits.
- Cache-Control is `private, no-store` for all trusted-device endpoints. A
  full browser session, signed JWT and financial authorization are issued only
  after both possession and correct password. The device secret **never** grants
  authentication alone.

## Bounds and limitations

This offers a meaningful escape from a *publicly induced email lockout only on
devices that were voluntarily enrolled while the owner was authenticated*.
New browsers, private sessions, deleted cookies, expired/revoked devices and
users who did not enroll still must wait out the account failed-login window
or use their existing high-entropy offline recovery code. Email delivery is
intentionally **not simulated** and is not a recovery channel. Theft of the
device cookie constitutes theft of a possession factor (the password is still
needed), and an attacker holding the cookie can exhaust that device's own
five-failure budget; use explicit revocation and password recovery if needed.

## Verification

The PG18 HTTP adversarial suite `backend/src/lib/trusted-device-login.itest.ts`
covers the original 10 distributed-email failures, successful authenticated
trusted-device fallback, nonce replay/expiry, strict CSRF after logout, absent
device and unknown identity behavior, recovery revocation, ordinary logout,
five distributed failures (including concurrent proof races), explicit revoke,
independent fresh-password reproof lockout and offline recovery restoration.
The frontend suite verifies two-step challenge usage and never accesses the
HttpOnly factor from JavaScript.
