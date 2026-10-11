/**
 * Base class for every expected (business) error raised by the lib layer.
 * `code` is a stable machine readable identifier; `message` is what callers
 * may show (pt-BR) or, for CodedError, the code itself.
 */
export class DomainError extends Error {
  readonly code: string;

  constructor(message: string, code = 'DOMAIN_ERROR') {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

/**
 * DomainError whose message IS its code (e.g. 'NOT_FOUND'). The HTTP layer
 * historically matches on `error.message`, so both stay equal.
 */
export class CodedError extends DomainError {
  constructor(code: string) {
    super(code, code);
  }
}

export class InvalidCustomTagError extends CodedError {
  constructor() {
    super('INVALID_CUSTOM_TAG');
  }
}

export class ScheduleValidationError extends CodedError {}

export class PiggyError extends CodedError {}
