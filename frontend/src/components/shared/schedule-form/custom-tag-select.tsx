import { useState } from 'react';

import { CustomTagFormDialog } from '@/components/shared/custom-tag-form-dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useCustomTags } from '@/hooks/use-custom-tags';
import type { CustomTagScope } from '@/types/finance';

const NEW_TAG_VALUE = '__new_type__';

export type SelectOption = { value: string; label: string };

type CustomTagSelectProps = {
  id: string;
  label: string;
  scope: CustomTagScope;
  /** Built-in key, or `tag:<id>` for a custom tag. */
  value: string;
  /** Built-in options; custom tags and "Outro…" are appended here. */
  options: SelectOption[];
  onChange: (value: string) => void;
};

/**
 * Category / type select with the user's custom tags and an inline
 * "Outro…" entry that opens the tag creation dialog.
 */
export function CustomTagSelect({
  id,
  label,
  scope,
  value,
  options,
  onChange,
}: CustomTagSelectProps) {
  const { data: customTags = [] } = useCustomTags(scope);
  const [tagDialogOpen, setTagDialogOpen] = useState(false);
  // Remounting the Select drops the transient "Outro…" selection.
  const [selectKey, setSelectKey] = useState(0);

  return (
    <>
      <div className='flex flex-col gap-2'>
        <Label id={`${id}-label`} htmlFor={id}>
          {label}
        </Label>
        <Select
          key={selectKey}
          value={value}
          onValueChange={(next) => {
            if (!next) return;
            if (next === NEW_TAG_VALUE) {
              setSelectKey((current) => current + 1);
              setTagDialogOpen(true);
              return;
            }
            onChange(next);
          }}
        >
          <SelectTrigger
            id={id}
            aria-labelledby={`${id}-label`}
            className='rounded-lg'
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
            {customTags.map((tag) => (
              <SelectItem key={tag.id} value={`tag:${tag.id}`}>
                <span className='inline-flex items-center gap-2'>
                  <span
                    className='size-2.5 rounded-full'
                    style={{ backgroundColor: tag.color }}
                  />
                  {tag.name}
                </span>
              </SelectItem>
            ))}
            <SelectItem value={NEW_TAG_VALUE}>Outro…</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <CustomTagFormDialog
        open={tagDialogOpen}
        onOpenChange={setTagDialogOpen}
        scope={scope}
        onCreated={(tag) => onChange(`tag:${tag.id}`)}
      />
    </>
  );
}
