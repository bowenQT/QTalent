import { describe, expect, it } from 'vitest';
import { parseEnv } from './env';
const local = {
  APP_ENV: 'test',
  DATABASE_URL: 'postgresql://test:test@127.0.0.1:5432/qtalent_test',
  BETTER_AUTH_SECRET: 'x'.repeat(32),
  BETTER_AUTH_URL: 'http://localhost:3000',
};
describe('runtime configuration', () => {
  it('accepts isolated test settings without optional external integrations', () =>
    expect(parseEnv(local).APP_ENV).toBe('test'));
  it('rejects missing database and short authentication secret', () => {
    expect(() => parseEnv({ ...local, DATABASE_URL: undefined })).toThrow();
    expect(() =>
      parseEnv({ ...local, APP_ENV: undefined, NODE_ENV: 'production' }),
    ).toThrow();
    expect(() => parseEnv({ ...local, BETTER_AUTH_SECRET: 'short' })).toThrow();
  });
  it('cannot disable Access in demo or production', () => {
    for (const APP_ENV of ['demo', 'production'])
      expect(() =>
        parseEnv({ ...local, APP_ENV, ACCESS_ENFORCED: 'false' }),
      ).toThrow();
  });
  it('requires issuer and audience when Access is enforced', () => {
    expect(() => parseEnv({ ...local, ACCESS_ENFORCED: 'true' })).toThrow();
    expect(
      parseEnv({
        ...local,
        APP_ENV: 'production',
        ACCESS_ENFORCED: 'true',
        ACCESS_ISSUER: 'https://test.cloudflareaccess.com',
        ACCESS_AUDIENCE: 'test-audience',
      }).ACCESS_ENFORCED,
    ).toBe(true);
  });
  it('rejects insecure or arbitrary key issuers', () => {
    for (const ACCESS_ISSUER of [
      'http://test.cloudflareaccess.com',
      'https://attacker.test',
      'https://test.cloudflareaccess.com/path',
    ])
      expect(() =>
        parseEnv({
          ...local,
          ACCESS_ENFORCED: 'true',
          ACCESS_ISSUER,
          ACCESS_AUDIENCE: 'a',
        }),
      ).toThrow();
  });
});
