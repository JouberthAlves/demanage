import type { FormFieldError } from './validate-schedule';

/** aria props linking a control to the inline error shown for it. */
export function fieldErrorProps(
  error: FormFieldError | null,
  fieldId: string,
  errorId: string,
) {
  const active = error?.fieldId === fieldId;
  return {
    'aria-invalid': active,
    'aria-describedby': active ? errorId : undefined,
  };
}
