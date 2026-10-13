import { ListFilters } from '@/components/shared/schedule-form/list-parts';
import { EXPENSE_CATEGORY_LABELS } from '@/data/labels';
import { useCustomTags } from '@/hooks/use-custom-tags';

type ExpenseFiltersBarProps = {
  search: string;
  onSearchChange: (value: string) => void;
  category: string;
  onCategoryChange: (value: string) => void;
};

const CATEGORY_OPTIONS = Object.entries(EXPENSE_CATEGORY_LABELS).map(
  ([value, label]) => ({ value, label }),
);

export function ExpenseFiltersBar({
  search,
  onSearchChange,
  category,
  onCategoryChange,
}: ExpenseFiltersBarProps) {
  const { data: customTags = [] } = useCustomTags('expense');
  const options = [
    ...CATEGORY_OPTIONS,
    ...customTags.map((tag) => ({ value: `tag:${tag.id}`, label: tag.name })),
  ];

  return (
    <ListFilters
      search={search}
      onSearchChange={onSearchChange}
      searchPlaceholder='Buscar despesas por nome...'
      value={category}
      onValueChange={onCategoryChange}
      selectPlaceholder='Categoria'
      allLabel='Todas'
      options={options}
    />
  );
}
