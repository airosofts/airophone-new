// PostgREST hard-caps EVERY response at 1000 rows (max-rows), and neither
// .limit() nor .range() can exceed it. So any query that needs a whole big
// contact list MUST page through in ≤1000-row chunks. This helper does that.

import { supabaseAdmin } from '@/lib/supabase-server'

const PAGE = 1000

// Fetch ALL contacts for a workspace (optionally narrowed to contact lists),
// paging past the 1000-row cap. `columns` is a PostgREST select string.
export async function fetchAllContacts({ workspaceId, contactListIds = null, columns = '*', max = 50000, ascending = true }) {
  const out = []
  for (let from = 0; from < max; from += PAGE) {
    let q = supabaseAdmin
      .from('contacts')
      .select(columns)
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending })
      .range(from, from + PAGE - 1)
    if (Array.isArray(contactListIds) && contactListIds.length > 0) {
      q = q.in('contact_list_id', contactListIds)
    }
    const { data, error } = await q
    if (error) throw error
    out.push(...(data || []))
    if (!data || data.length < PAGE) break   // last page
  }
  return out
}
