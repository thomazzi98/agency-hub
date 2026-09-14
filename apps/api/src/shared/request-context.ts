import type { FastifyRequest } from 'fastify';

/** IPv6 addresses reach 45 characters; the column is sized for that. */
export function clientIp(request: FastifyRequest): string {
  return (request.ip || 'unknown').slice(0, 45);
}

export function clientUserAgent(request: FastifyRequest): string | null {
  const header = request.headers['user-agent'];
  return typeof header === 'string' ? header.slice(0, 512) : null;
}
