//app/api/contacts/import/route.js

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { getUserFromRequest, getWorkspaceFromRequest } from '@/lib/session-helper'

// POST /api/contacts/import/parse — parse CSV headers only (for column mapping UI)
export async function GET(request) {
  // This endpoint is not used; header parsing happens client-side
  return NextResponse.json({ error: 'Use POST' }, { status: 405 })
}

export async function POST(request) {
  try {
    console.log('=== CSV Import API Called ===')

    const user = getUserFromRequest(request)
    const workspace = getWorkspaceFromRequest(request)

    if (!workspace || !workspace.workspaceId) {
      return NextResponse.json(
        { error: 'Workspace not found' },
        { status: 401 }
      )
    }

    console.log('User ID:', user.userId)
    console.log('Workspace ID:', workspace.workspaceId)

    const formData = await request.formData()
    const file = formData.get('file')
    const contactListId = formData.get('contact_list_id') || null
    // column_mapping: JSON string like { "csv_header": "field_name_or_custom:key" }
    const columnMappingRaw = formData.get('column_mapping')
    const columnMapping = columnMappingRaw ? JSON.parse(columnMappingRaw) : null

    console.log('Form data:', {
      fileName: file?.name,
      fileType: file?.type,
      fileSize: file?.size,
      contactListId
    })

    if (!file) {
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400 }
      )
    }

    // Verify contact list exists if provided
    let contactList = null
    if (contactListId) {
      const { data: listData, error: listError } = await supabaseAdmin
        .from('contact_lists')
        .select('id, name')
        .eq('id', contactListId)
        .single()

      if (listError || !listData) {
        console.error('Contact list not found:', listError)
        return NextResponse.json(
          { error: 'Contact list not found' },
          { status: 404 }
        )
      }
      contactList = listData
      console.log('Contact list found:', contactList.name)
    }

    // Read and parse CSV
    const csvText = await file.text()
    console.log('CSV content length:', csvText.length)
    console.log('CSV preview (first 200 chars):', csvText.substring(0, 200))

    // Parse the entire CSV at once (handles quoted fields with embedded commas/newlines)
    const rows = parseCSV(csvText).filter(row => row.some(cell => cell.length > 0))

    console.log('Total rows:', rows.length)

    if (rows.length < 2) {
      return NextResponse.json(
        { error: 'CSV must have at least a header row and one data row' },
        { status: 400 }
      )
    }

    const headers = rows[0].map(h => h.toLowerCase().trim())
    console.log('Parsed headers:', headers)

    // Build field mapping: header index -> field assignment
    // If columnMapping provided (from UI), use it. Otherwise auto-detect.
    const STANDARD_FIELDS = ['first_name', 'last_name', 'business_name', 'phone_number', 'email', 'city', 'state', 'country']

    // headerFieldMap[i] = 'first_name' | 'phone_number' | 'custom:some_key' | 'skip'
    const headerFieldMap = headers.map((h, i) => {
      if (columnMapping) {
        // Use provided mapping (keyed by original header)
        const originalHeader = rows[0][i]?.trim() || h
        return columnMapping[originalHeader] || 'skip'
      }
      // Auto-detect
      if (h === 'firstname' || h === 'first_name' || h === 'first name') return 'first_name'
      if (h === 'lastname' || h === 'last_name' || h === 'last name') return 'last_name'
      if ((h.includes('business') && h.includes('name')) || h === 'company' || h === 'company name') return 'business_name'
      if (h === 'phone_number_1' || h === 'phone_number' || h === 'phone_1' || h.includes('phone')) return 'phone_number'
      if (h === 'email_1' || h === 'email') return 'email'
      if (h.includes('city')) return 'city'
      if (h.includes('state')) return 'state'
      if (h.includes('country')) return 'country'
      if (h === 'name' && !headers.some(hh => hh.includes('first') || hh.includes('last'))) return 'business_name'
      return 'skip'
    })

    const phoneIndex = headerFieldMap.indexOf('phone_number')
    const hasNameMapping = headerFieldMap.some(f => f === 'first_name' || f === 'last_name' || f === 'business_name')

    console.log('Header field map:', headers.map((h, i) => `${h}→${headerFieldMap[i]}`))

    if (phoneIndex === -1) {
      return NextResponse.json(
        { error: 'CSV must contain a phone number column (phone, phone_number, phone_number_1)' },
        { status: 400 }
      )
    }

    if (!hasNameMapping) {
      return NextResponse.json(
        { error: 'CSV must contain a name column (first_name, last_name, business_name, company, or name)' },
        { status: 400 }
      )
    }

    // Parse data rows
    const contacts = []
    const errors = []

    for (let i = 1; i < rows.length; i++) {
      try {
        const values = rows[i]
        console.log(`Row ${i}:`, values)

        const standard = {}
        const custom_fields = {}

        headerFieldMap.forEach((field, idx) => {
          const val = values[idx]?.trim() || null
          if (!val || field === 'skip') return
          if (field.startsWith('custom:')) {
            custom_fields[field.slice(7)] = val
          } else {
            standard[field] = val
          }
        })

        const phone_number = standard.phone_number
        const first_name = standard.first_name || null
        const last_name = standard.last_name || null
        const business_name = standard.business_name || null

        if (!phone_number) {
          errors.push(`Row ${i + 1}: Missing phone number`)
          continue
        }

        if (!first_name && !last_name && !business_name) {
          errors.push(`Row ${i + 1}: Missing name (first_name, last_name, or business_name)`)
          continue
        }

        // Format phone number
        const cleanPhone = phone_number.replace(/\D/g, '')
        let formattedPhone

        if (cleanPhone.length === 10) {
          formattedPhone = `+1${cleanPhone}`
        } else if (cleanPhone.length === 11 && cleanPhone.startsWith('1')) {
          formattedPhone = `+${cleanPhone}`
        } else if (phone_number.startsWith('+')) {
          formattedPhone = phone_number
        } else {
          formattedPhone = `+1${cleanPhone}`
        }

        const contact = {
          first_name,
          last_name,
          business_name,
          phone_number: formattedPhone,
          email: standard.email || null,
          city: standard.city || null,
          state: standard.state || null,
          country: standard.country || null,
          custom_fields: Object.keys(custom_fields).length > 0 ? custom_fields : null,
          contact_list_id: contactListId || null,
          workspace_id: workspace.workspaceId,
          created_by: user.userId
        }

        contacts.push(contact)

      } catch (rowError) {
        console.error(`Error parsing row ${i + 1}:`, rowError)
        errors.push(`Row ${i + 1}: ${rowError.message}`)
      }
    }

    console.log(`Parsed ${contacts.length} valid contacts`)
    console.log('Sample contact:', contacts[0])

    if (contacts.length === 0) {
      return NextResponse.json(
        { 
          error: 'No valid contacts found in CSV',
          details: errors.slice(0, 5)
        },
        { status: 400 }
      )
    }

    // Insert contacts in batches
    const batchSize = 25
    let importedCount = 0
    let duplicateCount = 0

    for (let i = 0; i < contacts.length; i += batchSize) {
      const batch = contacts.slice(i, i + batchSize)
      console.log(`Inserting batch ${Math.floor(i/batchSize) + 1}:`, batch.length, 'contacts')
      
      try {
        const { data, error } = await supabaseAdmin
          .from('contacts')
          .insert(batch)
          .select('id')

        if (error) {
          console.error('Database error inserting batch:', error)
          // Whether it's a duplicate conflict (23505) or any other error,
          // fall back to individual inserts so only the conflicting rows are
          // skipped and the rest are imported successfully.
          for (const contact of batch) {
            try {
              const { data: singleData, error: singleError } = await supabaseAdmin
                .from('contacts')
                .insert([contact])
                .select('id')

              if (!singleError) {
                importedCount++
              } else if (singleError.code === '23505') {
                duplicateCount++
              } else {
                console.error('Error inserting single contact:', singleError)
              }
            } catch (singleInsertError) {
              console.error('Single insert error:', singleInsertError)
            }
          }
        } else {
          importedCount += data?.length || batch.length
          console.log(`Successfully inserted ${data?.length || batch.length} contacts`)
        }

      } catch (batchError) {
        console.error('Batch insert error:', batchError)
      }
    }

    const response = {
      success: true,
      imported: importedCount,
      duplicates: duplicateCount,
      total: contacts.length,
      errors: errors.length,
      message: `Successfully imported ${importedCount} contacts${contactList ? ` to "${contactList.name}"` : ''}`
    }

    if (duplicateCount > 0) {
      response.message += `. ${duplicateCount} contacts were skipped due to duplicate phone numbers.`
    }

    console.log('Import completed:', response)

    return NextResponse.json(response)

  } catch (error) {
    console.error('=== CSV Import API Error ===')
    console.error('Error message:', error.message)
    console.error('Error stack:', error.stack)
    
    return NextResponse.json(
      { 
        error: 'Internal server error',
        details: error.message 
      },
      { status: 500 }
    )
  }
}

// RFC 4180-compliant CSV parser — handles quoted fields with embedded commas and newlines
function parseCSV(text) {
  const rows = []
  let row = []
  let cell = ''
  let inQuotes = false
  let i = 0

  while (i < text.length) {
    const ch = text[i]
    const next = text[i + 1]

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"'
        i += 2
      } else if (ch === '"') {
        inQuotes = false
        i++
      } else {
        cell += ch
        i++
      }
    } else {
      if (ch === '"') {
        inQuotes = true
        i++
      } else if (ch === ',') {
        row.push(cell.trim())
        cell = ''
        i++
      } else if (ch === '\r' && next === '\n') {
        row.push(cell.trim())
        rows.push(row)
        row = []
        cell = ''
        i += 2
      } else if (ch === '\n' || ch === '\r') {
        row.push(cell.trim())
        rows.push(row)
        row = []
        cell = ''
        i++
      } else {
        cell += ch
        i++
      }
    }
  }

  // Push last cell/row
  if (cell.length > 0 || row.length > 0) {
    row.push(cell.trim())
    rows.push(row)
  }

  return rows
}