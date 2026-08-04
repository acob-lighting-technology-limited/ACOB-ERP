import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config({ path: '.env.local' })

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
)

async function run() {
  const { data: cols, error } = await supabase
    .from('assets')
    .select('*')
    .limit(1)

  if (error) {
    console.error('Error:', error)
    process.exit(1)
  }

  console.log('SAMPLE ROW:', JSON.stringify(cols[0], null, 2))
}

run()
