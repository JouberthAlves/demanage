import { useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { getApiErrorMessage } from '@/lib/api-error';
import { type TrustedDevice,useAuthStore } from '@/stores/auth-store';

export function TrustedDeviceSection() {
  const list = useAuthStore((state) => state.listTrustedDevices);
  const enroll = useAuthStore((state) => state.enrollTrustedDevice);
  const revoke = useAuthStore((state) => state.revokeTrustedDevice);
  const [devices, setDevices] = useState<TrustedDevice[]>([]);
  const [action, setAction] = useState<{ revokeId?: string } | null>(null);
  const [password, setPassword] = useState('');
  const [label, setLabel] = useState('Este navegador');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void list().then((items) => { if (active) setDevices(items); }).catch(() => {});
    return () => { active = false; };
  }, [list]);

  function close() {
    if (busy) return;
    setAction(null);
    setPassword('');
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!action || busy) return;
    setBusy(true);
    try {
      if (action.revokeId) {
        await revoke(action.revokeId, password);
        toast.success('Dispositivo revogado');
      } else {
        await enroll(password, label.trim());
        toast.success('Este navegador foi cadastrado com segurança');
      }
      setDevices(await list());
      setAction(null);
      setPassword('');
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Não foi possível atualizar o dispositivo'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className='space-y-4 rounded-2xl border border-border bg-card/20 p-4 sm:p-6'>
        <div className='flex items-start gap-3'>
          <ShieldCheck className='mt-1 size-6 shrink-0 text-neon-green' />
          <div className='flex-1 space-y-2'>
            <h2 className='text-lg font-medium'>Dispositivos confiáveis</h2>
            <p className='text-sm text-muted-foreground'>
              Cadastre este navegador confirmando sua senha. O dispositivo recebe
              um cookie secreto HttpOnly válido por até 30 dias; a senha continua
              obrigatória. Assim, o bloqueio temporário por tentativas de terceiros
              contra seu e-mail não impede o acesso neste dispositivo.
              O código de recuperação offline permanece independente.
            </p>
            <Button type='button' variant='secondary'
              disabled={devices.length >= 5}
              onClick={() => { setPassword(''); setAction({}); }}>
              Cadastrar este navegador
            </Button>
          </div>
        </div>
        {devices.length ? (
          <ul className='space-y-2 text-sm'>
            {devices.map((device) => (
              <li key={device.id} className='flex items-center justify-between gap-3 rounded-lg border border-border p-3'>
                <div>
                  <span className='font-medium'>{device.label}</span>
                  <p className='text-xs text-muted-foreground'>
                    Válido até {new Date(device.expiresAt).toLocaleDateString('pt-BR')}
                  </p>
                </div>
                <Button type='button' variant='outline' size='sm'
                  onClick={() => { setPassword(''); setAction({ revokeId: device.id }); }}>
                  Revogar
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
      <Dialog open={action !== null} onOpenChange={(open) => { if (!open) close(); }}>
        <DialogContent className='rounded-xl sm:max-w-sm'>
          <DialogHeader>
            <DialogTitle>{action?.revokeId ? 'Revogar dispositivo' : 'Confiar neste navegador'}</DialogTitle>
            <DialogDescription>
              Confirme a senha atual. Você poderá remover este acesso depois.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={(event) => void submit(event)} className='space-y-4'>
            {!action?.revokeId ? (
              <div className='space-y-2'>
                <Label htmlFor='trusted-device-label'>Nome do dispositivo</Label>
                <Input id='trusted-device-label' maxLength={80} value={label}
                  onChange={(event) => setLabel(event.target.value)} required />
              </div>
            ) : null}
            <div className='space-y-2'>
              <Label htmlFor='trusted-device-password'>Senha atual</Label>
              <Input id='trusted-device-password' type='password' autoComplete='current-password'
                value={password} onChange={(event) => setPassword(event.target.value)} required />
            </div>
            <DialogFooter>
              <Button type='button' variant='outline' onClick={close} disabled={busy}>Cancelar</Button>
              <Button type='submit' disabled={busy}>
                {busy ? <Spinner data-icon='inline-start' /> : null}
                {action?.revokeId ? 'Revogar' : 'Cadastrar'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
