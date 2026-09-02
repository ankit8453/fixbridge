import type { AppConfig } from '../../core/config';

/** The two apps that can ask about their own version. */
export const APP_IDS = ['customer', 'partner'] as const;
export type AppId = (typeof APP_IDS)[number];

export function isAppId(value: string): value is AppId {
  return (APP_IDS as readonly string[]).includes(value);
}

export interface ReleaseResponse {
  app: AppId;
  latestVersion: string;
  minSupportedVersion: string;
  downloadUrl: string;
  /**
   * What the caller should do, decided here rather than in the app.
   *
   * The rule lives server-side on purpose: an app already on somebody's phone
   * cannot be corrected by shipping a new one, so the decision that matters
   * most — "this build must stop being used" — must be answerable without an
   * update. The client only obeys.
   */
  updateRequired: boolean;
  updateAvailable: boolean;
}

/**
 * Compares `major.minor.patch`.
 *
 * Deliberately not `localeCompare` or a string comparison: `0.10.0` is newer
 * than `0.9.0` and sorts before it as text, which would tell everybody on the
 * newer build to downgrade.
 *
 * Anything unparseable counts as ancient, so a garbled header from a tampered
 * or truncated client gets the update prompt rather than being waved through.
 */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string): [number, number, number] => {
    const parts = v
      .trim()
      .split('.')
      .map((p) => Number.parseInt(p, 10));
    if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n) || n < 0)) {
      return [-1, -1, -1];
    }
    return [parts[0]!, parts[1]!, parts[2]!];
  };

  const left = parse(a);
  const right = parse(b);

  for (let i = 0; i < 3; i += 1) {
    if (left[i]! !== right[i]!) return left[i]! < right[i]! ? -1 : 1;
  }
  return 0;
}

/**
 * What a given app on a given version should be told.
 *
 * `installedVersion` is optional because the very first call from a client too
 * old to send it still has to get an answer — and that client is, by
 * definition, one we cannot vouch for, so an absent version is treated as
 * out of date rather than current.
 */
export function resolveRelease(
  config: AppConfig,
  app: AppId,
  installedVersion?: string,
): ReleaseResponse {
  const latestVersion =
    app === 'customer' ? config.APP_CUSTOMER_LATEST_VERSION : config.APP_PARTNER_LATEST_VERSION;

  const minSupportedVersion =
    app === 'customer' ? config.APP_CUSTOMER_MIN_VERSION : config.APP_PARTNER_MIN_VERSION;

  const downloadUrl =
    app === 'customer' ? config.APP_CUSTOMER_DOWNLOAD_URL : config.APP_PARTNER_DOWNLOAD_URL;

  const installed = installedVersion?.trim();

  return {
    app,
    latestVersion,
    minSupportedVersion,
    downloadUrl,
    updateRequired: installed === undefined || compareVersions(installed, minSupportedVersion) < 0,
    updateAvailable: installed === undefined || compareVersions(installed, latestVersion) < 0,
  };
}
