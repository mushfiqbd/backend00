import fs from 'fs';
import path from 'path';
import pool from '../config/database';

async function main() {
  const relPath = process.argv[2];
  if (!relPath) {
    throw new Error('Usage: ts-node src/utils/applySqlMigration.ts <relative-sql-path>');
  }

  const absPath = path.resolve(process.cwd(), relPath);
  const sql = fs.readFileSync(absPath, 'utf8');
  await pool.query(sql);
  console.log(`Applied SQL migration: ${absPath}`);
  await pool.end();
}

if (require.main === module) {
  main().catch(async (error) => {
    console.error('Apply migration failed:', error?.message || error);
    await pool.end();
    process.exit(1);
  });
}
