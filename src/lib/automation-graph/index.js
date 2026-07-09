// Pure mapping between an automation row and a React-Flow {nodes, edges} graph.
// No React, no DB — safe to import from both client components and node --test.

export const NODE = { TRIGGER: 'trigger', WAIT: 'wait', SEND: 'send', SYNC: 'sync' }

const COL = 300, ROW = 60

// Build a canvas graph for an automation. Prefer the stored graph; otherwise
// synthesize the 4 nodes (trigger, wait, send, [sync]) from the flat columns
// and lay them out left-to-right so pre-existing automations still render.
export function buildGraphFromAutomation(automation = {}) {
  if (automation.graph && Array.isArray(automation.graph.nodes) && automation.graph.nodes.length) {
    return automation.graph
  }
  const isSheets = automation.source === 'sheets' || automation.spreadsheet_id != null
  const nodes = []
  nodes.push({
    id: 'trigger', type: NODE.TRIGGER, position: { x: 40, y: ROW },
    data: isSheets
      ? { spreadsheet_id: automation.spreadsheet_id, spreadsheet_name: automation.spreadsheet_name, sheet_id: automation.sheet_id, sheet_name: automation.sheet_name, phone_column: automation.phone_column }
      : { board_id: automation.board_id, board_name: automation.board_name, trigger_event: automation.trigger_event || 'create_item', phone_column_id: automation.phone_column_id },
  })
  nodes.push({
    id: 'wait', type: NODE.WAIT, position: { x: 40 + COL, y: ROW },
    data: { send_delay_seconds: automation.send_delay_seconds ?? 0, business_hours_mode: automation.business_hours_mode || 'anytime' },
  })
  nodes.push({
    id: 'send', type: NODE.SEND, position: { x: 40 + COL * 2, y: ROW },
    data: { sender_phone_number_id: automation.sender_phone_number_id, message_mode: automation.message_mode || 'template', message_template: automation.message_template || '', ai_instructions: automation.ai_instructions || '' },
  })
  const edges = [
    { id: 'e-trigger-wait', source: 'trigger', target: 'wait' },
    { id: 'e-wait-send', source: 'wait', target: 'send' },
  ]
  return { nodes, edges }
}

// Flatten a canvas graph to the existing columns for the given source.
// Returns { ...columns, graph } — the caller sends this straight to the API.
export function flattenGraphToPayload(graph, source = 'monday') {
  const byType = Object.fromEntries((graph.nodes || []).map(n => [n.type, n.data || {}]))
  const t = byType[NODE.TRIGGER] || {}
  const w = byType[NODE.WAIT] || {}
  const s = byType[NODE.SEND] || {}
  const common = {
    message_mode: s.message_mode || 'template',
    message_template: s.message_mode === 'ai' ? null : (s.message_template || ''),
    ai_instructions: s.message_mode === 'ai' ? (s.ai_instructions || '') : null,
    sender_phone_number_id: s.sender_phone_number_id,
    send_delay_seconds: Number(w.send_delay_seconds) || 0,
    business_hours_mode: ['anytime', 'within', 'outside'].includes(w.business_hours_mode) ? w.business_hours_mode : 'anytime',
    graph,
  }
  if (source === 'sheets') {
    return { ...common, source: 'sheets', spreadsheet_id: t.spreadsheet_id, spreadsheet_name: t.spreadsheet_name, sheet_id: t.sheet_id, sheet_name: t.sheet_name, phone_column: t.phone_column }
  }
  return { ...common, source: 'monday', board_id: t.board_id, board_name: t.board_name, trigger_event: t.trigger_event || 'create_item', phone_column_id: t.phone_column_id }
}

// Return a list of human-readable validation errors ([] = valid).
export function validateGraph(graph, source = 'monday') {
  const errors = []
  const byType = Object.fromEntries((graph.nodes || []).map(n => [n.type, n.data || {}]))
  const t = byType[NODE.TRIGGER]
  const s = byType[NODE.SEND]
  if (!t) errors.push('A Trigger block is required.')
  if (!s) errors.push('A Send-a-text block is required.')
  if (t) {
    if (source === 'sheets') {
      if (!t.spreadsheet_id) errors.push('Trigger: pick a spreadsheet.')
      if (!t.sheet_name) errors.push('Trigger: pick a sheet tab.')
      if (!t.phone_column) errors.push('Trigger: pick the phone column.')
    } else {
      if (!t.board_id) errors.push('Trigger: pick a Monday board.')
      if (!t.phone_column_id) errors.push('Trigger: pick the phone column.')
    }
  }
  if (s) {
    if (!s.sender_phone_number_id) errors.push('Send: pick a sender number.')
    if (s.message_mode === 'ai' ? !String(s.ai_instructions || '').trim() : !String(s.message_template || '').trim()) {
      errors.push('Send: the message is empty.')
    }
  }
  return errors
}
