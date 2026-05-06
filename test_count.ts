import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321'
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'your-anon-key'

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
async function test() {
  const { count, error } = await supabase.from('profiles').select('id, posts!inner(id)', { count: 'exact', head: true })
  console.log({count, error})
}
test()
