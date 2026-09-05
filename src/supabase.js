import { createClient } from '@supabase/supabase-js'

const projectUrl = import.meta.env.VITE_SUPABASE_URL
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

if (!projectUrl || !publishableKey) {
  throw new Error('Missing Supabase Vite environment variables.')
}

export const supabase = createClient(projectUrl, publishableKey, {
  // Expense writes are not idempotent, so they should never be retried automatically.
  db: { retry: false },
})
