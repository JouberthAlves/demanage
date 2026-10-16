/** Only restore an OAuth consent step after login, never an arbitrary URL. */
export function loginRedirect(state: unknown): string {
  if (!state || typeof state !== 'object' || !('from' in state)) return '/';
  const from = state.from;
  if (!from || typeof from !== 'object' || !('pathname' in from) || !('search' in from)) return '/';
  if (from.pathname !== '/oauth/consent' || typeof from.search !== 'string') return '/';
  if (!/^\?uid=[A-Za-z0-9_-]{8,128}$/.test(from.search)) return '/';
  return `/oauth/consent${from.search}`;
}
