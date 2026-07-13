import { test } from 'node:test'
import assert from 'node:assert/strict'
import { NODE, buildGraphFromAutomation, flattenGraphToPayload, validateGraph } from './index.js'

test('buildGraphFromAutomation: returns stored graph verbatim when present', () => {
  const stored = { nodes: [{ id: 'trigger', type: NODE.TRIGGER, position: { x: 1, y: 2 }, data: {} }], edges: [] }
  const g = buildGraphFromAutomation({ graph: stored })
  assert.deepEqual(g, stored)
})

test('buildGraphFromAutomation: synthesizes 4 nodes from flat monday columns when no graph', () => {
  const g = buildGraphFromAutomation({
    board_id: 'b1', board_name: 'Leads', trigger_event: 'create_item', phone_column_id: 'phone',
    send_delay_seconds: 600, business_hours_mode: 'within',
    sender_phone_number_id: 'n1', message_mode: 'template', message_template: 'Hi {{name}}',
  })
  const types = g.nodes.map(n => n.type)
  assert.ok(types.includes(NODE.TRIGGER))
  assert.ok(types.includes(NODE.WAIT))
  assert.ok(types.includes(NODE.SEND))
  // every node has a finite position
  assert.ok(g.nodes.every(n => Number.isFinite(n.position.x) && Number.isFinite(n.position.y)))
  // edges connect them in a line, trigger first
  assert.equal(g.edges[0].source, 'trigger')
})

test('flattenGraphToPayload: maps monday nodes back to existing columns + graph', () => {
  const graph = {
    nodes: [
      { id: 'trigger', type: NODE.TRIGGER, position: { x: 0, y: 0 }, data: { board_id: 'b1', board_name: 'Leads', trigger_event: 'create_item', phone_column_id: 'phone' } },
      { id: 'wait', type: NODE.WAIT, position: { x: 1, y: 0 }, data: { send_delay_seconds: 600, business_hours_mode: 'within' } },
      { id: 'send', type: NODE.SEND, position: { x: 2, y: 0 }, data: { sender_phone_number_id: 'n1', message_mode: 'template', message_template: 'Hi' } },
    ],
    edges: [],
  }
  const p = flattenGraphToPayload(graph, 'monday')
  assert.equal(p.board_id, 'b1')
  assert.equal(p.trigger_event, 'create_item')
  assert.equal(p.phone_column_id, 'phone')
  assert.equal(p.send_delay_seconds, 600)
  assert.equal(p.business_hours_mode, 'within')
  assert.equal(p.message_mode, 'template')
  assert.equal(p.message_template, 'Hi')
  assert.equal(p.graph, graph)
})

test('validateGraph: flags a missing send node', () => {
  const graph = { nodes: [{ id: 'trigger', type: NODE.TRIGGER, position: { x: 0, y: 0 }, data: { board_id: 'b1', trigger_event: 'create_item', phone_column_id: 'p' } }], edges: [] }
  const errors = validateGraph(graph, 'monday')
  assert.ok(errors.some(e => /send/i.test(e)))
})

test('validateGraph: passes a complete monday graph', () => {
  const graph = { nodes: [
    { id: 'trigger', type: NODE.TRIGGER, position: { x: 0, y: 0 }, data: { board_id: 'b1', trigger_event: 'create_item', phone_column_id: 'p' } },
    { id: 'send', type: NODE.SEND, position: { x: 1, y: 0 }, data: { sender_phone_number_id: 'n1', message_mode: 'template', message_template: 'Hi' } },
  ], edges: [] }
  assert.deepEqual(validateGraph(graph, 'monday'), [])
})
