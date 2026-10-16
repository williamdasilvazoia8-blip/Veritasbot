import { execSync } from 'node:child_process';

/** Aplica as migrações no banco de testes (TEST_DATABASE_URL), se configurado. */
export default function setup(): void {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return;
  execSync('npx prisma migrate deploy', { env: { ...process.env, DATABASE_URL: url }, stdio: 'ignore' });
}
