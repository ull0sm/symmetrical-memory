export type DrawInputIssueCode =
  | 'NO_PARTICIPANTS'
  | 'TOO_FEW_PARTICIPANTS'
  | 'BYES_NOT_ALLOWED'
  | 'DUPLICATE_REGISTRATION'
  | 'DUPLICATE_SEED'
  | 'INVALID_SEED'
  | 'SEED_OUT_OF_RANGE'
  | 'UNKNOWN_SEED_REGISTRATION'
  | 'MISSING_SEED'
  | 'MISSING_RANDOM_SEED'
  | 'FORMAT_NOT_ALLOWED'
  | 'UNSUPPORTED_FORMAT'
  | 'UNSUPPORTED_SEPARATION_RULE'
  | 'GROUP_TOO_LARGE'
  | 'PIN_NOT_A_MEMBER'
  | 'PIN_OUT_OF_RANGE'
  | 'PIN_PLACE_TAKEN'
  | 'PINS_LEAVE_EMPTY_BOUT';

export interface DrawInputIssue {
  path: string;
  message: string;
  code: DrawInputIssueCode;
}

/**
 * Thrown when a category cannot be drawn as requested.
 *
 * Every issue is reported at once: an admin fixing entries before a tournament
 * should not have to fix one problem per attempt.
 */
export class DrawInputError extends Error {
  readonly code = 'INVALID_DRAW_INPUT';
  readonly issues: readonly DrawInputIssue[];

  constructor(issues: readonly DrawInputIssue[]) {
    super(`Draw input is invalid:\n${issues.map((i) => `  - ${i.path}: ${i.message}`).join('\n')}`);
    this.name = 'DrawInputError';
    this.issues = issues;
  }
}

export type GroupChangeErrorCode =
  | 'NOT_A_GROUP_DRAW'
  | 'UNKNOWN_SLOT'
  | 'NOT_A_BYE'
  | 'ALREADY_IN_DRAW'
  | 'BOUT_STARTED'
  | 'NEXT_BOUT_STARTED';

/** Thrown when a late change cannot be made to a group's drawn bracket or performance order. */
export class GroupChangeError extends Error {
  constructor(
    readonly code: GroupChangeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'GroupChangeError';
  }
}

export function issue(
  code: DrawInputIssueCode,
  path: string,
  message: string,
): DrawInputIssue {
  return { code, path, message };
}
