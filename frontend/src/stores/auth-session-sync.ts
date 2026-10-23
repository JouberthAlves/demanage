/** Cross-tab notices contain no user data or credentials. The cookie remains authoritative. */
export const AUTH_SESSION_EVENT_KEY = 'demanage:auth-session-change';

let noticeCounter = 0;

export function publishAuthSessionChange() {
  if (typeof window === 'undefined') return;
  try {
    // A fresh value is required for every storage event, even within a millisecond.
    window.localStorage.setItem(
      AUTH_SESSION_EVENT_KEY,
      `${Date.now()}:${++noticeCounter}:${Math.random().toString(36).slice(2)}`,
    );
  } catch {
    // Browsers may disable storage. Local session invalidation still works.
  }
}

export function subscribeAuthSessionChanges(onChange: () => void) {
  if (typeof window === 'undefined') return () => {};

  const onStorage = (event: StorageEvent) => {
    if (event.key === AUTH_SESSION_EVENT_KEY && event.newValue !== null) {
      onChange();
    }
  };

  window.addEventListener('storage', onStorage);
  return () => window.removeEventListener('storage', onStorage);
}
