import { useState } from 'react';
import { KeyRound } from 'lucide-react';
import { toast } from 'sonner';

import { RecoveryCodePanel } from '@/components/auth/recovery-code-panel';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { getApiErrorMessage } from '@/lib/api-error';
import { useAuthStore } from '@/stores/auth-store';

type RecoverySectionProps = {
  hasRecoveryCode: boolean;
};

export function RecoverySection({ hasRecoveryCode }: RecoverySectionProps) {
  const generateRecoveryCode = useAuthStore(
    (state) => state.generateRecoveryCode,
  );
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');

  function closeDialog() {
    setDialogOpen(false);
    setCurrentPassword('');
  }

  async function handleGenerate(event: React.FormEvent) {
    event.preventDefault();
    setGenerating(true);

    try {
      const code = await generateRecoveryCode(currentPassword);
      setRecoveryCode(code);
      closeDialog();
      toast.success(
        hasRecoveryCode
          ? 'Novo código gerado. O anterior foi invalidado.'
          : 'Código de recuperação gerado.',
      );
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Não foi possível gerar o código'));
    } finally {
      setGenerating(false);
    }
  }

  return (
    <>
      <section className='space-y-4 rounded-2xl border border-border bg-card/20 p-4 sm:p-6'>
        <div className='flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between'>
          <div className='flex gap-3'>
            <div className='flex size-10 shrink-0 items-center justify-center rounded-xl bg-neon-green/10'>
              <KeyRound className='size-5 text-neon-green' />
            </div>
            <div>
              <h2 className='text-lg font-medium'>Recuperação de senha</h2>
              <p className='text-sm text-muted-foreground'>
                {hasRecoveryCode
                  ? 'Você já possui um código offline. Gere outro apenas se perdeu o atual.'
                  : 'Gere um código offline para recuperar sua conta sem e-mail ou SMS.'}
              </p>
            </div>
          </div>

          <Button
            type='button'
            variant='secondary'
            className='rounded-lg'
            disabled={generating}
            onClick={() => {
              setCurrentPassword('');
              setDialogOpen(true);
            }}
          >
            {generating ? <Spinner data-icon='inline-start' /> : null}
            {hasRecoveryCode ? 'Gerar novo código' : 'Gerar código'}
          </Button>
        </div>

        {recoveryCode ? (
          <RecoveryCodePanel recoveryCode={recoveryCode} compact />
        ) : null}
      </section>

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => (open ? setDialogOpen(true) : closeDialog())}
      >
        <DialogContent className='rounded-xl sm:max-w-sm'>
          <DialogHeader>
            <DialogTitle>Confirme sua senha</DialogTitle>
            <DialogDescription>
              Digite sua senha atual para gerar um novo código de recuperação.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleGenerate} className='space-y-4'>
            <div className='space-y-2'>
              <Label htmlFor='recovery-current-password'>Senha atual</Label>
              <Input
                id='recovery-current-password'
                type='password'
                autoComplete='current-password'
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                required
              />
            </div>
            <DialogFooter>
              <Button
                type='button'
                variant='outline'
                onClick={closeDialog}
                disabled={generating}
              >
                Cancelar
              </Button>
              <Button type='submit' disabled={generating}>
                {generating ? <Spinner data-icon='inline-start' /> : null}
                Gerar código
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
