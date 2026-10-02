const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const backendDir = path.join(__dirname, '..');

test('backend declares a PostgreSQL database connection', () => {
  const envFile = fs.readFileSync(path.join(backendDir, '.env'), 'utf8');
  assert.match(envFile, /DATABASE_URL=/i, 'DATABASE_URL is missing from the backend environment file');
});

test('server enforces role-aware customer and partner auth', () => {
  const serverText = fs.readFileSync(path.join(backendDir, 'server.js'), 'utf8');
  assert.match(serverText, /new Pool\(/, 'PostgreSQL pool is missing');
  assert.match(serverText, /role !== 'customer'/, 'Customer-only route guard is missing');
  assert.match(serverText, /role !== 'partner'/, 'Partner-only route guard is missing');
});

test('initial migration creates the required core tables', () => {
  const migrationText = fs.readFileSync(path.join(backendDir, 'migrations', '1750000000000_init.js'), 'utf8');
  assert.match(migrationText, /createTable\('users'/, 'users table is missing');
  assert.match(migrationText, /createTable\('bookings'/, 'bookings table is missing');
  assert.match(migrationText, /createTable\('partners'/, 'partners table is missing');
});
