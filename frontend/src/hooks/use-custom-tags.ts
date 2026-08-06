import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  createCustomTag,
  listCustomTags,
  type CustomTagPayload,
} from '@/lib/custom-tags-api';
import type { CustomTagScope } from '@/types/finance';

export function customTagsQueryKey(scope: CustomTagScope) {
  return ['custom-tags', scope] as const;
}

export function useCustomTags(scope: CustomTagScope) {
  return useQuery({
    queryKey: customTagsQueryKey(scope),
    queryFn: () => listCustomTags(scope),
  });
}

export function useCreateCustomTag() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: CustomTagPayload) => createCustomTag(payload),
    onSuccess: (tag) => {
      void queryClient.invalidateQueries({
        queryKey: customTagsQueryKey(tag.scope),
      });
    },
  });
}
