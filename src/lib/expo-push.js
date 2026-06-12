// Sends push notifications to mobile devices via Expo's push service.
// https://docs.expo.dev/push-notifications/sending-notifications/
import { supabaseAdmin } from '@/lib/supabase-server'

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send'

// Fetch all registered device tokens for a workspace.
async function tokensForWorkspace(workspaceId) {
  if (!workspaceId) return []
  const { data } = await supabaseAdmin
    .from('device_push_tokens')
    .select('token')
    .eq('workspace_id', workspaceId)
  return (data || []).map((r) => r.token).filter((t) => t && t.startsWith('ExponentPushToken'))
}

// Send a push to every device in a workspace. Non-blocking best-effort —
// callers should not await this on the hot path (fire and forget).
export async function sendPushToWorkspace(workspaceId, { title, body, data, channelId = 'default', priority = 'high' }) {
  try {
    const tokens = await tokensForWorkspace(workspaceId)
    if (!tokens.length) return

    const messages = tokens.map((to) => ({
      to,
      title,
      body,
      data: data || {},
      sound: 'default',
      priority,
      channelId,
    }))

    // Expo accepts up to 100 messages per request.
    for (let i = 0; i < messages.length; i += 100) {
      const batch = messages.slice(i, i + 100)
      const res = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(batch),
      })
      if (!res.ok) {
        const txt = await res.text().catch(() => '')
        console.error('[expo-push] send failed:', res.status, txt.slice(0, 200))
      }
    }
  } catch (e) {
    console.error('[expo-push] error:', e.message)
  }
}
