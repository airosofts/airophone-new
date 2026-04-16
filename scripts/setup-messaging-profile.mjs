// One-time script: create messaging profile + assign number
// Usage: node scripts/setup-messaging-profile.mjs

const TELNYX_API_KEY = process.env.TELNYX_API_KEY
const PROFILE_ID = '40019d93-2652-4934-931d-1434bc9f811e'  // hamzasofts profile
const CAMPAIGN_ID = '4b300199-1bcf-170e-e865-65d3d884f545'
const NUMBERS = ['+16182609324', '+18578955945']

async function fixNumbers() {
  for (const number of NUMBERS) {
    console.log(`\n=== Processing ${number} ===`)

    // Step 1: Look up Telnyx ID
    const lookupRes = await fetch(
      `https://api.telnyx.com/v2/phone_numbers?filter[phone_number]=${encodeURIComponent(number)}`,
      { headers: { 'Authorization': `Bearer ${TELNYX_API_KEY}` } }
    )
    const lookupData = await lookupRes.json()
    const telnyxId = lookupData.data?.[0]?.id
    const currentProfile = lookupData.data?.[0]?.messaging_profile_id
    if (!telnyxId) { console.error(`  Could not find Telnyx ID for ${number}`); continue }
    console.log(`  Telnyx ID: ${telnyxId}`)
    console.log(`  Current profile: ${currentProfile || 'none'}`)

    // Step 2: Assign to messaging profile if not already on it
    if (currentProfile !== PROFILE_ID) {
      const assignRes = await fetch(`https://api.telnyx.com/v2/phone_numbers/${telnyxId}/messaging`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${TELNYX_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_profile_id: PROFILE_ID }),
      })
      if (assignRes.ok) {
        console.log(`  Assigned to profile ${PROFILE_ID}`)
      } else {
        const err = await assignRes.json().catch(() => ({}))
        console.error(`  Failed to assign profile:`, JSON.stringify(err))
      }
    } else {
      console.log(`  Already on correct profile`)
    }

    // Step 3: Remove failed 10DLC assignment
    console.log(`  Removing old 10DLC assignment...`)
    const deleteRes = await fetch(
      `https://api.telnyx.com/v2/10dlc/phone_number_campaigns/${encodeURIComponent(number)}`,
      { method: 'DELETE', headers: { 'Authorization': `Bearer ${TELNYX_API_KEY}` } }
    )
    if (deleteRes.ok || deleteRes.status === 404) {
      console.log(`  Old assignment removed (or didn't exist)`)
    } else {
      const err = await deleteRes.json().catch(() => ({}))
      console.warn(`  Delete returned ${deleteRes.status}:`, JSON.stringify(err))
    }

    // Step 4: Re-submit to campaign
    console.log(`  Re-assigning to campaign ${CAMPAIGN_ID}...`)
    const campaignRes = await fetch('https://api.telnyx.com/v2/10dlc/phone_number_campaigns', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${TELNYX_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ phoneNumber: number, campaignId: CAMPAIGN_ID }),
    })
    const campaignData = await campaignRes.json()
    if (campaignRes.ok) {
      console.log(`  Campaign status: ${campaignData.assignmentStatus}`)
    } else {
      console.error(`  Campaign assignment failed:`, JSON.stringify(campaignData, null, 2))
    }
  }
  console.log('\nDone.')
}

async function run() {
  // Step 1: Create messaging profile
  console.log(`Creating messaging profile "${PROFILE_NAME}"...`)
  const createRes = await fetch('https://api.telnyx.com/v2/messaging_profiles', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${TELNYX_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: PROFILE_NAME,
      whitelisted_destinations: ['US', 'CA'],
      webhook_url: `${SITE_URL}/api/webhooks/telnyx`,
      webhook_failover_url: `${SITE_URL}/api/webhooks/telnyx/failover`,
      webhook_api_version: '2',
      enabled: true,
    }),
  })
  const createData = await createRes.json()
  if (!createRes.ok) {
    console.error('Failed to create profile:', JSON.stringify(createData, null, 2))
    process.exit(1)
  }
  const profileId = createData.data.id
  console.log(`Profile created: ${profileId}`)

  // Step 2: Look up the Telnyx phone number ID
  console.log(`Looking up Telnyx ID for ${PHONE_NUMBER}...`)
  const lookupRes = await fetch(
    `https://api.telnyx.com/v2/phone_numbers?filter[phone_number]=${encodeURIComponent(PHONE_NUMBER)}`,
    { headers: { 'Authorization': `Bearer ${TELNYX_API_KEY}` } }
  )
  const lookupData = await lookupRes.json()
  if (!lookupRes.ok || !lookupData.data?.[0]) {
    console.error('Number not found:', JSON.stringify(lookupData, null, 2))
    process.exit(1)
  }
  const telnyxNumberId = lookupData.data[0].id
  const currentProfile = lookupData.data[0].messaging_profile_id
  console.log(`Telnyx number ID: ${telnyxNumberId}`)
  console.log(`Current messaging profile: ${currentProfile || 'none'}`)

  // Step 3: Assign number to the new profile
  console.log(`Assigning ${PHONE_NUMBER} to profile ${profileId}...`)
  const assignRes = await fetch(
    `https://api.telnyx.com/v2/phone_numbers/${telnyxNumberId}/messaging`,
    {
      method: 'PATCH',
      headers: { 'Authorization': `Bearer ${TELNYX_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_profile_id: profileId }),
    }
  )
  const assignData = await assignRes.json()
  if (!assignRes.ok) {
    console.error('Failed to assign number:', JSON.stringify(assignData, null, 2))
    process.exit(1)
  }
  console.log(`Success! Number assigned.`)
  console.log(`\nMessaging Profile ID: ${profileId}`)
  console.log(`Set this in your workspace's messaging_profile_id in Supabase.`)
}

fixNumbers().catch(err => { console.error(err); process.exit(1) })
