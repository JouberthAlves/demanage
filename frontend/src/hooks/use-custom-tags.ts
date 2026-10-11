import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  createCustomTag,
  type CustomTagPayload,
  listCustomTags,
} from '@/lib/custom-tags-api';
import { queryKeys } from '@/lib/query-keys';
import type { CustomTagScope } from '@/types/finance';

export function useCustomTags(scope: CustomTagScope) {
  return useQuery({
    queryKey: queryKeys.customTags(scope),
    queryFn: () => listCustomTags(scope),
  });
}

export function useCreateCustomTag() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: CustomTagPayload) => createCustomTag(payload),
    onSuccess: (tag) =>
      queryClient.invalidateQueries({
        queryKey: queryKeys.customTags(tag.scope),
      }),
  });
}
