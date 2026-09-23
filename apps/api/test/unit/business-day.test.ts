import { afterEach, describe, expect, it } from 'vitest';
import { loadEnv, resetEnvCache } from '../../src/config/env.js';
import {
  businessDayBounds,
  businessToday,
  isSameBusinessDay,
} from '../../src/shared/business-day.js';

const originalTimeZone = process.env.APP_TIMEZONE;

function inZone(timeZone: string): void {
  process.env.APP_TIMEZONE = timeZone;
  resetEnvCache();
}

afterEach(() => {
  if (originalTimeZone === undefined) delete process.env.APP_TIMEZONE;
  else process.env.APP_TIMEZONE = originalTimeZone;
  resetEnvCache();
});

describe("the agency's day", () => {
  it('is still the 23rd at 22:30 in São Paulo, when UTC has moved on to the 24th', () => {
    inZone('America/Sao_Paulo');
    const lateEvening = new Date('2026-09-24T01:30:00Z');

    expect(businessToday(lateEvening).toISOString()).toBe('2026-09-23T00:00:00.000Z');
    expect(businessDayBounds(lateEvening)).toEqual({
      startOfToday: new Date('2026-09-23T03:00:00Z'),
      startOfTomorrow: new Date('2026-09-24T03:00:00Z'),
    });
    expect(isSameBusinessDay(lateEvening, new Date('2026-09-23T12:00:00Z'))).toBe(true);
    expect(isSameBusinessDay(lateEvening, new Date('2026-09-24T12:00:00Z'))).toBe(false);
  });

  it('crosses a month and a year end on the local calendar', () => {
    inZone('America/Sao_Paulo');
    const newYearsEve = new Date('2027-01-01T02:30:00Z'); // 23:30 on 31/12 in São Paulo

    expect(businessToday(newYearsEve).toISOString()).toBe('2026-12-31T00:00:00.000Z');
    expect(businessDayBounds(newYearsEve).startOfTomorrow).toEqual(
      new Date('2027-01-01T03:00:00Z'),
    );
  });

  it('keeps a day whole across a clock change, in a zone that has them', () => {
    inZone('America/New_York');

    // Clocks go forward on 8 March 2026: that day starts on EST and ends on EDT.
    expect(businessDayBounds(new Date('2026-03-08T16:00:00Z'))).toEqual({
      startOfToday: new Date('2026-03-08T05:00:00Z'),
      startOfTomorrow: new Date('2026-03-09T04:00:00Z'),
    });

    // And back on 1 November 2026.
    expect(businessDayBounds(new Date('2026-11-01T18:00:00Z'))).toEqual({
      startOfToday: new Date('2026-11-01T04:00:00Z'),
      startOfTomorrow: new Date('2026-11-02T05:00:00Z'),
    });
  });

  it('refuses a zone that does not exist rather than silently using UTC', () => {
    expect(() =>
      loadEnv({
        DATABASE_URL: 'postgresql://app:pw@localhost:5432/db',
        PASSWORD_PEPPER: 'a-pepper-long-enough-for-the-schema',
        STORAGE_ENDPOINT: 'http://localhost:9000',
        STORAGE_ACCESS_KEY_ID: 'key',
        STORAGE_SECRET_ACCESS_KEY: 'secret',
        STORAGE_BUCKET: 'bucket',
        DB_OWNER_USER: 'owner',
        APP_TIMEZONE: 'Marte/Olympus',
      }),
    ).toThrow(/APP_TIMEZONE/);
  });
});
