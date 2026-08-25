import { beforeEach, describe, expect, it } from 'vitest';
import {
  preferredLocale,
  readStoredLocale,
  storeLocale,
  urlStatesLocale,
} from '../i18n/preference';

/**
 * Hindi is the default. It must not be compulsory.
 *
 * The complaint this answers: the partner surface had no language toggle at
 * all, and the app landed everybody on Hindi every visit regardless of what
 * they read. India is not monolingual and a marketplace that only speaks to
 * half its technicians is not finished.
 *
 * The rules pinned here are the ones easy to get subtly wrong later — chiefly
 * that an explicit `/en` URL outranks any stored preference, because otherwise
 * a shared link renders something other than what it says.
 */

describe('locale preference', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('falls back to Hindi when nothing has been chosen', () => {
    expect(preferredLocale()).toBe('hi');
    expect(readStoredLocale()).toBeNull();
  });

  it('remembers a choice across visits', () => {
    storeLocale('en');
    expect(readStoredLocale()).toBe('en');
    expect(preferredLocale()).toBe('en');
  });

  it("prefers the signed-in user's server-side setting over the local record", () => {
    // The server value followed them from another device; the local one is
    // only this browser's memory.
    storeLocale('hi');
    expect(preferredLocale('en')).toBe('en');
  });

  it('ignores a stored value that is not a supported locale', () => {
    // Hand-edited storage, or a locale removed in a later release.
    window.localStorage.setItem('fixbridge.locale', 'fr');
    expect(readStoredLocale()).toBeNull();
    expect(preferredLocale()).toBe('hi');
  });

  it('treats only an /en URL as an explicit request', () => {
    expect(urlStatesLocale('/en')).toBe(true);
    expect(urlStatesLocale('/en/partner/jobs')).toBe(true);

    // The unprefixed tree is Hindi, but it is also what somebody typing the
    // bare domain gets — so it cannot be read as "chose Hindi", or a stored
    // English preference could never take effect on it.
    expect(urlStatesLocale('/')).toBe(false);
    expect(urlStatesLocale('/partner/jobs')).toBe(false);

    // Must not match a path that merely begins with those two letters.
    expect(urlStatesLocale('/english-teacher')).toBe(false);
    expect(urlStatesLocale('/enquiries')).toBe(false);
  });
});
