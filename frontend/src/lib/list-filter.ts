/**
 * Shared filter of the expense / income lists: name search plus a category
 * (or type) that is either "all", a built-in key, or `tag:<customTagId>`.
 */
export function matchesListFilter(
  item: { name: string; customTagId?: string },
  builtinKey: string,
  search: string,
  filter: string,
) {
  const matchesSearch = item.name
    .toLowerCase()
    .includes(search.trim().toLowerCase());
  const matchesFilter =
    filter === 'all' ||
    (filter.startsWith('tag:')
      ? item.customTagId === filter.slice(4)
      : builtinKey === filter && !item.customTagId);
  return matchesSearch && matchesFilter;
}
