import { isAxiosError } from 'axios';
import { useQueryClient } from '@tanstack/react-query';
import { CreditCard, Plus, Wallet } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { PageHeader } from '@/components/layout/page-header';
import { CardFormDialog } from '@/components/profile/card-form-dialog';
import { CreditCardTile } from '@/components/profile/credit-card-tile';
import { Button } from '@/components/ui/button';
import { CurrencyInput } from '@/components/ui/currency-input';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { useCards, useDeleteCard } from '@/hooks/use-cards';
import { ENTRIES_QUERY_KEY } from '@/hooks/use-entries';
import { formatBrlInputValue, formatCurrency, parseCurrencyInput } from '@/lib/format';
import { useAuthStore } from '@/stores/auth-store';
import { useFinanceStore } from '@/stores/finance-store';
import type { Card } from '@/types/finance';

export function ProfilePage() {
  const queryClient = useQueryClient();
  const { isLoading: cardsLoading, isError: cardsError } = useCards();
  const user = useAuthStore((state) => state.user);
  const updateProfile = useAuthStore((state) => state.updateProfile);
  const cards = useFinanceStore((state) => state.profile.cards);
  const expenses = useFinanceStore((state) => state.expenses);
  const removeCard = useDeleteCard();

  const [name, setName] = useState(user?.name ?? '');
  const [salary, setSalary] = useState(
    user?.salary ? formatBrlInputValue(user.salary) : '',
  );
  const [notes, setNotes] = useState(user?.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingCard, setEditingCard] = useState<Card | null>(null);

  useEffect(() => {
    setName(user?.name ?? '');
    setSalary(user?.salary ? formatBrlInputValue(user.salary) : '');
    setNotes(user?.notes ?? '');
  }, [user?.name, user?.salary, user?.notes]);

  const committedByCard = useMemo(() => {
    const map = new Map<string, number>();
    for (const expense of expenses) {
      if (!expense.cardId || expense.isInvoice) continue;
      map.set(expense.cardId, (map.get(expense.cardId) ?? 0) + expense.amount);
    }
    return map;
  }, [expenses]);

  const totalLimit = useMemo(
    () => cards.reduce((sum, card) => sum + (card.limit ?? 0), 0),
    [cards],
  );

  const totalCommitted = useMemo(
    () =>
      cards.reduce(
        (sum, card) => sum + (committedByCard.get(card.id) ?? 0),
        0,
      ),
    [cards, committedByCard],
  );

  async function handleSaveProfile(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);

    const nextSalary = parseCurrencyInput(salary);

    try {
      await updateProfile({
        name: name.trim() || 'Usuário',
        salary: nextSalary,
        notes: notes.trim() || null,
      });
      await queryClient.invalidateQueries({ queryKey: ENTRIES_QUERY_KEY });
      toast.success('Perfil atualizado');
    } catch (err) {
      const message = isAxiosError(err)
        ? (err.response?.data?.error ?? 'Não foi possível salvar o perfil')
        : 'Não foi possível salvar o perfil';
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

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
      const message = isAxiosError(err)
        ? (err.response?.data?.error ?? 'Não foi possível remover o cartão')
        : 'Não foi possível remover o cartão';
      toast.error(message);
    }
  }

  return (
    <div className='space-y-8'>
      <title>Perfil | deManage</title>
      <PageHeader
        title='Perfil'
        description='Salário, cartões e informações úteis para o mês.'
      />

      <section className='relative overflow-hidden rounded-2xl border border-border bg-card/40'>
        <div className='pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,rgba(255,184,0,0.12),transparent_45%),radial-gradient(ellipse_at_bottom_right,rgba(52,211,153,0.1),transparent_40%)]' />
        <div className='relative grid gap-6 p-6 sm:grid-cols-[1.2fr_1fr] sm:items-end'>
          <div className='space-y-2'>
            <p className='text-sm text-muted-foreground'>Bem-vindo de volta</p>
            <h2 className='text-3xl font-semibold tracking-tight'>
              {user?.name || 'Usuário'}
            </h2>
            <p className='max-w-md text-sm text-muted-foreground'>
              {user?.notes?.trim()
                ? user.notes
                : 'Configure salário e cartões para acompanhar o mês com mais clareza.'}
            </p>
          </div>

          <div className='grid gap-3 sm:grid-cols-2'>
            <div className='rounded-xl border border-border bg-black/25 p-4'>
              <div className='flex items-center gap-2 text-muted-foreground'>
                <Wallet className='size-4 text-neon-green' />
                <span className='text-xs'>Salário mensal</span>
              </div>
              <p className='mt-2 text-xl font-semibold tracking-tight text-neon-green'>
                {formatCurrency(user?.salary ?? 0)}
              </p>
            </div>
            <div className='rounded-xl border border-border bg-black/25 p-4'>
              <div className='flex items-center gap-2 text-muted-foreground'>
                <CreditCard className='size-4 text-neon-amber' />
                <span className='text-xs'>Limite dos cartões</span>
              </div>
              <p className='mt-2 text-xl font-semibold tracking-tight text-neon-amber'>
                {totalLimit > 0 ? formatCurrency(totalLimit) : '—'}
              </p>
              <p className='mt-1 text-xs text-muted-foreground'>
                {cards.length} cartão
                {cards.length === 1 ? '' : 'ões'}
                {totalLimit > 0
                  ? ` · ${formatCurrency(totalCommitted)} em uso`
                  : ''}
              </p>
            </div>
          </div>
        </div>
      </section>

      <div className='grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]'>
        <form
          onSubmit={(event) => void handleSaveProfile(event)}
          className='space-y-5 rounded-2xl border border-border bg-card/30 p-6'
        >
          <div>
            <h2 className='text-lg font-medium'>Informações gerais</h2>
            <p className='text-sm text-muted-foreground'>
              Esses dados alimentam o dashboard e os cálculos do mês.
            </p>
          </div>

          <div className='grid gap-4 sm:grid-cols-2'>
            <div className='space-y-2'>
              <Label htmlFor='profile-name'>Nome</Label>
              <Input
                id='profile-name'
                value={name}
                onChange={(event) => setName(event.target.value)}
                className='rounded-lg'
              />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='profile-salary'>Salário mensal</Label>
              <CurrencyInput
                id='profile-salary'
                value={salary}
                onValueChange={setSalary}
                className='rounded-lg'
              />
            </div>
          </div>

          <div className='space-y-2'>
            <Label htmlFor='profile-notes'>Observações</Label>
            <Textarea
              id='profile-notes'
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder='Metas, lembretes, anotações...'
              className='min-h-28 rounded-lg'
            />
          </div>

          <Button type='submit' className='rounded-lg' disabled={saving}>
            {saving ? <Spinner data-icon='inline-start' /> : null}
            Salvar perfil
          </Button>
        </form>

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

          {cardsLoading ? (
            <div className='flex h-40 items-center justify-center'>
              <Spinner className='size-5' />
            </div>
          ) : cardsError ? (
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
        </section>
      </div>

      <CardFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        card={editingCard}
      />
    </div>
  );
}
