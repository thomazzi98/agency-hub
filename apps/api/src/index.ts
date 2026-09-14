import { buildApp } from './app.js';
import { loadEnv } from './config/env.js';

const env = loadEnv();
const app = buildApp();

app.listen({ port: env.API_PORT, host: '0.0.0.0' }).catch((error: unknown) => {
  app.log.error(error);
  process.exit(1);
});
