import { Client } from "pg"

const client = new Client({
  user: process.env.PGUSER || "postgres",
  password: process.env.PGPASSWORD || process.env.SUPABASE_DB_PASSWORD || "",
  host: process.env.PGHOST || "aws-1-eu-central-1.pooler.supabase.com",
  port: Number(process.env.PGPORT) || 5432,
  database: process.env.PGDATABASE || "postgres",
  ssl: {
    rejectUnauthorized: false,
  },
})

async function main() {
  await client.connect()

  console.log("Searching for tables containing 'ACOB/SIWES/2026/002'...")

  // Find all character columns in all tables
  const columnsRes = await client.query(`
    SELECT table_schema, table_name, column_name 
    FROM information_schema.columns 
    WHERE data_type IN ('character varying', 'text', 'character')
      AND table_schema = 'public'
  `)

  for (const row of columnsRes.rows) {
    const { table_schema, table_name, column_name } = row
    try {
      const searchRes = await client.query(
        `SELECT COUNT(*) FROM "${table_schema}"."${table_name}" WHERE "${column_name}" = $1`,
        ["ACOB/SIWES/2026/002"]
      )
      const count = parseInt(searchRes.rows[0].count, 10)
      if (count > 0) {
        console.log(`Found in: "${table_schema}"."${table_name}"."${column_name}" (${count} occurrences)`)
      }
    } catch (e) {
      // Skip views or system tables that might error
    }
  }

  await client.end()
}

main().catch(async (err) => {
  console.error(err)
  await client.end().catch(() => {})
})
