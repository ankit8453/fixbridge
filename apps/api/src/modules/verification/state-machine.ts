/**
 * The verification state machine — pure, no database.
 *
 * Case status is a **projection**: the durable truth is the append-only event
 * log, and `verification_cases.status` is a cached fold of it kept for query
 * convenience. `projectStatus` is that fold, and a test asserts the stored value
 * always equals it.
 *
 * That inversion is the whole point of the phase. "Why did this technician have
 * a badge on the day of the incident?" is answerable only if every transition
 * left a row behind, and only if no later write could rewrite one.
 */

/**
 * The verification ladder.
 *
 * References used to be level 3 and were removed: requiring two contactable
 * referees assumed every technician has them, which is not true of the people
 * this platform is for — someone working alone, or new to the trade, has no
 * second employer to name. It gated the badge on a social fact rather than on
 * anything about their work, and the honest checks (who they are, their record,
 * whether they can do the job) are the other three.
 *
 * Levels are deliberately not renumbered. The passed-level sets stored on
 * `provider_verification_summaries` and every event in the append-only log
 * refer to these numbers, and shifting them would silently reinterpret
 * history — a technician who passed "skill" would read as having passed
 * something else. 3 simply stops being asked for.
 */
export const VERIFICATION_LEVELS = [0, 1, 2] as const;
export type VerificationLevel = (typeof VERIFICATION_LEVELS)[number];

export const LEVEL_NAMES: Record<VerificationLevel, string> = {
  0: 'identity',
  1: 'background',
  2: 'skill',
};

export function isVerificationLevel(value: number): value is VerificationLevel {
  return (VERIFICATION_LEVELS as readonly number[]).includes(value);
}

export const VERIFICATION_STATUSES = [
  'submitted',
  'in_review',
  'needs_info',
  'passed',
  'failed',
] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export const VERIFICATION_EVENT_TYPES = [
  'submitted',
  'moved_to_review',
  'info_requested',
  'info_provided',
  'passed',
  'failed',
  'adapter_result_received',
] as const;
export type VerificationEventType = (typeof VERIFICATION_EVENT_TYPES)[number];

/** Terminal statuses: a case in one of these never changes again. */
export const TERMINAL_STATUSES: readonly VerificationStatus[] = ['passed', 'failed'];

export function isTerminal(status: VerificationStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/**
 * Which event may follow which status.
 *
 * `adapter_result_received` is absent: it records that a third party answered,
 * which is evidence rather than a decision, so it is legal in any non-terminal
 * status and moves nothing on its own. Ops still decide.
 */
const ALLOWED_EVENTS: Record<VerificationStatus, readonly VerificationEventType[]> = {
  submitted: ['moved_to_review', 'info_requested', 'passed', 'failed'],
  in_review: ['info_requested', 'passed', 'failed'],
  needs_info: ['info_provided', 'failed'],
  passed: [],
  failed: [],
};

/** Where each event leaves the case. */
const RESULTING_STATUS: Record<VerificationEventType, VerificationStatus | null> = {
  submitted: 'submitted',
  moved_to_review: 'in_review',
  info_requested: 'needs_info',
  // Answering a request puts the case straight back in front of ops.
  info_provided: 'in_review',
  passed: 'passed',
  failed: 'failed',
  adapter_result_received: null,
};

export type TransitionResult =
  { ok: true; status: VerificationStatus } | { ok: false; reason: 'terminal' | 'not_allowed' };

/**
 * Whether `event` may be appended to a case currently in `from`, and where it
 * leaves the case. The only place transition rules exist.
 */
export function applyEvent(
  from: VerificationStatus,
  event: VerificationEventType,
): TransitionResult {
  // Terminal is checked first so a closed case always reports *why* it refused
  // everything — "this is already decided" is the answer a caller needs.
  if (isTerminal(from)) {
    return { ok: false, reason: 'terminal' };
  }

  if (event === 'submitted') {
    // Only ever the first event of a case; a second submission opens a new case.
    return { ok: false, reason: 'not_allowed' };
  }

  if (event === 'adapter_result_received') {
    // Evidence, not a decision — recorded without moving the case.
    return { ok: true, status: from };
  }

  if (!ALLOWED_EVENTS[from].includes(event)) {
    return { ok: false, reason: 'not_allowed' };
  }

  return { ok: true, status: RESULTING_STATUS[event] ?? from };
}

export function canApply(from: VerificationStatus, event: VerificationEventType): boolean {
  return applyEvent(from, event).ok;
}

/**
 * Folds an event log into the current status.
 *
 * Events must be in chronological order. An empty log is not a valid case — a
 * case is created together with its `submitted` event, in one transaction.
 */
export function projectStatus(
  events: readonly { eventType: VerificationEventType }[],
): VerificationStatus {
  const [first, ...rest] = events;

  if (!first) {
    throw new Error('cannot project status: a case must have at least its submitted event');
  }

  if (first.eventType !== 'submitted') {
    throw new Error(`cannot project status: first event is ${first.eventType}, expected submitted`);
  }

  let status: VerificationStatus = 'submitted';

  for (const event of rest) {
    const result = applyEvent(status, event.eventType);

    // A stored log that cannot be replayed means something wrote around the
    // state machine. Fail loudly rather than guess.
    if (!result.ok) {
      throw new Error(
        `cannot project status: ${event.eventType} is not valid from ${status} (${result.reason})`,
      );
    }

    status = result.status;
  }

  return status;
}

/** The decisions an ops reviewer can record. */
export const OPS_DECISIONS = ['pass', 'fail', 'request_info'] as const;
export type OpsDecision = (typeof OPS_DECISIONS)[number];

export const DECISION_EVENT: Record<OpsDecision, VerificationEventType> = {
  pass: 'passed',
  fail: 'failed',
  request_info: 'info_requested',
};

/** Refusing and asking for more both need a reason a human can act on. */
export function decisionRequiresNotes(decision: OpsDecision): boolean {
  return decision === 'fail' || decision === 'request_info';
}
