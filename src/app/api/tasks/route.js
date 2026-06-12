import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { getUserFromRequest, getWorkspaceFromRequest } from '@/lib/session-helper'
import { sendTaskAssignedEmail } from '@/lib/notification-emails'

const TASK_SELECT = `*,
  assignee:users!tasks_assigned_to_fkey(id, name, email, profile_photo_url),
  creator:users!tasks_created_by_fkey(id, name),
  conversation:conversations!tasks_conversation_id_fkey(id, phone_number, from_number, name)`

function formatPhone(num) {
  if (!num) return ''
  const d = String(num).replace(/\D/g, '')
  const ten = d.length === 11 && d[0] === '1' ? d.slice(1) : d
  if (ten.length !== 10) return num
  return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`
}

// ── GET /api/tasks?status=&assignee=&conversation_id= ──
export async function GET(request) {
  try {
    const user = getUserFromRequest(request)
    const workspace = getWorkspaceFromRequest(request)
    if (!workspace?.workspaceId) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status') || 'todo'   // todo | completed | all
    const assignee = searchParams.get('assignee') || 'all' // me | all
    const conversationId = searchParams.get('conversation_id')

    let query = supabaseAdmin
      .from('tasks')
      .select(TASK_SELECT)
      .eq('workspace_id', workspace.workspaceId)
      .order('created_at', { ascending: false })

    if (status !== 'all') query = query.eq('status', status)
    if (assignee === 'me' && user?.userId) query = query.eq('assigned_to', user.userId)
    if (conversationId) query = query.eq('conversation_id', conversationId)

    const { data, error } = await query
    if (error) {
      console.error('Error fetching tasks:', error)
      return NextResponse.json({ error: 'Failed to fetch tasks' }, { status: 500 })
    }

    return NextResponse.json({ success: true, tasks: data || [] })
  } catch (error) {
    console.error('Error in tasks GET:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// ── POST /api/tasks ──
export async function POST(request) {
  try {
    const user = getUserFromRequest(request)
    const workspace = getWorkspaceFromRequest(request)
    if (!workspace?.workspaceId) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 401 })
    }

    const { conversation_id, title, description, assigned_to, due_date } = await request.json()

    if (!title?.trim()) {
      return NextResponse.json({ error: 'Task name is required' }, { status: 400 })
    }
    if (!conversation_id) {
      return NextResponse.json({ error: 'Conversation is required' }, { status: 400 })
    }

    const { data: task, error } = await supabaseAdmin
      .from('tasks')
      .insert({
        workspace_id: workspace.workspaceId,
        conversation_id,
        title: title.trim(),
        description: description?.trim() || null,
        assigned_to: assigned_to || null,
        due_date: due_date || null,
        created_by: user?.userId || null,
      })
      .select(TASK_SELECT)
      .single()

    if (error) {
      console.error('Error creating task:', error)
      return NextResponse.json({ error: 'Failed to create task' }, { status: 500 })
    }

    // Notify the assignee (skip self-assignment). Best-effort — never fail the task.
    if (assigned_to && assigned_to !== user?.userId) {
      try {
        await notifyAssignee({
          task,
          actorName: task.creator?.name || user?.name,
          workspaceId: workspace.workspaceId,
          actorId: user?.userId,
        })
      } catch (notifyErr) {
        console.error('Error notifying task assignee:', notifyErr)
      }
    }

    return NextResponse.json({ success: true, task })
  } catch (error) {
    console.error('Error in tasks POST:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// ── PUT /api/tasks?id= ──
export async function PUT(request) {
  try {
    const workspace = getWorkspaceFromRequest(request)
    if (!workspace?.workspaceId) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'Task ID is required' }, { status: 400 })

    const body = await request.json()
    const updateData = { updated_at: new Date().toISOString() }

    if (body.status !== undefined) {
      updateData.status = body.status
      updateData.completed_at = body.status === 'completed' ? new Date().toISOString() : null
    }
    if (body.title !== undefined) updateData.title = body.title?.trim() || null
    if (body.description !== undefined) updateData.description = body.description?.trim() || null
    if (body.assigned_to !== undefined) updateData.assigned_to = body.assigned_to || null
    if (body.due_date !== undefined) updateData.due_date = body.due_date || null

    const { data, error } = await supabaseAdmin
      .from('tasks')
      .update(updateData)
      .eq('id', id)
      .eq('workspace_id', workspace.workspaceId)
      .select(TASK_SELECT)
      .single()

    if (error) {
      console.error('Error updating task:', error)
      return NextResponse.json({ error: 'Failed to update task' }, { status: 500 })
    }

    return NextResponse.json({ success: true, task: data })
  } catch (error) {
    console.error('Error in tasks PUT:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// ── DELETE /api/tasks?id= ──
export async function DELETE(request) {
  try {
    const workspace = getWorkspaceFromRequest(request)
    if (!workspace?.workspaceId) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'Task ID is required' }, { status: 400 })

    const { error } = await supabaseAdmin
      .from('tasks')
      .delete()
      .eq('id', id)
      .eq('workspace_id', workspace.workspaceId)

    if (error) {
      console.error('Error deleting task:', error)
      return NextResponse.json({ error: 'Failed to delete task' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error in tasks DELETE:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// In-app notification + best-effort email for the assignee.
async function notifyAssignee({ task, actorName, workspaceId, actorId }) {
  // In-app notification (mirrors the conversation-notes mention pattern)
  const { error: notifError } = await supabaseAdmin.from('notifications').insert({
    workspace_id: workspaceId,
    recipient_id: task.assigned_to,
    actor_id: actorId,
    type: 'task_assigned',
    conversation_id: task.conversation_id,
    task_id: task.id,
    content: task.title.length > 120 ? task.title.slice(0, 120) + '...' : task.title,
  })
  if (notifError) console.error('Error creating task notification:', notifError)

  // Email
  const conv = task.conversation
  const conversationLabel = conv?.name || formatPhone(conv?.phone_number)
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.airophone.com'
  const link = conv?.from_number
    ? `${appUrl}/inbox?from=${encodeURIComponent(conv.from_number)}`
    : `${appUrl}/inbox`

  await sendTaskAssignedEmail({
    to: task.assignee?.email,
    recipientName: task.assignee?.name,
    actorName,
    taskTitle: task.title,
    taskDescription: task.description,
    dueDate: task.due_date,
    conversationLabel,
    link,
  })
}
