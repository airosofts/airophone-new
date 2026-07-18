'use client'

// Full-page host for the campaign AI builder. "Set up manually" hands off to the
// existing wizard on the campaigns list (opened via a one-shot localStorage flag).
import { useRouter } from 'next/navigation'
import CampaignAgentChat from '@/components/campaigns/CampaignAgentChat'

export default function NewCampaignPage() {
  const router = useRouter()
  const goManual = () => {
    try { localStorage.setItem('campaign.openManual', '1') } catch {}
    router.push('/campaigns')
  }
  return (
    <div className="h-full">
      <CampaignAgentChat onSwitchToManual={goManual} />
    </div>
  )
}
