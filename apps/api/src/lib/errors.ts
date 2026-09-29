// API error format (spec §4.5). Shared error codes live here until packages/types is split out
// (docs/PROGRESS.md deviation log).
export type ErrorCode =
  | "VALIDATION_ERROR"
  | "INVALID_CREDENTIALS"
  | "ACCOUNT_LOCKED"
  | "MFA_REQUIRED"
  | "MFA_ENROLLMENT_REQUIRED"
  | "MFA_INVALID_CODE"
  | "SELECT_ORGANISATION_REQUIRED"
  | "INVALID_CHALLENGE"
  | "SESSION_EXPIRED"
  | "CSRF_INVALID"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "IDEMPOTENCY_CONFLICT"
  | "INVALID_STATE_TRANSITION"
  | "VERIFICATION_UNAVAILABLE"
  | "DB_UNAVAILABLE"
  | "INTERNAL_ERROR";

export class ApiError extends Error {
  code: ErrorCode;
  status: number;
  retryable: boolean;
  details: Record<string, unknown>;

  constructor(code: ErrorCode, status: number, message: string, opts: { retryable?: boolean; details?: Record<string, unknown> } = {}) {
    super(message);
    this.code = code;
    this.status = status;
    this.retryable = opts.retryable ?? false;
    this.details = opts.details ?? {};
  }
}

export const Errors = {
  validation: (message: string, details?: Record<string, unknown>) => new ApiError("VALIDATION_ERROR", 400, message, { details }),
  invalidCredentials: () => new ApiError("INVALID_CREDENTIALS", 401, "Incorrect credentials."),
  accountLocked: () => new ApiError("ACCOUNT_LOCKED", 423, "This account is temporarily locked. Try again later."),
  mfaRequired: () => new ApiError("MFA_REQUIRED", 401, "Multi-factor authentication code required."),
  mfaEnrollmentRequired: () => new ApiError("MFA_ENROLLMENT_REQUIRED", 401, "Multi-factor authentication must be set up."),
  mfaInvalidCode: () => new ApiError("MFA_INVALID_CODE", 401, "That code is not valid."),
  selectOrganisationRequired: () => new ApiError("SELECT_ORGANISATION_REQUIRED", 401, "Select an organisation to continue."),
  invalidChallenge: () => new ApiError("INVALID_CHALLENGE", 401, "This login session has expired. Please sign in again."),
  sessionExpired: () => new ApiError("SESSION_EXPIRED", 401, "Your session has expired. Please sign in again."),
  csrfInvalid: () => new ApiError("CSRF_INVALID", 403, "Request could not be verified. Please refresh and try again."),
  forbidden: () => new ApiError("FORBIDDEN", 403, "You do not have permission to do this."),
  notFound: (what = "Resource") => new ApiError("NOT_FOUND", 404, `${what} not found.`),
  idempotencyConflict: () => new ApiError("IDEMPOTENCY_CONFLICT", 409, "This request is already being processed."),
  invalidStateTransition: (message: string) => new ApiError("INVALID_STATE_TRANSITION", 409, message),
  internal: (message = "Something went wrong.") => new ApiError("INTERNAL_ERROR", 500, message, { retryable: true }),
};
