'use client'

// New scenario — defaults to the conversational assistant builder.
// "Set up manually" switches to the classic full form (and back).

import { useState } from 'react'
import ScenarioAgentChat from '@/components/scenarios/ScenarioAgentChat'
import ScenarioForm from '@/components/scenarios/ScenarioForm'

export default function NewScenarioPage() {
  const [manual, setManual] = useState(false)

  if (!manual) {
    return <ScenarioAgentChat onSwitchToManual={() => setManual(true)} />
  }

  return (
    <div className="h-full flex flex-col bg-[#F7F6F3]">
      <div className="flex items-center justify-end px-5 py-2 bg-white border-b border-[#E3E1DB] shrink-0">
        <button onClick={() => setManual(false)}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-[#D63B1F] hover:underline">
          <i className="fas fa-wand-magic-sparkles text-[11px]" />
          Use the assistant instead
        </button>
      </div>
      <div className="flex-1 min-h-0">
        <ScenarioForm mode="create" />
      </div>
    </div>
  )
}
