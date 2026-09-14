import { loadDotenv } from '../src/config/dotenv.js';
import {
  recreateDatabase,
  resolveTestDatabaseUrl,
  runMigrateDeploy,
} from './helpers/test-database.js';

export default async function setup(): Promise<void> {
  loadDotenv();

  const testDatabaseUrl = resolveTestDatabaseUrl();
  await recreateDatabase(testDatabaseUrl);
  runMigrateDeploy(testDatabaseUrl);
}
