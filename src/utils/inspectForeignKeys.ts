import pool from '../config/database';

async function main() {
  const rows = await pool.query(
    `SELECT conname, conrelid::regclass AS table_name, confrelid::regclass AS ref_table
     FROM pg_constraint
     WHERE conname LIKE '%user_id_fkey'
     ORDER BY conname`,
  );
  console.log(JSON.stringify(rows.rows, null, 2));
  await pool.end();
}

if (require.main === module) {
  main().catch(async (error) => {
    console.error(error?.message || error);
    await pool.end();
    process.exit(1);
  });
}
