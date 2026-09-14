import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { closeTestPrisma, testPrisma } from './helpers/prisma.js';

const app = buildApp({ prisma: testPrisma(), logger: false });

describe('health probes', () => {
  afterAll(async () => {
    await app.close();
    await closeTestPrisma();
  });

  it('GET /health returns 200 and status ok', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });

  it('GET /health/ready reports a reachable database', async () => {
    const response = await app.inject({ method: 'GET', url: '/health/ready' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok', database: 'ok' });
  });
});
