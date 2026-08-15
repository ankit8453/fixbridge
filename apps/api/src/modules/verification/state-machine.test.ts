import { describe, expect, it } from 'vitest';
import {
  DECISION_EVENT,
  LEVEL_NAMES,
  VERIFICATION_EVENT_TYPES,
  VERIFICATION_LEVELS,
  VERIFICATION_STATUSES,
  applyEvent,
  canApply,
  decisionRequiresNotes,
  isTerminal,
  isVerificationLevel,
  projectStatus,
  type VerificationEventType,
  type VerificationStatus,
} from './state-machine';

const event = (eventType: VerificationEventType) => ({ eventType });

/** The transitions that are allowed, exhaustively. Everything else must be refused. */
const VALID: [VerificationStatus, VerificationEventType, VerificationStatus][] = [
  ['submitted', 'moved_to_review', 'in_review'],
  ['submitted', 'info_requested', 'needs_info'],
  ['submitted', 'passed', 'passed'],
  ['submitted', 'failed', 'failed'],
  ['submitted', 'adapter_result_received', 'submitted'],
  ['in_review', 'info_requested', 'needs_info'],
  ['in_review', 'passed', 'passed'],
  ['in_review', 'failed', 'failed'],
  ['in_review', 'adapter_result_received', 'in_review'],
  ['needs_info', 'info_provided', 'in_review'],
  ['needs_info', 'failed', 'failed'],
  ['needs_info', 'adapter_result_received', 'needs_info'],
];

describe('levels', () => {
  it('are exactly 0–3 and named', () => {
    expect(VERIFICATION_LEVELS).toEqual([0, 1, 2, 3]);
    expect(LEVEL_NAMES).toEqual({
      0: 'identity',
      1: 'background',
      2: 'skill',
      3: 'references',
    });
  });

  it('recognises only real levels', () => {
    expect(isVerificationLevel(0)).toBe(true);
    expect(isVerificationLevel(3)).toBe(true);
    expect(isVerificationLevel(4)).toBe(false);
    expect(isVerificationLevel(-1)).toBe(false);
  });
});

describe('applyEvent — every valid transition', () => {
  it.each(VALID)('%s + %s -> %s', (from, eventType, expected) => {
    const result = applyEvent(from, eventType);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe(expected);
  });
});

describe('applyEvent — every invalid transition', () => {
  const allowed = new Set(VALID.map(([from, eventType]) => `${from}|${eventType}`));

  /**
   * Generates the complement of the table above, so a new event type or status
   * cannot be added without a deliberate decision about every combination.
   */
  const invalid = VERIFICATION_STATUSES.flatMap((from) =>
    VERIFICATION_EVENT_TYPES.filter((eventType) => !allowed.has(`${from}|${eventType}`)).map(
      (eventType) => [from, eventType] as const,
    ),
  );

  it.each(invalid)('%s + %s is refused', (from, eventType) => {
    expect(applyEvent(from, eventType).ok).toBe(false);
  });

  it('covers a meaningful number of combinations', () => {
    expect(invalid.length).toBe(
      VERIFICATION_STATUSES.length * VERIFICATION_EVENT_TYPES.length - VALID.length,
    );
  });
});

describe('terminal statuses', () => {
  it('are passed and failed', () => {
    expect(isTerminal('passed')).toBe(true);
    expect(isTerminal('failed')).toBe(true);
    expect(isTerminal('submitted')).toBe(false);
    expect(isTerminal('in_review')).toBe(false);
    expect(isTerminal('needs_info')).toBe(false);
  });

  it('accept nothing at all — a decided case is decided forever', () => {
    for (const eventType of VERIFICATION_EVENT_TYPES) {
      expect(applyEvent('passed', eventType)).toEqual({ ok: false, reason: 'terminal' });
      expect(applyEvent('failed', eventType)).toEqual({ ok: false, reason: 'terminal' });
    }
  });

  it('reports terminal separately from not-allowed, so callers can explain why', () => {
    expect(applyEvent('passed', 'info_requested')).toEqual({ ok: false, reason: 'terminal' });
    expect(applyEvent('in_review', 'info_provided')).toEqual({ ok: false, reason: 'not_allowed' });
  });
});

describe('submitted event', () => {
  it('is never valid as a follow-up — a retry opens a new case', () => {
    for (const from of VERIFICATION_STATUSES) {
      expect(canApply(from, 'submitted')).toBe(false);
    }
  });
});

describe('adapter results', () => {
  it('are recorded without moving the case, because ops still decide', () => {
    for (const from of ['submitted', 'in_review', 'needs_info'] as VerificationStatus[]) {
      const result = applyEvent(from, 'adapter_result_received');
      expect(result.ok && result.status).toBe(from);
    }
  });
});

describe('projectStatus', () => {
  it('folds a clean approval', () => {
    expect(projectStatus([event('submitted'), event('moved_to_review'), event('passed')])).toBe(
      'passed',
    );
  });

  it('folds a needs-info detour and back', () => {
    expect(
      projectStatus([
        event('submitted'),
        event('moved_to_review'),
        event('info_requested'),
        event('info_provided'),
      ]),
    ).toBe('in_review');
  });

  it('folds a single submission', () => {
    expect(projectStatus([event('submitted')])).toBe('submitted');
  });

  it('ignores adapter results when deciding the status', () => {
    expect(
      projectStatus([
        event('submitted'),
        event('adapter_result_received'),
        event('moved_to_review'),
        event('adapter_result_received'),
      ]),
    ).toBe('in_review');
  });

  it('folds a long history with several detours', () => {
    expect(
      projectStatus([
        event('submitted'),
        event('moved_to_review'),
        event('info_requested'),
        event('info_provided'),
        event('info_requested'),
        event('info_provided'),
        event('failed'),
      ]),
    ).toBe('failed');
  });

  it('refuses an empty log — a case always has its submitted event', () => {
    expect(() => projectStatus([])).toThrow(/at least its submitted event/);
  });

  it('refuses a log that does not start with submitted', () => {
    expect(() => projectStatus([event('passed')])).toThrow(/expected submitted/);
  });

  it('refuses a log that could not have happened', () => {
    // If this ever fires on real data, something wrote around the state machine.
    expect(() => projectStatus([event('submitted'), event('info_provided')])).toThrow(
      /not valid from submitted/,
    );
    expect(() => projectStatus([event('submitted'), event('passed'), event('failed')])).toThrow(
      /terminal/,
    );
  });
});

describe('ops decisions', () => {
  it('map to the right event', () => {
    expect(DECISION_EVENT.pass).toBe('passed');
    expect(DECISION_EVENT.fail).toBe('failed');
    expect(DECISION_EVENT.request_info).toBe('info_requested');
  });

  it('require notes for anything that is not an approval', () => {
    expect(decisionRequiresNotes('fail')).toBe(true);
    expect(decisionRequiresNotes('request_info')).toBe(true);
    expect(decisionRequiresNotes('pass')).toBe(false);
  });
});
