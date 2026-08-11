import { Copy, KeyRound } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';

type RecoveryCodePanelProps = {
  recoveryCode: string;
  compact?: boolean;
};

export function RecoveryCodePanel({
  recoveryCode,
  compact = false,
}: RecoveryCodePanelProps) {
  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(recoveryCode);
      toast.success('Código copiado');
    } catch {
      toast.error('Não foi possível copiar automaticamente');
    }
  }

  return (
    <div className='space-y-3 rounded-xl border border-neon-green/25 bg-neon-green/5 p-4'>
      <div className='flex items-start gap-3'>
        <div className='mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-neon-green/10'>
          <KeyRound className='size-4 text-neon-green' />
        </div>
        <div className='min-w-0 flex-1'>
          <p className='text-sm font-medium'>Código de recuperação</p>
          <p className='mt-1 text-xs text-muted-foreground'>
            Guarde fora do deManage. Ele não pode ser consultado novamente.
          </p>
        </div>
      </div>

      <div
        className={
          compact
            ? 'break-all rounded-lg border border-white/10 bg-black/30 px-3 py-2 font-mono text-sm tracking-wide'
            : 'break-all rounded-lg border border-white/10 bg-black/30 px-4 py-3 text-center font-mono text-base font-semibold tracking-[0.14em]'
        }
      >
        {recoveryCode}
      </div>

      <Button
        type='button'
        variant='secondary'
        className='w-full rounded-lg'
        onClick={() => void handleCopy()}
      >
        <Copy className='size-4' />
        Copiar código
      </Button>
    </div>
  );
}
