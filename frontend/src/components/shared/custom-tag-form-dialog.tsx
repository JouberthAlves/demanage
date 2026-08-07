import { isAxiosError } from 'axios';
import { useEffect, useState } from 'react';
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
import { TAG_COLOR_OPTIONS } from '@/data/labels';
import { useCreateCustomTag } from '@/hooks/use-custom-tags';
import type { CustomTag, CustomTagScope } from '@/types/finance';

type CustomTagFormDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scope: CustomTagScope;
  onCreated: (tag: CustomTag) => void;
};

export function CustomTagFormDialog({
  open,
  onOpenChange,
  scope,
  onCreated,
}: CustomTagFormDialogProps) {
  const createTag = useCreateCustomTag();
  const [name, setName] = useState('');
  const [color, setColor] = useState<string>(TAG_COLOR_OPTIONS[0]);

  useEffect(() => {
    if (!open) return;
    setName('');
    setColor(TAG_COLOR_OPTIONS[0]);
  }, [open]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    if (!name.trim()) {
      toast.error('Informe o nome do tipo');
      return;
    }

    try {
      const tag = await createTag.mutateAsync({
        scope,
        name: name.trim().slice(0, 100),
        color,
      });
      toast.success('Tipo criado');
      onCreated(tag);
      onOpenChange(false);
    } catch (err) {
      const message = isAxiosError(err)
        ? (err.response?.data?.error ?? 'Não foi possível criar o tipo')
        : 'Não foi possível criar o tipo';
      toast.error(message);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='rounded-xl sm:max-w-sm'>
        <DialogHeader>
          <DialogTitle>Novo tipo</DialogTitle>
          <DialogDescription>
            Crie uma tag personalizada e escolha a cor.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(event) => void handleSubmit(event)}
          className='flex flex-col gap-4'
        >
          <div className='flex flex-col gap-2'>
            <Label htmlFor='custom-tag-name'>Nome</Label>
            <Input
              id='custom-tag-name'
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder='Ex: Academia'
              maxLength={100}
              className='rounded-lg'
              autoFocus
            />
          </div>

          <div className='flex flex-col gap-2'>
            <Label>Cor da tag</Label>
            <div className='grid grid-cols-5 gap-2'>
              {TAG_COLOR_OPTIONS.map((option) => {
                const selected = color === option;
                return (
                  <button
                    key={option}
                    type='button'
                    aria-label={`Cor ${option}`}
                    onClick={() => setColor(option)}
                    className='flex size-9 items-center justify-center rounded-lg border border-border transition-transform hover:scale-105'
                    style={{
                      backgroundColor: `${option}22`,
                      boxShadow: selected
                        ? `0 0 0 2px ${option}`
                        : undefined,
                    }}
                  >
                    <span
                      className='size-4 rounded-full'
                      style={{ backgroundColor: option }}
                    />
                  </button>
                );
              })}
            </div>
            <p
              className='mt-1 inline-flex w-fit items-center rounded-md border px-2 py-0.5 text-xs font-medium'
              style={{
                borderColor: `${color}55`,
                backgroundColor: `${color}22`,
                color,
              }}
            >
              {name.trim() || 'Prévia'}
            </p>
          </div>

          <DialogFooter>
            <Button
              type='button'
              variant='outline'
              className='rounded-lg'
              onClick={() => onOpenChange(false)}
              disabled={createTag.isPending}
            >
              Cancelar
            </Button>
            <Button
              type='submit'
              className='rounded-lg'
              disabled={createTag.isPending}
            >
              {createTag.isPending ? (
                <Spinner data-icon='inline-start' />
              ) : null}
              Criar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
