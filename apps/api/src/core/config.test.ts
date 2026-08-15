import { describe, expect, it } from 'vitest';
import { ConfigValidationError, parseConfig } from './config';

const VALID_ENV = {
  DATABASE_URL: 'postgresql://fixbridge:fixbridge@localhost:5432/fixbridge?schema=public',
  REDIS_URL: 'redis://localhost:6379',
} satisfies NodeJS.ProcessEnv;

describe('parseConfig', () => {
  it('accepts the minimum viable environment and applies defaults', () => {
    const config = parseConfig({ ...VALID_ENV });

    expect(config.APP_NAME).toBe('fixbridge');
    expect(config.NODE_ENV).toBe('development');
    expect(config.PORT).toBe(3000);
    expect(config.LOG_LEVEL).toBe('info');
    expect(config.SHUTDOWN_TIMEOUT_MS).toBe(10_000);
  });

  it('keeps the app name configurable so no brand is baked into the build', () => {
    const config = parseConfig({ ...VALID_ENV, APP_NAME: 'some-other-name' });
    expect(config.APP_NAME).toBe('some-other-name');
  });

  it('coerces PORT from its string environment form', () => {
    const config = parseConfig({ ...VALID_ENV, PORT: '8080' });
    expect(config.PORT).toBe(8080);
    expect(typeof config.PORT).toBe('number');
  });

  it('ignores unrelated environment variables', () => {
    const config = parseConfig({ ...VALID_ENV, HOME: '/root', SOME_CI_VAR: 'x' });
    expect(config).not.toHaveProperty('SOME_CI_VAR');
  });

  it('returns a frozen object', () => {
    const config = parseConfig({ ...VALID_ENV });
    expect(Object.isFrozen(config)).toBe(true);
  });

  it('rejects a missing DATABASE_URL and names the field', () => {
    const env = { ...VALID_ENV } as NodeJS.ProcessEnv;
    delete env.DATABASE_URL;

    expect(() => parseConfig(env)).toThrow(ConfigValidationError);
    expect(() => parseConfig(env)).toThrow(/DATABASE_URL/);
  });

  it('rejects a DATABASE_URL that is not a postgres URL', () => {
    expect(() => parseConfig({ ...VALID_ENV, DATABASE_URL: 'mysql://localhost:3306/db' })).toThrow(
      /DATABASE_URL/,
    );
  });

  it('rejects a REDIS_URL with the wrong protocol', () => {
    expect(() => parseConfig({ ...VALID_ENV, REDIS_URL: 'http://localhost:6379' })).toThrow(
      /REDIS_URL/,
    );
  });

  it('rejects an out-of-range PORT', () => {
    expect(() => parseConfig({ ...VALID_ENV, PORT: '70000' })).toThrow(/PORT/);
  });

  it('rejects an unknown NODE_ENV', () => {
    expect(() => parseConfig({ ...VALID_ENV, NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
  });

  it('rejects an unknown LOG_LEVEL', () => {
    expect(() => parseConfig({ ...VALID_ENV, LOG_LEVEL: 'chatty' })).toThrow(/LOG_LEVEL/);
  });

  it('reports every invalid field at once', () => {
    let message = '';
    try {
      parseConfig({ DATABASE_URL: 'nope', REDIS_URL: 'nope' });
    } catch (error) {
      message = error instanceof Error ? error.message : '';
    }

    expect(message).toMatch(/DATABASE_URL/);
    expect(message).toMatch(/REDIS_URL/);
    expect(message).toMatch(/\.env\.example/);
  });
});
