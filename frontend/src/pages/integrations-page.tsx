import { useCallback, useEffect, useState } from 'react';

import { PageHeader } from '@/components/layout/page-header';
import { api } from '@/lib/api';

type Connection = {
  clientId: string;
  clientName: string;
  scopes: string[];
  createdAt: string;
};

export function IntegrationsPage() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [busyClient, setBusyClient] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get<{ connections: Connection[] }>('/oauth/connections');
      setConnections(data.connections);
      setError(null);
    } catch {
      setError('Não foi possível carregar suas integrações.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void api.get<{ connections: Connection[] }>('/oauth/connections')
      .then(({ data }) => {
        if (active) setConnections(data.connections);
      })
      .catch(() => {
        if (active) setError('Não foi possível carregar suas integrações.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  async function revoke(clientId: string, clientName: string) {
    if (!window.confirm(`Revogar o acesso de ${clientName}?`)) return;
    setBusyClient(clientId);
    try {
      await api.post('/oauth/connections/revoke', { clientId });
      await load();
    } catch {
      setError('Não foi possível revogar o acesso. Tente novamente.');
    } finally {
      setBusyClient(null);
    }
  }

  return (
    <div className='space-y-7'>
      <title>Integrações | deManage</title>
      <PageHeader title='Integrações' description='Gerencie os aplicativos autorizados a acessar seus dados financeiros.' />
      {error && <p role='alert' className='text-sm text-destructive'>{error}</p>}
      {loading ? <p>Carregando integrações…</p> : connections.length === 0 ? (
        <div className='rounded-xl border border-border p-6 text-sm text-muted-foreground'>Você não possui aplicativos conectados.</div>
      ) : (
        <ul className='space-y-3'>
          {connections.map((connection) => (
            <li key={connection.clientId} className='flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border p-5'>
              <div className='min-w-0 space-y-1'>
                <h2 className='font-semibold'>{connection.clientName}</h2>
                <p className='break-all text-xs text-muted-foreground'>{connection.clientId}</p>
                <p className='text-xs text-muted-foreground'>Permissões: {connection.scopes.join(', ')}</p>
              </div>
              <button
                type='button'
                disabled={busyClient === connection.clientId}
                className='rounded-lg border border-destructive px-4 py-2 text-sm text-destructive disabled:opacity-50'
                onClick={() => void revoke(connection.clientId, connection.clientName)}
              >
                {busyClient === connection.clientId ? 'Revogando…' : 'Revogar acesso'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
