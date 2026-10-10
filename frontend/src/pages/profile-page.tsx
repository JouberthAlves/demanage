import { PageHeader } from '@/components/layout/page-header';
import { CardsSection } from '@/components/profile/cards-section';
import { ProfileInfoForm } from '@/components/profile/profile-info-form';
import { ProfileSummary } from '@/components/profile/profile-summary';
import { RecoverySection } from '@/components/profile/recovery-section';
import { useCardsOverview } from '@/components/profile/use-cards-overview';
import { useAuthStore } from '@/stores/auth-store';

export function ProfilePage() {
  const user = useAuthStore((state) => state.user);
  const {
    cards,
    committedByCard,
    totalLimit,
    totalCommitted,
    isLoading,
    isError,
  } = useCardsOverview();

  // Remount the info form whenever the saved profile changes, so its fields
  // restart from the stored values.
  const profileKey = [
    user?.id,
    user?.name,
    user?.salary,
    user?.salaryReceiveDay,
    user?.notes,
  ].join('|');

  return (
    <div className='space-y-8'>
      <title>Perfil | deManage</title>
      <PageHeader
        title='Perfil'
        description='Salário, cartões e informações úteis para o mês.'
      />

      <ProfileSummary
        user={user}
        cardCount={cards.length}
        totalLimit={totalLimit}
        totalCommitted={totalCommitted}
      />

      <div className='grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]'>
        <ProfileInfoForm key={profileKey} user={user} />
        <CardsSection
          cards={cards}
          committedByCard={committedByCard}
          isLoading={isLoading}
          isError={isError}
        />
      </div>

      <RecoverySection hasRecoveryCode={Boolean(user?.hasRecoveryCode)} />
    </div>
  );
}
