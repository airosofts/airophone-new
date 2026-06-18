'use client'
import { useParams } from 'next/navigation'
import ScenarioForm from '@/components/scenarios/ScenarioForm'

export default function EditScenarioPage() {
  const { id } = useParams()
  return <ScenarioForm mode="edit" scenarioId={id} />
}
