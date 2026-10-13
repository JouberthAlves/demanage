import { PageHero } from '@/components/layout/page-hero';
import { SummaryTiles } from '@/components/shared/schedule-form/list-parts';

export function ExpenseSummaryHero({
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
      eyebrow='Recorrências'
      title={`${count} despesa${count === 1 ? '' : 's'}`}
      description='O saldo conta o pagamento antecipado na hora ou desconta automaticamente no dia configurado.'
    >
      <SummaryTiles
        total={total}
        filteredTotal={filteredTotal}
        totalClassName='text-neon-amber'
      />
    </PageHero>
  );
}
