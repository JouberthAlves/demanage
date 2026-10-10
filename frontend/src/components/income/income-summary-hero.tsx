import { PageHero } from '@/components/layout/page-hero';
import { SummaryTiles } from '@/components/shared/schedule-form/list-parts';

export function IncomeSummaryHero({
  count,
  total,
  filteredTotal,
}: {
  count: number;
  total: number;
  filteredTotal: number;
}) {
  return (
    <PageHero
      eyebrow='Receitas'
      title={`${count} entrada${count === 1 ? '' : 's'}`}
      description='O salário segue a agenda configurada; entradas avulsas só entram no histórico após confirmar o recebimento.'
    >
      <SummaryTiles
        total={total}
        filteredTotal={filteredTotal}
        totalClassName='text-neon-green'
      />
    </PageHero>
  );
}
