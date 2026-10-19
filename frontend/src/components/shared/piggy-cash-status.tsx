import { Button } from '@/components/ui/button';

/** Don't present a misleading cash figure while transfer history is unavailable. */
export function PiggyCashStatus({
  isError,
  isFetching,
  onRetry,
}: {
  isError: boolean;
  isFetching: boolean;
  onRetry: () => void;
}) {
  return (
    <div
      className='flex flex-wrap items-center gap-3 rounded-lg border border-border p-4 text-sm'
      role={isError ? 'alert' : 'status'}
    >
      <span>
        {isError
          ? 'Resumo temporariamente indisponível: não foi possível conferir as movimentações dos cofrinhos.'
          : 'Conferindo as movimentações dos cofrinhos para calcular o saldo…'}
      </span>
      {isError ? (
        <Button type='button' size='sm' variant='outline' onClick={onRetry} disabled={isFetching}>
          Tentar novamente
        </Button>
      ) : null}
    </div>
  );
}
