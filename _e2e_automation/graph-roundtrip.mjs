import { createClient } from '@supabase/supabase-js'
import { buildGraphFromAutomation, flattenGraphToPayload, NODE } from '../src/lib/automation-graph/index.js'

const url = 'https://sayakmjcwleakvxzuujw.supabase.co'
const key = process.env.TEST_SERVICE_ROLE // set from airophone-test.env before running
const sb = createClient(url, key)

const graph = {
  nodes: [
    { id: 'trigger', type: NODE.TRIGGER, position: { x: 40, y: 60 }, data: { board_id: 'b1', board_name: 'Leads', trigger_event: 'create_item', phone_column_id: 'phone' } },
    { id: 'wait', type: NODE.WAIT, position: { x: 340, y: 60 }, data: { send_delay_seconds: 600, business_hours_mode: 'within' } },
    { id: 'send', type: NODE.SEND, position: { x: 640, y: 60 }, data: { sender_phone_number_id: 'n1', message_mode: 'template', message_template: 'Hi {{name}}' } },
  ],
  edges: [{ id: 'e1', source: 'trigger', target: 'wait' }, { id: 'e2', source: 'wait', target: 'send' }],
}
const payload = flattenGraphToPayload(graph, 'monday')

const { data: row, error } = await sb.from('monday_automations').insert({
  name: 'e2e-graph', board_id: payload.board_id, board_name: payload.board_name,
  trigger_event: payload.trigger_event, phone_column_id: payload.phone_column_id,
  sender_phone_number_id: payload.sender_phone_number_id, message_mode: payload.message_mode,
  message_template: payload.message_template, send_delay_seconds: payload.send_delay_seconds,
  business_hours_mode: payload.business_hours_mode, graph: payload.graph,
}).select().single()
if (error) { console.error('INSERT FAILED', error); process.exit(1) }

const { data: back } = await sb.from('monday_automations').select('*').eq('id', row.id).single()
const ok1 = JSON.stringify(back.graph) === JSON.stringify(graph)
const ok2 = back.send_delay_seconds === 600 && back.business_hours_mode === 'within' && back.message_template === 'Hi {{name}}'
const rebuilt = buildGraphFromAutomation(back)
const ok3 = rebuilt.nodes.length === 3 && rebuilt.nodes[0].position.x === 40
const graphless = buildGraphFromAutomation({ board_id: 'b', trigger_event: 'create_item', phone_column_id: 'p', message_mode: 'template', message_template: 'x', sender_phone_number_id: 'n' })
const ok4 = graphless.nodes.length === 3 && graphless.nodes.every(n => Number.isFinite(n.position.x))

console.log('graph round-trips identical:', ok1)
console.log('flat columns correct:', ok2)
console.log('rebuild from stored graph:', ok3)
console.log('graph-less auto-layout:', ok4)

await sb.from('monday_automations').delete().eq('id', row.id) // cleanup
process.exit(ok1 && ok2 && ok3 && ok4 ? 0 : 1)
