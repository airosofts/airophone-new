import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildGraphFromScenario, flattenGraphToStages, validateGraph, NODE, HANDLE } from './index.js'

const STAGES = [
  { stage_number: 1, wait_duration: 1, wait_unit: 'days', instructions: 'bump 1', message_mode: 'ai' },
  { stage_number: 2, wait_duration: 3, wait_unit: 'days', instructions: 'bump 2', message_mode: 'exact', monday_status_column_id: 'status', monday_status_label: 'Engaged' },
]

test('buildGraphFromScenario: each follow-up gets its OWN End on the replied branch', () => {
  const g = buildGraphFromScenario({}, STAGES)
  const types = g.nodes.map(n => n.type)
  assert.equal(types.filter(t => t === NODE.TRIGGER).length, 1)
  assert.equal(types.filter(t => t === NODE.FOLLOWUP).length, 2)
  assert.ok(types.filter(t => t === NODE.END).length >= 2, 'multiple End nodes')
  // trigger -> first follow-up; follow-up 1 -> follow-up 2 on no-reply
  assert.ok(g.edges.some(e => e.source === 'trigger' && e.sourceHandle === HANDLE.START && e.target === 'followup-1'))
  assert.ok(g.edges.some(e => e.source === 'followup-1' && e.sourceHandle === HANDLE.NEXT && e.target === 'followup-2'))
  // each follow-up's replied branch goes to a DISTINCT End node
  const stop1 = g.edges.find(e => e.source === 'followup-1' && e.sourceHandle === HANDLE.STOP)
  const stop2 = g.edges.find(e => e.source === 'followup-2' && e.sourceHandle === HANDLE.STOP)
  assert.ok(stop1 && stop2 && stop1.target !== stop2.target, 'distinct End per follow-up')
  assert.equal(g.nodes.find(n => n.id === stop1.target)?.type, NODE.END)
})

test('buildGraphFromScenario: returns the stored graph verbatim when present', () => {
  const stored = { nodes: [{ id: 'trigger', type: NODE.TRIGGER, position: { x: 1, y: 2 }, data: {} }], edges: [] }
  const g = buildGraphFromScenario({ followup_graph: stored }, STAGES)
  assert.strictEqual(g, stored)
})

test('flattenGraphToStages: round-trips stage order + fields via the not_responded chain', () => {
  const g = buildGraphFromScenario({}, STAGES)
  const { stages } = flattenGraphToStages(g)
  assert.equal(stages.length, 2)
  assert.deepEqual(stages.map(s => s.stage_number), [1, 2])
  assert.equal(stages[0].instructions, 'bump 1')
  assert.equal(stages[0].message_mode, 'ai')
  assert.equal(stages[1].wait_duration, 3)
  assert.equal(stages[1].message_mode, 'exact')
  assert.equal(stages[1].monday_status_column_id, 'status')
  assert.equal(stages[1].monday_status_label, 'Engaged')
})

test('flattenGraphToStages: ignores responded/End edges and stops at End', () => {
  // trigger -> f1 -> (not_responded) End ; f1 -> (responded) End  => exactly ONE stage
  const g = {
    nodes: [
      { id: 'trigger', type: NODE.TRIGGER, position: { x: 0, y: 0 }, data: {} },
      { id: 'f1', type: NODE.FOLLOWUP, position: { x: 1, y: 0 }, data: { wait_duration: 2, wait_unit: 'hours', instructions: 'x', message_mode: 'ai' } },
      { id: 'end', type: NODE.END, position: { x: 2, y: 0 }, data: {} },
    ],
    edges: [
      { id: 'a', source: 'trigger', target: 'f1', sourceHandle: HANDLE.START },
      { id: 'b', source: 'f1', target: 'end', sourceHandle: HANDLE.NEXT },
      { id: 'c', source: 'f1', target: 'end', sourceHandle: HANDLE.STOP },
    ],
  }
  const { stages } = flattenGraphToStages(g)
  assert.equal(stages.length, 1)
  assert.equal(stages[0].wait_unit, 'hours')
})

test('validateGraph: passes a synthesized graph, flags a forked no-reply path', () => {
  assert.deepEqual(validateGraph(buildGraphFromScenario({}, STAGES)), [])
  const forked = {
    nodes: [
      { id: 'trigger', type: NODE.TRIGGER, position: { x: 0, y: 0 }, data: {} },
      { id: 'f1', type: NODE.FOLLOWUP, position: { x: 1, y: 0 }, data: { wait_duration: 1 } },
      { id: 'f2', type: NODE.FOLLOWUP, position: { x: 2, y: 0 }, data: { wait_duration: 1 } },
      { id: 'f3', type: NODE.FOLLOWUP, position: { x: 2, y: 1 }, data: { wait_duration: 1 } },
    ],
    edges: [
      { id: 'a', source: 'trigger', target: 'f1', sourceHandle: HANDLE.START },
      { id: 'b', source: 'f1', target: 'f2', sourceHandle: HANDLE.NEXT },
      { id: 'c', source: 'f1', target: 'f3', sourceHandle: HANDLE.NEXT },  // fork on no-reply
    ],
  }
  assert.ok(validateGraph(forked).some(e => /one next block/.test(e)))
})
