import { describe, expect, it } from 'vitest';
import { createTranslator, isSupportedLocale, resolveLocale, translate } from './i18n';

describe('resolveLocale', () => {
  it('defaults to Hindi when no header is sent', () => {
    expect(resolveLocale(undefined)).toBe('hi');
    expect(resolveLocale(null)).toBe('hi');
    expect(resolveLocale('')).toBe('hi');
  });

  it('picks an exact supported tag', () => {
    expect(resolveLocale('en')).toBe('en');
    expect(resolveLocale('hi')).toBe('hi');
  });

  it('strips region subtags', () => {
    expect(resolveLocale('en-IN')).toBe('en');
    expect(resolveLocale('hi-IN')).toBe('hi');
  });

  it('is case-insensitive', () => {
    expect(resolveLocale('EN-in')).toBe('en');
  });

  it('honours q-values rather than header order', () => {
    expect(resolveLocale('en;q=0.4,hi;q=0.9')).toBe('hi');
    expect(resolveLocale('hi;q=0.2,en;q=0.8')).toBe('en');
  });

  it('skips unsupported languages and takes the best supported one', () => {
    expect(resolveLocale('fr-FR,de;q=0.8,en;q=0.5')).toBe('en');
  });

  it('falls back to the default when nothing is supported', () => {
    expect(resolveLocale('fr-FR,de;q=0.8')).toBe('hi');
  });

  it('treats a wildcard as the default locale', () => {
    expect(resolveLocale('*')).toBe('hi');
  });

  it('ignores entries explicitly refused with q=0', () => {
    expect(resolveLocale('en;q=0,fr')).toBe('hi');
  });

  it('tolerates malformed headers', () => {
    expect(resolveLocale(',,;;')).toBe('hi');
    expect(resolveLocale('en;q=notanumber')).toBe('hi');
  });
});

describe('isSupportedLocale', () => {
  it('accepts shipped locales only', () => {
    expect(isSupportedLocale('hi')).toBe(true);
    expect(isSupportedLocale('en')).toBe(true);
    expect(isSupportedLocale('ta')).toBe(false);
  });
});

describe('translate', () => {
  it('returns the message for the requested locale', () => {
    expect(translate('en', 'health.ok')).toBe('Service is running normally.');
    expect(translate('hi', 'health.ok')).toBe('सेवा ठीक चल रही है।');
  });

  it('resolves nested keys', () => {
    expect(translate('en', 'errors.notFound')).toMatch(/could not find/i);
  });

  it('returns the key itself when the message is missing', () => {
    expect(translate('en', 'errors.doesNotExist')).toBe('errors.doesNotExist');
    expect(translate('hi', 'totally.unknown.key')).toBe('totally.unknown.key');
  });

  it('does not return a partial branch as a message', () => {
    expect(translate('en', 'errors')).toBe('errors');
  });

  it('interpolates {{vars}}', () => {
    expect(translate('en', 'common.greeting', { name: 'Ankit' })).toBe('Hello Ankit');
    expect(translate('hi', 'common.greeting', { name: 'अंकित' })).toBe('नमस्ते अंकित');
  });

  it('leaves placeholders alone when no value is supplied', () => {
    expect(translate('en', 'common.greeting')).toBe('Hello {{name}}');
    expect(translate('en', 'common.greeting', { other: 'x' })).toBe('Hello {{name}}');
  });

  it('stringifies numeric values', () => {
    expect(translate('en', 'common.greeting', { name: 42 })).toBe('Hello 42');
  });
});

describe('createTranslator', () => {
  it('binds a locale', () => {
    const t = createTranslator('en');
    expect(t('health.ok')).toBe('Service is running normally.');
    expect(t('common.greeting', { name: 'Ankit' })).toBe('Hello Ankit');
  });
});
