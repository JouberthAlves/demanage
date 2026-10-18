import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';

import { api } from '@/lib/api';
import { API_URL } from '@/utils/var';

type ConsentRequest = {
  uid: string;
  step: 'account' | 'permissions';
  clientId: string;
  clientName: string;
  scopes: string[];
  resource: string;
  csrf: string;
};

const SCOPE_DESCRIPTIONS: Record<string, string> = {
  'finance:read': 'Consultar saldos, entradas e cofrinhos.',
  'finance:write': 'Registrar operações financeiras por meio do aplicativo conectado.',
};

export function OAuthConsentPage() {
  const [params] = useSearchParams();
  const uid = params.get('uid');
  const [request, setRequest] = useState<ConsentRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submissionStarted = useRef(false);
  const isAccountStep = request?.step === 'account';

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
      <meta name='referrer' content='same-origin' />
      <section className='w-full max-w-lg space-y-6 rounded-2xl border border-border bg-card p-7 shadow-lg'>
        <header className='space-y-2'>
          <p className='text-xs font-semibold uppercase tracking-wide text-emerald-400'>deManage · Integrações</p>
          {request && <p className='text-xs text-muted-foreground'>{isAccountStep ? 'Etapa 1 de 2' : 'Etapa 2 de 2'}</p>}
          <h1 className='text-2xl font-bold'>{isAccountStep ? 'Confirmar conta' : 'Autorizar conexão'}</h1>
          <p className='text-sm text-muted-foreground'>{isAccountStep ? 'Confirme a conta que será usada para conectar o aplicativo.' : 'Confira as permissões antes de continuar.'}</p>
        </header>
        {!uid || !/^[a-zA-Z0-9_-]{8,128}$/.test(uid) || error ? (
          <p role='alert' className='text-sm text-destructive'>{error ?? 'Solicitação inválida.'}</p>
        ) : !request ? (
          <p className='text-sm text-muted-foreground'>Carregando solicitação…</p>
        ) : (
          <>
            <p className='break-words text-sm'>O aplicativo <strong>{request.clientName}</strong> solicita acesso à sua conta.</p>
            <p className='break-all text-xs text-muted-foreground'>Identificador: {request.clientId}</p>
            {isAccountStep ? (
              <p className='text-sm text-muted-foreground'>Depois de confirmar a conta, você poderá revisar e autorizar as permissões solicitadas.</p>
            ) : (
              <>
                <div className='space-y-3 rounded-xl border border-border bg-background p-4'>
                  <h2 className='font-semibold'>Permissões solicitadas</h2>
                  <ul className='list-disc space-y-2 pl-5 text-sm'>
                    {request.scopes.map((scope) => <li key={scope}>{SCOPE_DESCRIPTIONS[scope] ?? scope}</li>)}
                  </ul>
                </div>
                {request.scopes.includes('finance:write') && (
                  <p className='text-sm text-amber-400'>Atenção: este aplicativo poderá executar operações financeiras autorizadas sem pedir uma nova confirmação no site deManage. Autorize apenas aplicativos em que confia.</p>
                )}
              </>
            )}
            <p className='text-xs text-muted-foreground'>Você pode revogar esse acesso a qualquer momento em Integrações.</p>
            <form method='post' action={`${API_URL}/oauth/interaction/${encodeURIComponent(request.uid)}/finish`} className='flex flex-wrap gap-3' aria-busy={submitting} onSubmit={(event) => {
              if (submissionStarted.current) {
                event.preventDefault();
                return;
              }
              submissionStarted.current = true;
              setSubmitting(true);
            }}>
              <input type='hidden' name='csrf' value={request.csrf} />
              <button disabled={submitting} className='rounded-lg bg-primary px-5 py-3 font-semibold text-primary-foreground disabled:opacity-50' type='submit' name='decision' value='approve'>
                {submitting ? 'Continuando…' : isAccountStep ? 'Confirmar e continuar' : 'Autorizar e continuar'}
              </button>
              <button disabled={submitting} className='rounded-lg border border-border px-5 py-3 disabled:opacity-50' type='submit' name='decision' value='deny'>Negar</button>
            </form>
          </>
        )}
        <Link className='block text-sm text-muted-foreground underline' to='/integracoes'>Gerenciar integrações</Link>
      </section>
    </main>
  );
}
