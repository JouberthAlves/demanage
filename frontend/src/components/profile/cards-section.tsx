import { useState } from 'react';
import { CreditCard, Plus } from 'lucide-react';
import { toast } from 'sonner';

import { CardFormDialog } from '@/components/profile/card-form-dialog';
import { CreditCardTile } from '@/components/profile/credit-card-tile';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useDeleteCard } from '@/hooks/use-cards';
import { getApiErrorMessage } from '@/lib/api-error';
import type { Card } from '@/types/finance';

type CardsSectionProps = {
  cards: Card[];
  committedByCard: Map<string, number>;
  isLoading: boolean;
  isError: boolean;
};

export function CardsSection({
  cards,
  committedByCard,
  isLoading,
  isError,
}: CardsSectionProps) {
  const removeCard = useDeleteCard();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingCard, setEditingCard] = useState<Card | null>(null);

  function openCreateCard() {
    setEditingCard(null);
    setDialogOpen(true);
  }

  function openEditCard(card: Card) {
    setEditingCard(card);
    setDialogOpen(true);
  }

  async function handleDeleteCard(id: string, cardName: string) {
    try {
      await removeCard.mutateAsync(id);
      toast.success(`Cartão "${cardName}" removido`);
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Não foi possível remover o cartão'));
    }
  }

  return (
    <section className='space-y-4 rounded-2xl border border-border bg-card/20 p-6'>
      <div className='flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between'>
        <div>
          <h2 className='text-lg font-medium'>Cartões</h2>
          <p className='text-sm text-muted-foreground'>
            Vincule despesas recorrentes e acompanhe o limite.
          </p>
        </div>
        <Button onClick={openCreateCard} className='rounded-lg'>
          <Plus className='size-4' />
          Adicionar
        </Button>
      </div>

      {isLoading ? (
        <div className='flex h-40 items-center justify-center'>
          <Spinner className='size-5' />
        </div>
      ) : isError ? (
        <div className='flex h-40 items-center justify-center rounded-xl border border-dashed border-rose-500/30 bg-rose-500/5 px-4 text-center text-sm text-rose-300'>
          Não foi possível carregar os cartões.
        </div>
      ) : cards.length === 0 ? (
        <div className='flex h-48 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-black/20 px-6 text-center'>
          <div className='flex size-12 items-center justify-center rounded-2xl bg-neon-amber/10'>
            <CreditCard className='size-6 text-neon-amber' />
          </div>
          <div className='space-y-1'>
            <p className='font-medium'>Nenhum cartão ainda</p>
            <p className='text-sm text-muted-foreground'>
              Cadastre o primeiro para organizar parcelas e assinaturas.
            </p>
          </div>
          <Button
            variant='secondary'
            onClick={openCreateCard}
            className='rounded-lg'
          >
            <Plus className='size-4' />
            Adicionar cartão
          </Button>
        </div>
      ) : (
        <div className='grid gap-4'>
          {cards.map((card) => (
            <CreditCardTile
              key={card.id}
              card={card}
              committed={committedByCard.get(card.id) ?? 0}
              deleting={removeCard.isPending}
              onEdit={() => openEditCard(card)}
              onDelete={() => void handleDeleteCard(card.id, card.name)}
            />
          ))}
        </div>
      )}

      <CardFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        card={editingCard}
      />
    </section>
  );
}
