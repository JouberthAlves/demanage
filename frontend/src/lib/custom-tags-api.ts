import { api } from '@/lib/api';
import type { CustomTag, CustomTagScope } from '@/types/finance';

export type CustomTagPayload = {
  scope: CustomTagScope;
  name: string;
  color: string;
};

export async function listCustomTags(scope: CustomTagScope) {
  const { data } = await api.get<CustomTag[]>('/custom-tags', {
    params: { scope },
  });
  return data;
}

export async function createCustomTag(payload: CustomTagPayload) {
  const { data } = await api.post<CustomTag>('/custom-tags', payload);
  return data;
}

export async function deleteCustomTag(id: string) {
  await api.delete(`/custom-tags/${id}`);
}
