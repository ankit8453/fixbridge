import { randomUUID } from 'node:crypto';

/**
 * Third-party KYC providers, behind an interface from day one.
 *
 * Phase 4 is manual-first: ops humans make every real decision. These exist so
 * that wiring a Surepass or OnGrid integration later is an implementation of an
 * interface the rest of the system already talks to, rather than a change that
 * ripples through the service layer.
 *
 * The asynchronous shape is deliberate. Real KYC APIs answer via webhook minutes
 * or hours later, so the interface is `initiate` → later → `handleResult`, and
 * `adapter_result_received` exists as an event type from the start. Designing
 * for a synchronous call and retrofitting the callback is the expensive mistake.
 */

export interface AdapterInitiateResult {
  /**
   * The provider's handle for this check. Stored in the event payload instead of
   * any identity number — it is the pointer we keep, so a later dispute can be
   * traced without us holding the underlying data.
   */
  referenceToken: string;
}

export type AdapterOutcome = 'passed' | 'failed' | 'inconclusive';

export interface AdapterResult {
  referenceToken: string;
  outcome: AdapterOutcome;
  /** Safe-to-store summary. Must never contain a full identity number. */
  summary?: string;
}

export interface KycAdapter {
  readonly name: string;
  initiate(caseRef: string, payload: unknown): Promise<AdapterInitiateResult>;
  handleResult(result: AdapterResult): Promise<AdapterResult>;
}

export type IdentityKycAdapter = KycAdapter;
export type BackgroundCheckAdapter = KycAdapter;

/**
 * The Phase 4 default: initiating a check does nothing but mint a reference so
 * the case has something to correlate on. A human decides the outcome.
 */
export function createManualAdapter(name = 'manual'): KycAdapter {
  return {
    name,

    async initiate() {
      return { referenceToken: `manual:${randomUUID()}` };
    },

    async handleResult(result) {
      return result;
    },
  };
}

/**
 * Test double that resolves on its own, proving the asynchronous
 * `adapter_result_received` path works end to end without a real vendor.
 *
 * `onResult` is invoked on the next tick, which is enough to exercise the
 * "answer arrives after the request returns" ordering that the manual adapter
 * never does.
 */
export function createFakeAdapter(options: {
  name?: string;
  outcome: AdapterOutcome;
  onResult?: (result: AdapterResult) => void | Promise<void>;
}): KycAdapter {
  return {
    name: options.name ?? 'fake',

    async initiate(caseRef) {
      const referenceToken = `fake:${caseRef}:${randomUUID()}`;

      if (options.onResult) {
        setImmediate(() => {
          void options.onResult?.({
            referenceToken,
            outcome: options.outcome,
            summary: `fake adapter auto-resolved as ${options.outcome}`,
          });
        });
      }

      return { referenceToken };
    },

    async handleResult(result) {
      return result;
    },
  };
}

export interface VerificationAdapters {
  identity: IdentityKycAdapter;
  background: BackgroundCheckAdapter;
}

/** Manual everywhere until a real vendor is contracted. */
export function createDefaultAdapters(): VerificationAdapters {
  return {
    identity: createManualAdapter('manual-identity'),
    background: createManualAdapter('manual-background'),
  };
}
