// Aerofone Pricing Configuration
// Tiered pricing based on cumulative message volume per workspace

export const MESSAGE_PRICING_TIERS = [
  {
    min: 10001,
    max: Infinity,
    rate: 0.02,
    label: '10,000+ messages',
    description: 'Best rate for high volume'
  },
  {
    min: 5001,
    max: 10000,
    rate: 0.025,
    label: '5,001-10,000 messages',
    description: 'Mid-tier rate'
  },
  {
    min: 0,
    max: 5000,
    rate: 0.03,
    label: '0-5,000 messages',
    description: 'Starting rate'
  }
]

export const MONTHLY_NUMBER_FEE = 3.00 // Rounded up to $3.00

// Calls are unlimited — no credits deducted for calls
export const CALL_CREDITS_PER_MINUTE = 0

import { supabaseAdmin } from './supabase-server'

/**
 * Calculate the cost per message based on cumulative message count
 * @param {number} messageCount - Total number of messages sent by user/workspace
 * @returns {number} - Cost per message in dollars
 */
export function getMessageRate(messageCount) {
  if (!messageCount || messageCount < 0) {
    return MESSAGE_PRICING_TIERS[MESSAGE_PRICING_TIERS.length - 1].rate // Default to highest rate
  }

  for (const tier of MESSAGE_PRICING_TIERS) {
    if (messageCount >= tier.min && messageCount <= tier.max) {
      return tier.rate
    }
  }

  // Fallback to lowest rate if somehow no tier matches
  return MESSAGE_PRICING_TIERS[0].rate
}

/**
 * Calculate total cost for sending messages
 * @param {number} currentMessageCount - Current total messages sent
 * @param {number} newMessageCount - Number of new messages to send
 * @returns {object} - { totalCost, breakdown, averageRate }
 */
export function calculateMessageCost(currentMessageCount, newMessageCount) {
  let totalCost = 0
  let remainingMessages = newMessageCount
  let currentCount = currentMessageCount

  const breakdown = []

  while (remainingMessages > 0) {
    const currentRate = getMessageRate(currentCount)
    const currentTier = MESSAGE_PRICING_TIERS.find(
      tier => currentCount >= tier.min && currentCount <= tier.max
    )

    if (!currentTier) break

    // Calculate how many messages can be sent at current rate
    const messagesInThisTier = Math.min(
      remainingMessages,
      currentTier.max - currentCount
    )

    const tierCost = messagesInThisTier * currentRate

    breakdown.push({
      messages: messagesInThisTier,
      rate: currentRate,
      cost: tierCost,
      tier: currentTier.label
    })

    totalCost += tierCost
    remainingMessages -= messagesInThisTier
    currentCount += messagesInThisTier
  }

  const averageRate = totalCost / newMessageCount

  return {
    totalCost: parseFloat(totalCost.toFixed(4)),
    breakdown,
    averageRate: parseFloat(averageRate.toFixed(4)),
    currentTier: getMessageRate(currentMessageCount),
    nextTier: getMessageRate(currentMessageCount + newMessageCount)
  }
}

/**
 * Get pricing tier information
 * @param {number} messageCount - Current message count
 * @returns {object} - Current tier information
 */
export function getCurrentTier(messageCount) {
  return MESSAGE_PRICING_TIERS.find(
    tier => messageCount >= tier.min && messageCount <= tier.max
  ) || MESSAGE_PRICING_TIERS[MESSAGE_PRICING_TIERS.length - 1]
}

/**
 * Get next pricing tier information
 * @param {number} messageCount - Current message count
 * @returns {object|null} - Next tier information or null if at lowest rate
 */
export function getNextTier(messageCount) {
  const currentTierIndex = MESSAGE_PRICING_TIERS.findIndex(
    tier => messageCount >= tier.min && messageCount <= tier.max
  )

  if (currentTierIndex > 0) {
    return MESSAGE_PRICING_TIERS[currentTierIndex - 1]
  }

  return null // Already at best rate
}

/**
 * Calculate messages until next tier
 * @param {number} messageCount - Current message count
 * @returns {number|null} - Messages until next tier or null if at best rate
 */
export function getMessagesUntilNextTier(messageCount) {
  const nextTier = getNextTier(messageCount)

  if (!nextTier) {
    return null // Already at best rate
  }

  return nextTier.min - messageCount
}

/**
 * Get workspace's total message count and current rate from database
 * @param {string} workspaceId - Workspace ID
 * @returns {Promise<object>} - { messageCount, currentRate, tierInfo }
 */
export async function getWorkspacePricingInfo(workspaceId) {
  try {
    // Get total sent messages for this workspace from message_transactions
    const { data, error } = await supabaseAdmin
      .from('message_transactions')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .eq('status', 'sent')

    if (error) {
      console.error('Error fetching message count:', error)
      // Fallback to highest rate on error
      return {
        messageCount: 0,
        currentRate: 0.03,
        tierInfo: MESSAGE_PRICING_TIERS[MESSAGE_PRICING_TIERS.length - 1]
      }
    }

    const messageCount = data || 0
    const currentRate = getMessageRate(messageCount)
    const tierInfo = getCurrentTier(messageCount)

    return {
      messageCount,
      currentRate,
      tierInfo,
      nextTier: getNextTier(messageCount),
      messagesUntilNextTier: getMessagesUntilNextTier(messageCount)
    }
  } catch (error) {
    console.error('Error in getWorkspacePricingInfo:', error)
    // Fallback to highest rate on error
    return {
      messageCount: 0,
      currentRate: 0.03,
      tierInfo: MESSAGE_PRICING_TIERS[MESSAGE_PRICING_TIERS.length - 1]
    }
  }
}

/**
 * Get the appropriate rate for a new message based on workspace's current count
 * @param {string} workspaceId - Workspace ID
 * @returns {Promise<number>} - Cost per message
 */
export async function getWorkspaceMessageRate(workspaceId) {
  const { currentRate } = await getWorkspacePricingInfo(workspaceId)
  return currentRate
}
