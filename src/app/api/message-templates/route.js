// src/app/api/message-templates/route.js

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { getUserFromRequest, getWorkspaceFromRequest } from '@/lib/session-helper'

// GET - Fetch all message templates
export async function GET(request) {
  try {
    const workspace = getWorkspaceFromRequest(request)

    if (!workspace || !workspace.workspaceId) {
      return NextResponse.json(
        { error: 'Workspace not found' },
        { status: 401 }
      )
    }

    console.log('Fetching message templates for workspace:', workspace.workspaceId)

    // Get templates filtered by workspace
    const { data: templates, error } = await supabaseAdmin
      .from('message_templates')
      .select('*')
      .eq('workspace_id', workspace.workspaceId)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Database error fetching templates:', error)
      return NextResponse.json(
        { error: 'Failed to fetch templates', details: error.message },
        { status: 500 }
      )
    }

    console.log(`Retrieved ${templates?.length || 0} templates`)

    return NextResponse.json({
      success: true,
      templates: templates || []
    })

  } catch (error) {
    console.error('Error in message templates GET API:', error)
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    )
  }
}

// POST - Create new message template
export async function POST(request) {
  try {
    const user = getUserFromRequest(request)
    const workspace = getWorkspaceFromRequest(request)

    if (!workspace || !workspace.workspaceId) {
      return NextResponse.json(
        { error: 'Workspace not found' },
        { status: 401 }
      )
    }

    const body = await request.json()
    console.log('Creating message template:', body)

    const {
      name,
      message_template,
      description,
      is_favorite
    } = body

    // Validate required fields
    if (!name?.trim()) {
      return NextResponse.json(
        { error: 'Template name is required' },
        { status: 400 }
      )
    }

    if (!message_template?.trim()) {
      return NextResponse.json(
        { error: 'Message template is required' },
        { status: 400 }
      )
    }

    // Create template
    const templateData = {
      name: name.trim(),
      message_template: message_template.trim(),
      description: description?.trim() || null,
      is_favorite: is_favorite || false,
      workspace_id: workspace.workspaceId,
      created_by: user.userId
    }

    const { data: template, error: templateError } = await supabaseAdmin
      .from('message_templates')
      .insert(templateData)
      .select()
      .single()

    if (templateError) {
      console.error('Database error creating template:', templateError)
      return NextResponse.json(
        { error: 'Failed to create template', details: templateError.message },
        { status: 500 }
      )
    }

    console.log('Message template created successfully:', template.id)

    return NextResponse.json({
      success: true,
      template: template
    })

  } catch (error) {
    console.error('Error in message templates POST API:', error)
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    )
  }
}

// PUT - Update message template
export async function PUT(request) {
  try {
    const workspace = getWorkspaceFromRequest(request)

    if (!workspace || !workspace.workspaceId) {
      return NextResponse.json(
        { error: 'Workspace not found' },
        { status: 401 }
      )
    }

    const { searchParams } = new URL(request.url)
    const templateId = searchParams.get('id')
    const body = await request.json()

    if (!templateId) {
      return NextResponse.json(
        { error: 'Template ID is required' },
        { status: 400 }
      )
    }

    console.log('Updating message template:', templateId, body)

    // Get existing template (workspace-filtered)
    const { data: existingTemplate, error: fetchError } = await supabaseAdmin
      .from('message_templates')
      .select('*')
      .eq('id', templateId)
      .eq('workspace_id', workspace.workspaceId)
      .single()

    if (fetchError || !existingTemplate) {
      return NextResponse.json(
        { error: 'Template not found' },
        { status: 404 }
      )
    }

    const {
      name,
      message_template,
      description,
      is_favorite
    } = body

    const updateData = {
      updated_at: new Date().toISOString()
    }
    if (name !== undefined) updateData.name = name.trim()
    if (message_template !== undefined) updateData.message_template = message_template.trim()
    if (description !== undefined) updateData.description = description?.trim() || null
    if (is_favorite !== undefined) updateData.is_favorite = is_favorite

    const { data: updatedTemplate, error: updateError } = await supabaseAdmin
      .from('message_templates')
      .update(updateData)
      .eq('id', templateId)
      .eq('workspace_id', workspace.workspaceId)
      .select()
      .single()

    if (updateError) {
      console.error('Database error updating template:', updateError)
      return NextResponse.json(
        { error: 'Failed to update template', details: updateError.message },
        { status: 500 }
      )
    }

    console.log('Message template updated successfully:', templateId)

    return NextResponse.json({
      success: true,
      template: updatedTemplate
    })

  } catch (error) {
    console.error('Error in message templates PUT API:', error)
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    )
  }
}

// DELETE - Delete message template
export async function DELETE(request) {
  try {
    const workspace = getWorkspaceFromRequest(request)

    if (!workspace || !workspace.workspaceId) {
      return NextResponse.json(
        { error: 'Workspace not found' },
        { status: 401 }
      )
    }

    const { searchParams } = new URL(request.url)
    const templateId = searchParams.get('id')

    if (!templateId) {
      return NextResponse.json(
        { error: 'Template ID is required' },
        { status: 400 }
      )
    }

    console.log('Deleting message template:', templateId)

    // Get template to verify it exists (workspace-filtered)
    const { data: template, error: fetchError } = await supabaseAdmin
      .from('message_templates')
      .select('id')
      .eq('id', templateId)
      .eq('workspace_id', workspace.workspaceId)
      .single()

    if (fetchError || !template) {
      return NextResponse.json(
        { error: 'Template not found' },
        { status: 404 }
      )
    }

    // Delete the template
    const { error: deleteError } = await supabaseAdmin
      .from('message_templates')
      .delete()
      .eq('id', templateId)
      .eq('workspace_id', workspace.workspaceId)

    if (deleteError) {
      console.error('Database error deleting template:', deleteError)
      return NextResponse.json(
        { error: 'Failed to delete template', details: deleteError.message },
        { status: 500 }
      )
    }

    console.log('Message template deleted successfully:', templateId)

    return NextResponse.json({
      success: true,
      message: 'Template deleted successfully'
    })

  } catch (error) {
    console.error('Error in message templates DELETE API:', error)
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    )
  }
}
