import { neon } from "@neondatabase/serverless"
import * as dotenv from "dotenv"
import * as path from "path"

dotenv.config({ path: path.resolve(__dirname, "../.env.local") })

const sqlQuery = `
  ALTER TABLE public.assets DROP CONSTRAINT IF EXISTS assets_department_check;
  ALTER TABLE public.assets ADD CONSTRAINT assets_department_check CHECK (
    department IS NULL OR department = ANY (ARRAY[
      'Accounts',
      'Admin and HR',
      'Business, Growth and Innovation',
      'Corporate Services',
      'Executive Management',
      'IT and Communications',
      'Legal, Regulatory and Compliance',
      'Logistics',
      'Monitoring and Evaluation',
      'Operations',
      'Project',
      'Technical'
    ])
  );
`

async function main() {
  const connectionString = process.env.SUPABASE_POSTGRES_URL_NON_POOLING || process.env.SUPABASE_POSTGRES_URL
  if (!connectionString) {
    console.error("No connection string found in .env.local")
    process.exit(1)
  }

  console.log("Connecting to database...")
  const sql = neon(connectionString)

  try {
    console.log("Executing SQL to fix constraint...")
    await sql.query(sqlQuery)
    console.log("✅ Constraint fixed successfully!")
  } catch (error) {
    console.error("❌ Failed to fix constraint:", error)
    process.exit(1)
  }
}

main()
