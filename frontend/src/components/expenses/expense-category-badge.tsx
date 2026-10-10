import { Badge } from '@/components/ui/badge';
import { expenseTypeLabel, tagBadgeStyle } from '@/data/labels';
import type { RecurringExpense } from '@/types/finance';

import { categoryColors } from './category-colors';

export function ExpenseCategoryBadge({
  expense,
}: {
  expense: RecurringExpense;
}) {
  if (expense.customTag) {
    return (
      <Badge variant='outline' style={tagBadgeStyle(expense.customTag.color)}>
        {expense.customTag.name}
      </Badge>
    );
  }
  return (
    <Badge variant='outline' className={categoryColors[expense.category]}>
      {expenseTypeLabel(expense)}
    </Badge>
  );
}
