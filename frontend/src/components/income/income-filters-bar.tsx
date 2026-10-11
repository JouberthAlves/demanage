import { ListFilters } from '@/components/shared/schedule-form/list-parts';
import { INCOME_TYPE_LABELS } from '@/data/labels';
import { useCustomTags } from '@/hooks/use-custom-tags';

type IncomeFiltersBarProps = {
  search: string;
  onSearchChange: (value: string) => void;
  type: string;
  onTypeChange: (value: string) => void;
};

const TYPE_OPTIONS = Object.entries(INCOME_TYPE_LABELS).map(
  ([value, label]) => ({ value, label }),
);

export function IncomeFiltersBar({
  search,
  onSearchChange,
  type,
  onTypeChange,
}: IncomeFiltersBarProps) {
  const { data: customTags = [] } = useCustomTags('income');
  const options = [
    ...TYPE_OPTIONS,
    ...customTags.map((tag) => ({ value: `tag:${tag.id}`, label: tag.name })),
  ];

  return (
    <ListFilters
      search={search}
      onSearchChange={onSearchChange}
      searchPlaceholder='Buscar entradas por nome...'
      value={type}
      onValueChange={onTypeChange}
      selectPlaceholder='Tipo'
      allLabel='Todos'
      options={options}
    />
  );
}
