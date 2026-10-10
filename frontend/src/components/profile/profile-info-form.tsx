import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { CurrencyInput } from '@/components/ui/currency-input';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { getApiErrorMessage } from '@/lib/api-error';
import {
  formatBrlInputValue,
  maskClosingDayInput,
  normalizeClosingDayInput,
  parseCurrencyInput,
} from '@/lib/format';
import { invalidateDomain } from '@/lib/query-keys';
import { useAuthStore } from '@/stores/auth-store';
import type { AuthUser } from '@/types/auth';

const DEFAULT_RECEIVE_DAY = '05';

type ProfileInfoFormProps = {
  user: AuthUser | null;
};

/**
 * Edita nome, salário, dia de recebimento e observações. O estado é iniciado
 * a partir do usuário; quando o perfil muda, a página remonta o formulário
 * (via `key`) em vez de sincronizar os campos por effect.
 */
export function ProfileInfoForm({ user }: ProfileInfoFormProps) {
  const queryClient = useQueryClient();
  const updateProfile = useAuthStore((state) => state.updateProfile);

  const [name, setName] = useState(user?.name ?? '');
  const [salary, setSalary] = useState(
    user?.salary ? formatBrlInputValue(user.salary) : '',
  );
  const [salaryReceiveDay, setSalaryReceiveDay] = useState(
    user?.salaryReceiveDay
      ? String(user.salaryReceiveDay).padStart(2, '0')
      : DEFAULT_RECEIVE_DAY,
  );
  const [notes, setNotes] = useState(user?.notes ?? '');
  const [saving, setSaving] = useState(false);

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();

    const nextSalary = parseCurrencyInput(salary);
    const normalizedReceiveDay = normalizeClosingDayInput(salaryReceiveDay);
    const nextReceiveDay = normalizedReceiveDay
      ? Number(normalizedReceiveDay)
      : NaN;

    if (
      nextSalary > 0 &&
      (!Number.isInteger(nextReceiveDay) ||
        nextReceiveDay < 1 ||
        nextReceiveDay > 31)
    ) {
      toast.error('Informe o dia em que recebe o salário (01-31)');
      return;
    }

    setSaving(true);
    try {
      await updateProfile({
        name: name.trim().slice(0, 100) || 'Usuário',
        salary: nextSalary,
        salaryReceiveDay: nextSalary > 0 ? nextReceiveDay : null,
        notes: notes.trim().slice(0, 500) || null,
      });
      // Salary and receive day feed the entries and the patrimony balances.
      await invalidateDomain(queryClient, 'profile');
      toast.success('Perfil atualizado');
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Não foi possível salvar o perfil'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={(event) => void handleSave(event)}
      className='space-y-5 rounded-2xl border border-border bg-card/30 p-4 sm:p-6'
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
            maxLength={100}
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
        <div className='space-y-2 sm:col-span-2 sm:max-w-xs'>
          <Label htmlFor='profile-salary-day'>Quando recebe</Label>
          <Input
            id='profile-salary-day'
            inputMode='numeric'
            maxLength={2}
            value={salaryReceiveDay}
            onChange={(event) =>
              setSalaryReceiveDay(maskClosingDayInput(event.target.value))
            }
            onBlur={() =>
              setSalaryReceiveDay(normalizeClosingDayInput(salaryReceiveDay))
            }
            placeholder='05'
            className='rounded-lg'
          />
          <p className='text-xs text-muted-foreground'>
            Dia do mês em que o salário entra no saldo.
          </p>
        </div>
      </div>

      <div className='space-y-2'>
        <Label htmlFor='profile-notes'>Observações</Label>
        <Textarea
          id='profile-notes'
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder='Metas, lembretes, anotações...'
          maxLength={500}
          className='max-h-40 min-h-28 field-sizing-fixed overflow-y-auto rounded-lg'
        />
        <p className='text-xs text-muted-foreground'>{notes.length}/500</p>
      </div>

      <Button type='submit' className='rounded-lg' disabled={saving}>
        {saving ? <Spinner data-icon='inline-start' /> : null}
        Salvar perfil
      </Button>
    </form>
  );
}
