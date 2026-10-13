import { Badge } from '@/components/ui/badge';
import { incomeTypeLabel, tagBadgeStyle } from '@/data/labels';
import type { Income } from '@/types/finance';

import { typeColors } from './type-colors';

export function IncomeTypeBadge({ income }: { income: Income }) {
  if (income.customTag) {
    return (
      <Badge variant='outline' style={tagBadgeStyle(income.customTag.color)}>
        {income.customTag.name}
      </Badge>
    );
  }
  return (
    <Badge variant='outline' className={typeColors[income.type]}>
      {incomeTypeLabel(income)}
    </Badge>
  );
}
