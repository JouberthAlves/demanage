import type { FormFieldError } from './validate-schedule';

/** Inline validation message, rendered only under the failing field. */
export function FieldError({
  error,
  fieldId,
  errorId,
}: {
  error: FormFieldError | null;
  fieldId: string;
  errorId: string;
}) {
  if (error?.fieldId !== fieldId) return null;
  return (
    <p id={errorId} role='alert' className='text-sm text-destructive'>
      {error.message}
    </p>
  );
}
