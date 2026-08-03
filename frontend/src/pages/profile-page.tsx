import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { PageHeader } from '@/components/layout/page-header';
import { CardFormDialog } from '@/components/profile/card-form-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { formatCurrency, parseCurrencyInput } from '@/lib/format';
import { useFinanceStore } from '@/stores/finance-store';
import type { Card } from '@/types/finance';

export function ProfilePage() {
  const profile = useFinanceStore((state) => state.profile);
  const updateProfile = useFinanceStore((state) => state.updateProfile);
  const removeCard = useFinanceStore((state) => state.removeCard);

  const [name, setName] = useState(profile.name);
  const [salary, setSalary] = useState(
    String(profile.salary).replace('.', ','),
  );
  const [notes, setNotes] = useState(profile.notes ?? '');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingCard, setEditingCard] = useState<Card | null>(null);

  useEffect(() => {
    setName(profile.name);
    setSalary(String(profile.salary).replace('.', ','));
    setNotes(profile.notes ?? '');
  }, [profile.name, profile.salary, profile.notes]);

  function handleSaveProfile(event: React.FormEvent) {
    event.preventDefault();
    updateProfile({
      name: name.trim() || 'Usuário',
      salary: parseCurrencyInput(salary),
      notes: notes.trim() || undefined,
    });
    toast.success('Perfil atualizado');
  }

  function openCreateCard() {
    setEditingCard(null);
    setDialogOpen(true);
  }

  function openEditCard(card: Card) {
    setEditingCard(card);
    setDialogOpen(true);
  }

  function handleDeleteCard(id: string, cardName: string) {
    removeCard(id);
    toast.success(`Cartão "${cardName}" removido`);
  }

  return (
    <div className='space-y-8'>
      <title>Perfil | deManage</title>
      <PageHeader
        title='Perfil'
        description='Salário, cartões e informações úteis para o mês.'
      />

      <form
        onSubmit={handleSaveProfile}
        className='max-w-2xl space-y-4 rounded-xl border border-border p-5'
      >
        <h2 className='text-lg font-medium'>Informações gerais</h2>

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
            <Input
              id='profile-salary'
              value={salary}
              onChange={(event) => setSalary(event.target.value)}
              placeholder='0,00'
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
            className='min-h-24 rounded-lg'
          />
        </div>

        <Button type='submit' className='rounded-lg'>
          Salvar perfil
        </Button>
      </form>

      <section className='space-y-4'>
        <div className='flex items-center justify-between gap-3'>
          <div>
            <h2 className='text-lg font-medium'>Cartões</h2>
            <p className='text-sm text-muted-foreground'>
              Use os cartões ao vincular despesas recorrentes.
            </p>
          </div>
          <Button onClick={openCreateCard} className='rounded-lg'>
            <Plus className='size-4' />
            Adicionar cartão
          </Button>
        </div>

        <div className='overflow-hidden rounded-xl border border-border'>
          <Table>
            <TableHeader>
              <TableRow className='hover:bg-transparent'>
                <TableHead>Nome</TableHead>
                <TableHead>Limite</TableHead>
                <TableHead>Fechamento</TableHead>
                <TableHead>Vencimento</TableHead>
                <TableHead className='w-24 text-right'>Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {profile.cards.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className='h-24 text-center text-muted-foreground'
                  >
                    Nenhum cartão cadastrado.
                  </TableCell>
                </TableRow>
              ) : (
                profile.cards.map((card) => (
                  <TableRow key={card.id}>
                    <TableCell className='font-medium'>{card.name}</TableCell>
                    <TableCell className='text-muted-foreground'>
                      {card.limit != null ? formatCurrency(card.limit) : '—'}
                    </TableCell>
                    <TableCell className='text-muted-foreground'>
                      {card.closingDay ? `Dia ${card.closingDay}` : '—'}
                    </TableCell>
                    <TableCell className='text-muted-foreground'>
                      {card.dueDay ? `Dia ${card.dueDay}` : '—'}
                    </TableCell>
                    <TableCell className='text-right'>
                      <div className='flex justify-end gap-1'>
                        <Button
                          variant='ghost'
                          size='icon-sm'
                          onClick={() => openEditCard(card)}
                        >
                          <Pencil className='size-4' />
                        </Button>
                        <Button
                          variant='ghost'
                          size='icon-sm'
                          onClick={() => handleDeleteCard(card.id, card.name)}
                        >
                          <Trash2 className='size-4' />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </section>

      <CardFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        card={editingCard}
      />
    </div>
  );
}
