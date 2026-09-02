import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../../core/config';
import { compareVersions, isAppId, resolveRelease } from './service';

describe('compareVersions', () => {
  it('orders by number, not by text', () => {
    // The whole reason this function exists. As strings, '0.10.0' sorts before
    // '0.9.0', which would tell everyone on the newer build to downgrade.
    expect(compareVersions('0.10.0', '0.9.0')).toBe(1);
    expect(compareVersions('0.9.0', '0.10.0')).toBe(-1);
    expect(compareVersions('1.0.0', '0.99.99')).toBe(1);
  });

  it('treats equal versions as equal', () => {
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
    expect(compareVersions(' 1.2.3 ', '1.2.3')).toBe(0);
  });

  it('compares each component in turn', () => {
    expect(compareVersions('1.2.4', '1.2.3')).toBe(1);
    expect(compareVersions('1.3.0', '1.2.9')).toBe(1);
    expect(compareVersions('2.0.0', '1.9.9')).toBe(1);
  });

  it('counts anything unparseable as ancient', () => {
    // A truncated or tampered version must get the update prompt rather than
    // being waved through as current.
    for (const bad of ['', 'x', '1.2', '1.2.3.4', '-1.0.0', 'null']) {
      expect(compareVersions(bad, '0.0.0')).toBe(-1);
    }
  });
});

describe('resolveRelease', () => {
  const config = {
    APP_CUSTOMER_LATEST_VERSION: '1.4.0',
    APP_CUSTOMER_MIN_VERSION: '1.2.0',
    APP_PARTNER_LATEST_VERSION: '2.0.1',
    APP_PARTNER_MIN_VERSION: '2.0.0',
    APP_CUSTOMER_DOWNLOAD_URL: 'https://example.test/app',
    APP_PARTNER_DOWNLOAD_URL: 'https://example.test/partner',
  } as AppConfig;

  it('says nothing is needed on the newest build', () => {
    const r = resolveRelease(config, 'customer', '1.4.0');
    expect(r.updateAvailable).toBe(false);
    expect(r.updateRequired).toBe(false);
  });

  it('offers an update between the minimum and the latest', () => {
    const r = resolveRelease(config, 'customer', '1.3.0');
    expect(r.updateAvailable).toBe(true);
    // Above the floor, so it stays a suggestion the customer can dismiss.
    expect(r.updateRequired).toBe(false);
  });

  it('forces an update below the minimum', () => {
    const r = resolveRelease(config, 'customer', '1.1.9');
    expect(r.updateRequired).toBe(true);
    expect(r.updateAvailable).toBe(true);
  });

  it('treats the minimum itself as still supported', () => {
    // An off-by-one here locks out the exact version that was declared fine.
    expect(resolveRelease(config, 'customer', '1.2.0').updateRequired).toBe(false);
  });

  it('forces an update when the client sends no version at all', () => {
    // A client too old to report its version is one we cannot vouch for.
    expect(resolveRelease(config, 'customer').updateRequired).toBe(true);
  });

  it('keeps the two apps on their own tracks', () => {
    const partner = resolveRelease(config, 'partner', '2.0.0');
    expect(partner.latestVersion).toBe('2.0.1');
    expect(partner.downloadUrl).toBe('https://example.test/partner');
    expect(partner.updateRequired).toBe(false);
    expect(partner.updateAvailable).toBe(true);
  });
});

describe('isAppId', () => {
  it('accepts only the two real apps', () => {
    expect(isAppId('customer')).toBe(true);
    expect(isAppId('partner')).toBe(true);
    expect(isAppId('admin')).toBe(false);
    expect(isAppId('')).toBe(false);
  });
});
