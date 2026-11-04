import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('falls back to the local database outside production', () => {
    expect(loadConfig({}).DATABASE_URL).toContain('localhost:5432');
  });

  it('requires DATABASE_URL in production instead of falling back', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(/DATABASE_URL is required/);
    expect(loadConfig({ NODE_ENV: 'production', DATABASE_URL: 'postgres://u:p@db/x' }).DATABASE_URL).toBe('postgres://u:p@db/x');
  });
});
