const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

(async () => {
  try {
    const { runner } = await import('node-pg-migrate');
    await runner({
      databaseUrl: process.env.DATABASE_URL,
      dir: path.join(__dirname, '..', 'migrations'),
      migrationsTable: 'pgmigrations',
      direction: 'up',
      count: Infinity,
      logger: console
    });
  } catch (err) {
  console.error('Migration failed:', err.message);
  process.exit(1);
  }
})();
