// One-time import script for ORMtc3QbS7_contacts.csv
// Run with: node import-contacts.mjs

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const SUPABASE_URL = 'https://sebaeihdyfhbkqmmrjbh.supabase.co'
const SUPABASE_SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNlYmFlaWhkeWZoYmtxbW1yamJoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NDkwMzYxNSwiZXhwIjoyMDcwNDc5NjE1fQ.E1bMIJvPWLw72wkLfjpj4SVsYqkoeigbs_cqKrv93cQ'
const WORKSPACE_ID = '9716ad4a-1a21-40de-bf7d-42f825111005'
const CSV_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'ORMtc3QbS7_contacts.csv')

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

function parseCSVLine(line) {
  const result = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    const nextChar = line[i + 1]
    if (char === '"') {
      if (inQuotes && nextChar === '"') { current += '"'; i++ }
      else inQuotes = !inQuotes
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }
  result.push(current.trim())
  return result
}

function formatPhone(phone) {
  if (!phone) return null
  const clean = phone.replace(/\D/g, '')
  if (phone.startsWith('+')) return phone
  if (clean.length === 10) return '+1' + clean
  if (clean.length === 11 && clean.startsWith('1')) return '+' + clean
  return '+1' + clean
}

async function main() {
  console.log('Reading CSV...')
  const csvText = readFileSync(CSV_PATH, 'utf-8')
  const lines = csvText.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0)
  console.log('Total lines (incl header):', lines.length)

  const headers = parseCSVLine(lines[0]).map(h => h.toLowerCase().trim())
  const firstNameIdx = headers.indexOf('firstname')
  const lastNameIdx = headers.indexOf('lastname')
  const companyIdx = headers.indexOf('company')
  const phoneIdx = headers.indexOf('phone_number_1')
  const emailIdx = headers.indexOf('email_1')

  const contacts = []
  const skipped = []

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i])
    const phone_raw = values[phoneIdx] ? values[phoneIdx].trim() : ''
    if (!phone_raw) { skipped.push('Row ' + (i+1) + ': no phone'); continue }

    const phone_number = formatPhone(phone_raw)
    const first_name = firstNameIdx >= 0 ? (values[firstNameIdx] ? values[firstNameIdx].trim() : null) : null
    const last_name = lastNameIdx >= 0 ? (values[lastNameIdx] ? values[lastNameIdx].trim() : null) : null
    const business_name = companyIdx >= 0 ? (values[companyIdx] ? values[companyIdx].trim() : null) : null
    const email = emailIdx >= 0 ? (values[emailIdx] ? values[emailIdx].trim() : null) : null

    if (!first_name && !last_name && !business_name) {
      skipped.push('Row ' + (i+1) + ': no name')
      continue
    }

    contacts.push({ first_name, last_name, business_name, phone_number, email, workspace_id: WORKSPACE_ID })
  }

  console.log('Parsed', contacts.length, 'valid contacts,', skipped.length, 'skipped')

  const BATCH = 50
  let imported = 0, duplicates = 0, errors = 0

  for (let i = 0; i < contacts.length; i += BATCH) {
    const batch = contacts.slice(i, i + BATCH)
    const { data, error } = await supabase.from('contacts').insert(batch).select('id')

    if (error) {
      if (error.code === '23505') {
        for (const c of batch) {
          const { data: d, error: e } = await supabase.from('contacts').insert(c).select('id')
          if (!e) imported += (d ? d.length : 1)
          else if (e.code === '23505') duplicates++
          else { errors++; console.error('  Error:', c.phone_number, e.message) }
        }
      } else {
        console.error('Batch error:', error.message)
        errors += batch.length
      }
    } else {
      imported += data ? data.length : batch.length
    }

    const done = Math.min(i + BATCH, contacts.length)
    if (done % 500 < BATCH || done === contacts.length) {
      console.log('Progress:', done + '/' + contacts.length, '— imported:', imported, 'dupes:', duplicates, 'errors:', errors)
    }
  }

  console.log('\n=== Import Complete ===')
  console.log('Imported:  ', imported)
  console.log('Duplicates:', duplicates)
  console.log('Errors:    ', errors)
  console.log('Skipped rows:', skipped.length)
}

main().catch(console.error)
