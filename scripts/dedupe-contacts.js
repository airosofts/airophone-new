// One-time contact de-duplication.
//
// Problem: the same (workspace, phone) accumulated many rows —
//   1. orphan rows with contact_list_id = NULL created by the by-phone .single()
//      bug each time a status was set, and
//   2. true in-list duplicates (same workspace+phone+list) from imports.
//
// Strategy (LOSSLESS for list membership + compliance):
//   • Group by (workspace_id, phone_number) = one real person.
//   • Canonical status for the person: do_not_call wins if present (compliance),
//     else the most-recent non-null status. Applied to every survivor.
//   • Keep ONE survivor per (workspace, phone, contact_list_id) so multi-list
//     membership is preserved. Prefer the most-complete row, then oldest.
//   • Orphan NULL-list rows are dropped IF the person has any list row; if the
//     person is ONLY orphan rows, keep one.
//   • Re-point voicemail_campaign_sends.contact_id from deleted → a survivor.
//
// Usage:  node scripts/dedupe-contacts.js          (dry run — deletes nothing)
//         node scripts/dedupe-contacts.js --execute (apply)

const fs = require('fs')
const env = fs.readFileSync(require('path').join(__dirname, '..', '.env.local'), 'utf8')
const get = (k) => { const m = env.match(new RegExp('^' + k + '=(.*)$', 'm')); return m ? m[1].trim().replace(/^["']|["']$/g, '') : null }
const sb = require('@supabase/supabase-js').createClient(
  get('NEXT_PUBLIC_SUPABASE_URL') || get('SUPABASE_URL'),
  get('SUPABASE_SERVICE_ROLE_KEY') || get('SUPABASE_SERVICE_KEY')
)
const EXECUTE = process.argv.includes('--execute')

// Suppress statuses outrank positives; do_not_call is absolute.
const SUPPRESS = ['do_not_call', 'wrong_number', 'disconnected', 'under_contract', 'already_sold', 'renter', 'not_interested']
function canonicalStatus(rows) {
  if (rows.some(r => r.status === 'do_not_call')) return 'do_not_call'
  const withStatus = rows.filter(r => r.status).sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
  const suppress = withStatus.find(r => SUPPRESS.includes(r.status))
  return (suppress || withStatus[0])?.status || null
}
function completeness(r) {
  return (r.first_name ? 1 : 0) + (r.last_name ? 1 : 0) + (r.business_name ? 1 : 0) + (r.email ? 1 : 0)
}

async function main() {
  // Pull all contacts.
  const all = []; let from = 0
  while (true) {
    const { data, error } = await sb.from('contacts')
      .select('id,workspace_id,phone_number,contact_list_id,status,first_name,last_name,business_name,email,created_at')
      .range(from, from + 999)
    if (error) throw error
    if (!data || !data.length) break
    all.push(...data); if (data.length < 1000) break; from += 1000
  }
  console.log('Total contacts:', all.length)

  // Group by person.
  const persons = new Map()
  for (const c of all) {
    const k = c.workspace_id + '|' + c.phone_number
    if (!persons.has(k)) persons.set(k, [])
    persons.get(k).push(c)
  }

  const toDelete = []          // contact ids to delete
  const statusUpdates = []     // { id, status } for survivors
  const repoint = new Map()    // deletedId -> survivorId
  let personsWithDupes = 0

  for (const rows of persons.values()) {
    if (rows.length === 1) continue
    const canon = canonicalStatus(rows)
    const listRows = rows.filter(r => r.contact_list_id)
    const orphanRows = rows.filter(r => !r.contact_list_id)

    // Survivors: one per list group.
    const survivors = []
    const byList = new Map()
    for (const r of listRows) {
      if (!byList.has(r.contact_list_id)) byList.set(r.contact_list_id, [])
      byList.get(r.contact_list_id).push(r)
    }
    for (const group of byList.values()) {
      group.sort((a, b) => completeness(b) - completeness(a) || new Date(a.created_at) - new Date(b.created_at))
      survivors.push(group[0])
      group.slice(1).forEach(r => toDelete.push(r.id))
    }
    // Orphans: keep one only if there are no list survivors.
    if (survivors.length === 0 && orphanRows.length > 0) {
      orphanRows.sort((a, b) => completeness(b) - completeness(a) || new Date(a.created_at) - new Date(b.created_at))
      survivors.push(orphanRows[0])
      orphanRows.slice(1).forEach(r => toDelete.push(r.id))
    } else {
      orphanRows.forEach(r => toDelete.push(r.id))
    }

    if (rows.length > survivors.length) personsWithDupes++
    // Canonical status onto every survivor that doesn't already match.
    for (const s of survivors) if ((s.status || null) !== (canon || null)) statusUpdates.push({ id: s.id, status: canon })
    // Re-point deleted rows to a primary survivor.
    const primary = survivors[0]
    if (primary) for (const r of rows) if (toDelete.includes(r.id)) repoint.set(r.id, primary.id)
  }

  console.log('Persons with duplicates:', personsWithDupes)
  console.log('Rows to DELETE:', toDelete.length)
  console.log('Survivor status updates:', statusUpdates.length)

  // Every table that references contacts.id must be re-pointed before delete.
  const REF_TABLES = ['voicemail_campaign_sends', 'campaign_messages']
  const delSet = [...repoint.keys()]
  for (const t of REF_TABLES) {
    let n = 0
    for (let i = 0; i < delSet.length; i += 200) {
      const { count } = await sb.from(t).select('id', { count: 'exact', head: true }).in('contact_id', delSet.slice(i, i + 200))
      n += count || 0
    }
    console.log(`${t} rows to re-point:`, n)
  }

  if (!EXECUTE) { console.log('\n[DRY RUN] Nothing changed. Re-run with --execute to apply.'); return }

  console.log('\n[EXECUTE] Applying…')
  // 1) Status updates on survivors.
  let su = 0
  for (const u of statusUpdates) { await sb.from('contacts').update({ status: u.status }).eq('id', u.id); su++ }
  console.log('  survivor statuses set:', su)

  // 2) Re-point EVERY referencing table off the doomed rows FIRST (one pass).
  for (const t of REF_TABLES) {
    let moved = 0, dropped = 0, sampleErr = null
    for (const id of delSet) {
      const sv = repoint.get(id)
      const { error } = await sb.from(t).update({ contact_id: sv }).eq('contact_id', id)
      if (!error) { moved++; continue }
      // Re-point collided (the survivor already has a row for that campaign —
      // the doomed row is a duplicate send to the SAME person). Drop the
      // redundant referencing rows so the duplicate contact can be removed.
      if (!sampleErr) sampleErr = error.message
      await sb.from(t).delete().eq('contact_id', id)
      dropped++
    }
    console.log(`  ${t}: re-pointed=${moved}, redundant-dropped=${dropped}${sampleErr ? ` (e.g. "${sampleErr.slice(0, 60)}")` : ''}`)
    // Verify nothing in this table still points at a doomed row.
    let remaining = 0
    for (let i = 0; i < delSet.length; i += 200) {
      const { count } = await sb.from(t).select('id', { count: 'exact', head: true }).in('contact_id', delSet.slice(i, i + 200))
      remaining += count || 0
    }
    if (remaining > 0) { console.error(`  ABORT: ${t} still has ${remaining} refs to doomed rows, not deleting.`); return }
  }

  // 3) Now safe to delete.
  let del = 0
  for (let i = 0; i < delSet.length; i += 200) {
    const chunk = delSet.slice(i, i + 200)
    const { error } = await sb.from('contacts').delete().in('id', chunk)
    if (error) { console.error('  delete error:', error.message); return }
    del += chunk.length
    if (del % 1000 === 0) console.log('  …deleted', del)
  }
  console.log('  contacts deleted:', del)
  console.log('Done.')
}
main().catch(e => { console.error(e); process.exit(1) })
