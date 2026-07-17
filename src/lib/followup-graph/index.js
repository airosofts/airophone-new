// Pure mapping between a scenario's follow-up sequence and a React-Flow graph.
// No React, no DB — safe to import from client components and from node --test.
//
// The follow-up ENGINE is linear (ordered stages, and any reply stops the whole
// sequence). So the graph is constrained to that shape:
//   Trigger ──"if no reply"──▶ Follow-up 1 ──not_responded──▶ Follow-up 2 ──▶ … ──▶ End
//   every Follow-up also has a  ──responded──▶ End   edge (the universal reply-stop; UI-only).
// The stage ORDER is derived by walking the not_responded chain from the Trigger.
// The `responded → End` edges carry no stage data — they just visualise reply-stop.

export const NODE = { TRIGGER: 'trigger', FOLLOWUP: 'followup', END: 'end' }
export const HANDLE = { NEXT: 'not_responded', STOP: 'responded', START: 'default' }

const COL = 340, ROW = 80

const followupData = (s = {}) => ({
  wait_duration: s.wait_duration ?? 1,
  wait_unit: s.wait_unit || 'days',
  message_mode: s.message_mode === 'exact' ? 'exact' : 'ai',
  instructions: s.instructions || '',
  monday_status_column_id: s.monday_status_column_id || '',
  monday_status_label: s.monday_status_label || '',
})

// Build a canvas graph for a scenario's follow-ups. Prefer the stored graph;
// otherwise synthesize the linear chain where EACH follow-up gets its own End
// node on the "replied" branch, plus a tail End for the final "still no reply".
export function buildGraphFromScenario(scenario = {}, stages = []) {
  const g = scenario.followup_graph
  if (g && Array.isArray(g.nodes) && g.nodes.length) return g

  const ordered = [...(stages || [])].sort((a, b) => (a.stage_number || 0) - (b.stage_number || 0))
  const nodes = [{ id: 'trigger', type: NODE.TRIGGER, position: { x: 40, y: ROW }, data: {} }]
  const edges = []

  let prev = 'trigger'
  ordered.forEach((s, i) => {
    const id = `followup-${i + 1}`
    const x = 40 + COL * (i + 1)
    nodes.push({ id, type: NODE.FOLLOWUP, position: { x, y: ROW }, data: followupData(s) })
    // chain edge from the previous node (trigger uses START, follow-ups use NEXT)
    edges.push({ id: `e-${prev}-${id}`, source: prev, target: id, sourceHandle: prev === 'trigger' ? HANDLE.START : HANDLE.NEXT })
    // this follow-up's OWN End on the replied branch — FIXED (the engine always
    // stops on a reply; this End can't be removed).
    const endId = `end-${i + 1}`
    nodes.push({ id: endId, type: NODE.END, position: { x: x + 30, y: ROW + 540 }, data: { fixed: true } })
    edges.push({ id: `e-${id}-end`, source: id, target: endId, sourceHandle: HANDLE.STOP })
    prev = id
  })
  // the final "still no reply" ends in a REMOVABLE tail End — delete it to chain
  // another follow-up onto the "if no reply" branch.
  const tailEnd = 'end-tail'
  nodes.push({ id: tailEnd, type: NODE.END, position: { x: 40 + COL * (ordered.length + 1), y: ROW }, data: { fixed: false } })
  edges.push({ id: `e-${prev}-tail`, source: prev, target: tailEnd, sourceHandle: prev === 'trigger' ? HANDLE.START : HANDLE.NEXT })
  return { nodes, edges }
}

// Walk the not_responded chain from the Trigger → ordered follow-up nodes →
// stages[] (stage_number = chain position). responded/End edges are ignored.
export function flattenGraphToStages(graph = {}) {
  const nodes = graph.nodes || []
  const edges = graph.edges || []
  const byId = Object.fromEntries(nodes.map(n => [n.id, n]))
  const trigger = nodes.find(n => n.type === NODE.TRIGGER)
  const stages = []
  if (!trigger) return { stages, followup_graph: graph }

  // first hop: any edge leaving the trigger
  let edge = edges.find(e => e.source === trigger.id)
  const seen = new Set()
  while (edge && byId[edge.target]?.type === NODE.FOLLOWUP && !seen.has(edge.target)) {
    seen.add(edge.target)
    const node = byId[edge.target]
    const d = node.data || {}
    stages.push({
      stage_number: stages.length + 1,
      wait_duration: Number(d.wait_duration) || 1,
      wait_unit: d.wait_unit || 'days',
      instructions: d.instructions || '',
      message_mode: d.message_mode === 'exact' ? 'exact' : 'ai',
      monday_status_column_id: d.monday_status_column_id || null,
      monday_status_label: d.monday_status_label || null,
    })
    // continue along the not_responded branch only
    edge = edges.find(e => e.source === node.id && e.sourceHandle === HANDLE.NEXT)
  }
  return { stages, followup_graph: graph }
}

// Human-readable validation errors ([] = valid).
export function validateGraph(graph = {}) {
  const errors = []
  const nodes = graph.nodes || []
  const edges = graph.edges || []
  const triggers = nodes.filter(n => n.type === NODE.TRIGGER)
  if (triggers.length !== 1) errors.push('There must be exactly one “First message sent” trigger.')

  // the not_responded path must be a single line (no follow-up with two next-edges)
  for (const n of nodes.filter(n => n.type === NODE.FOLLOWUP)) {
    const nexts = edges.filter(e => e.source === n.id && e.sourceHandle === HANDLE.NEXT)
    if (nexts.length > 1) errors.push('A follow-up can only continue to one next block on “no reply”.')
    if (Number(n.data?.wait_duration) < 1) errors.push('Each follow-up needs a wait of at least 1.')
  }
  return errors
}
