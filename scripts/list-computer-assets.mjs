import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
config({ path: '.env.local' })
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const { data, error } = await supabase
  .from('profiles')
  .select('full_name,first_name,last_name,department,designation,office_location')
if (error) { console.error(error.message); process.exit(1) }

const names = ['joseph','lincoln','kleo','ann','anoint','peace','susan','mercy']
const hits = (data||[]).filter(p => {
  const n = `${p.full_name||''} ${p.first_name||''} ${p.last_name||''}`.toLowerCase()
  return names.some(q => n.includes(q))
})
console.log('TOTAL_PROFILES:', data.length)
console.log(JSON.stringify(hits.map(p=>({name:p.full_name||`${p.first_name||''} ${p.last_name||''}`.trim(),dept:p.department,desig:p.designation,office:p.office_location})), null, 1))
