import { useState } from 'react';
import { useNavigate } from 'react-router';
import { TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';

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

const CONFIRMATION_WORD = 'EXCLUIR';

export function DeleteAccountSection() {
  const deleteAccount = useAuthStore((state) => state.deleteAccount);
  const navigate = useNavigate();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [deleting, setDeleting] = useState(false);

  const confirmed = confirmation.trim().toUpperCase() === CONFIRMATION_WORD;

  function closeDialog() {
    if (deleting) return;
    setDialogOpen(false);
    setCurrentPassword('');
    setConfirmation('');
  }

  async function handleDelete(event: React.FormEvent) {
    event.preventDefault();
    if (!confirmed) return;
    setDeleting(true);

    try {
      await deleteAccount(currentPassword);
      toast.success('Sua conta e todos os dados foram excluídos.');
      navigate('/login', { replace: true });
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Não foi possível excluir a conta'));
      setDeleting(false);
    }
  }

  return (
    <>
      <section className='space-y-4 rounded-2xl border border-destructive/40 bg-destructive/5 p-4 sm:p-6'>
        <div className='flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between'>
          <div className='flex gap-3'>
            <div className='flex size-10 shrink-0 items-center justify-center rounded-xl bg-destructive/10'>
              <TriangleAlert className='size-5 text-destructive' />
            </div>
            <div>
              <h2 className='text-lg font-medium'>Excluir conta</h2>
              <p className='text-sm text-muted-foreground'>
                Apaga para sempre seu perfil, entradas, despesas, cartões,
                cofrinhos, patrimônio e integrações. Não dá para desfazer.
              </p>
            </div>
          </div>

          <Button
            type='button'
            variant='destructive'
            className='rounded-lg'
            onClick={() => setDialogOpen(true)}
          >
            Excluir conta
          </Button>
        </div>
      </section>

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => (open ? setDialogOpen(true) : closeDialog())}
      >
        <DialogContent className='rounded-xl sm:max-w-sm'>
          <DialogHeader>
            <DialogTitle>Excluir conta definitivamente?</DialogTitle>
            <DialogDescription>
              Todos os seus dados serão apagados e não poderão ser
              recuperados, nem com o código de recuperação.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleDelete} className='space-y-4'>
            <div className='space-y-2'>
              <Label htmlFor='delete-account-password'>Senha atual</Label>
              <Input
                id='delete-account-password'
                type='password'
                autoComplete='current-password'
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                required
              />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='delete-account-confirmation'>
                Digite {CONFIRMATION_WORD} para confirmar
              </Label>
              <Input
                id='delete-account-confirmation'
                autoComplete='off'
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                required
              />
            </div>
            <DialogFooter>
              <Button
                type='button'
                variant='outline'
                onClick={closeDialog}
                disabled={deleting}
              >
                Cancelar
              </Button>
              <Button
                type='submit'
                variant='destructive'
                disabled={deleting || !confirmed || !currentPassword}
              >
                {deleting ? <Spinner data-icon='inline-start' /> : null}
                Excluir para sempre
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
