import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';

import { api } from '@/lib/api';
import { API_URL } from '@/utils/var';

type ConsentRequest = {
  uid: string;
  clientId: string;
  clientName: string;
  scopes: string[];
  resource: string;
  csrf: string;
};

const SCOPE_DESCRIPTIONS: Record<string, string> = {
  'finance:read': 'Consultar saldos, entradas e cofrinhos.',
  'finance:write': 'Solicitar alterações financeiras com confirmação.',
};

export function OAuthConsentPage() {
  const [params] = useSearchParams();
  const uid = params.get('uid');
  const [request, setRequest] = useState<ConsentRequest | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!uid || !/^[a-zA-Z0-9_-]{8,128}$/.test(uid)) return;
    let cancelled = false;
    void api.get<ConsentRequest>(`/oauth/interaction/${encodeURIComponent(uid)}`)
      .then(({ data }) => { if (!cancelled) setRequest(data); })
      .catch(() => { if (!cancelled) setError('Esta solicitação expirou ou não pertence à sua sessão.'); });
    return () => { cancelled = true; };
  }, [uid]);

  return (
    <main className='flex min-h-screen items-center justify-center bg-background p-4 text-foreground'>
      <section className='w-full max-w-lg space-y-6 rounded-2xl border border-border bg-card p-7 shadow-lg'>
        <header className='space-y-2'>
          <p className='text-xs font-semibold uppercase tracking-wide text-emerald-400'>deManage · Integrações</p>
          <h1 className='text-2xl font-bold'>Autorizar conexão</h1>
          <p className='text-sm text-muted-foreground'>Confira o aplicativo e as permissões antes de continuar.</p>
        </header>
        {!uid || !/^[a-zA-Z0-9_-]{8,128}$/.test(uid) || error ? (
          <p role='alert' className='text-sm text-destructive'>{error ?? 'Solicitação inválida.'}</p>
        ) : !request ? (
          <p className='text-sm text-muted-foreground'>Carregando solicitação…</p>
        ) : (
          <>
            <p className='break-words text-sm'>O aplicativo <strong>{request.clientName}</strong> solicita acesso à sua conta.</p>
            <p className='break-all text-xs text-muted-foreground'>Identificador: {request.clientId}</p>
            <div className='space-y-3 rounded-xl border border-border bg-background p-4'>
              <h2 className='font-semibold'>Permissões solicitadas</h2>
              <ul className='list-disc space-y-2 pl-5 text-sm'>
                {request.scopes.map((scope) => <li key={scope}>{SCOPE_DESCRIPTIONS[scope] ?? scope}</li>)}
              </ul>
            </div>
            <p className='text-xs text-muted-foreground'>Você pode revogar esse acesso a qualquer momento em Integrações. Operações financeiras exigem confirmação no deManage.</p>
            <form method='post' action={`${API_URL}/oauth/interaction/${encodeURIComponent(request.uid)}/finish`} className='flex flex-wrap gap-3'>
              <input type='hidden' name='csrf' value={request.csrf} />
              <button className='rounded-lg bg-primary px-5 py-3 font-semibold text-primary-foreground' type='submit' name='decision' value='approve'>Autorizar</button>
              <button className='rounded-lg border border-border px-5 py-3' type='submit' name='decision' value='deny'>Negar</button>
            </form>
          </>
        )}
        <Link className='block text-sm text-muted-foreground underline' to='/integracoes'>Gerenciar integrações</Link>
      </section>
    </main>
  );
}
