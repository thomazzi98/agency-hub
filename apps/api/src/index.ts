import { loadDotenv } from './config/dotenv.js';
import { buildApp } from './app.js';
import { getEnv } from './config/env.js';
import { disconnectPrismaClient } from './shared/db.js';

loadDotenv();

const env = getEnv();
const app = buildApp();

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  app.log.info({ signal }, 'shutting down');
  try {
    await app.close();
    await disconnectPrismaClient();
    process.exit(0);
  } catch (error) {
    app.log.error({ err: error }, 'shutdown failed');
    process.exit(1);
  }
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, (received) => {
    void shutdown(received);
  });
}

app.listen({ port: env.API_PORT, host: '0.0.0.0' }).catch((error: unknown) => {
  app.log.error({ err: error }, 'failed to start');
  void disconnectPrismaClient().finally(() => process.exit(1));
});
