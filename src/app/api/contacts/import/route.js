//app/api/contacts/import/route.js

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { getUserFromRequest, getWorkspaceFromRequest } from '@/lib/session-helper'

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
    
    // Split lines and filter out empty ones
    const lines = csvText
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line.length > 0)

    console.log('Total lines:', lines.length)

    if (lines.length < 2) {
      return NextResponse.json(
        { error: 'CSV must have at least a header row and one data row' },
        { status: 400 }
      )
    }

    // Parse header line
    const headerLine = lines[0]
    console.log('Header line:', headerLine)
    
    const headers = parseCSVLine(headerLine).map(h => h.toLowerCase().trim())
    console.log('Parsed headers:', headers)

    // Find name columns — support first_name/last_name OR business_name/company/name
    const firstNameIndex = headers.findIndex(h => h === 'firstname' || h === 'first_name' || h === 'first name')
    const lastNameIndex = headers.findIndex(h => h === 'lastname' || h === 'last_name' || h === 'last name')
    const businessNameIndex = headers.findIndex(h =>
      (h.includes('business') && h.includes('name')) || h === 'company' || h === 'company name'
    )
    const genericNameIndex = businessNameIndex !== -1 ? businessNameIndex
      : (firstNameIndex === -1 && lastNameIndex === -1 ? headers.findIndex(h => h.includes('name')) : -1)

    // Find phone column — support phone_number_1, phone_1, phone, etc.
    const phoneIndex = headers.findIndex(h => h === 'phone_number_1' || h === 'phone_number' || h === 'phone_1')
      !== -1 ? headers.findIndex(h => h === 'phone_number_1' || h === 'phone_number' || h === 'phone_1')
      : headers.findIndex(h => h.includes('phone'))

    console.log('Column indices - firstName:', firstNameIndex, 'lastName:', lastNameIndex,
      'businessName:', businessNameIndex, 'genericName:', genericNameIndex, 'phone:', phoneIndex)

    if (phoneIndex === -1) {
      return NextResponse.json(
        { error: 'CSV must contain a phone number column (phone, phone_number, phone_number_1)' },
        { status: 400 }
      )
    }

    const hasNameColumn = firstNameIndex !== -1 || lastNameIndex !== -1 || businessNameIndex !== -1 || genericNameIndex !== -1
    if (!hasNameColumn) {
      return NextResponse.json(
        { error: 'CSV must contain a name column (first_name, last_name, business_name, company, or name)' },
        { status: 400 }
      )
    }

    // Find optional columns
    const emailIndex = headers.findIndex(h => h === 'email_1' || h === 'email')
    const cityIndex = headers.findIndex(h => h.includes('city'))
    const stateIndex = headers.findIndex(h => h.includes('state'))
    const countryIndex = headers.findIndex(h => h.includes('country'))

    // Parse data rows
    const contacts = []
    const errors = []

    for (let i = 1; i < lines.length; i++) {
      try {
        const values = parseCSVLine(lines[i])
        console.log(`Row ${i}:`, values)

        const first_name = firstNameIndex !== -1 ? values[firstNameIndex]?.trim() || null : null
        const last_name = lastNameIndex !== -1 ? values[lastNameIndex]?.trim() || null : null
        const business_name = businessNameIndex !== -1
          ? values[businessNameIndex]?.trim() || null
          : genericNameIndex !== -1 ? values[genericNameIndex]?.trim() || null : null

        const phone_number = values[phoneIndex]?.trim()

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
          email: emailIndex !== -1 ? (values[emailIndex]?.trim() || null) : null,
          city: cityIndex !== -1 ? (values[cityIndex]?.trim() || null) : null,
          state: stateIndex !== -1 ? (values[stateIndex]?.trim() || null) : null,
          country: countryIndex !== -1 ? (values[countryIndex]?.trim() || null) : null,
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
          
          // Handle duplicate phone numbers
          if (error.code === '23505') {
            duplicateCount += batch.length
            console.log('Duplicate phone numbers in batch')
          } else {
            console.error('Other database error:', error.message)
            // Try individual inserts to see which ones work
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

// Helper function to parse CSV line handling quotes and commas
function parseCSVLine(line) {
  const result = []
  let current = ''
  let inQuotes = false
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    const nextChar = line[i + 1]
    
    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"'
        i++ // Skip next quote
      } else {
        inQuotes = !inQuotes
      }
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