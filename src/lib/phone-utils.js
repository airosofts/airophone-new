/**
 * Normalize a phone number to E.164 format
 * @param {string} phone - Phone number to normalize
 * @returns {string|null} Normalized phone number or null
 */
export function normalizePhoneNumber(phone) {
  if (!phone) return null
  
  // Remove all non-digit characters
  const digits = phone.replace(/\D/g, '')
  
  // Handle various input formats
  if (digits.length === 10) {
    return `+1${digits}`
  } else if (digits.length === 11 && digits.startsWith('1')) {
    return `+${digits}`
  } else if (phone.startsWith('+')) {
    return phone
  } else if (digits.length > 10) {
    // For international numbers, use the last 10 digits with +1 prefix
    return `+1${digits.slice(-10)}`
  }
  
  return `+1${digits}` // Default to US
}

/**
 * Format phone number for display
 * @param {string} phone - Phone number to format
 * @returns {string} Formatted phone number
 */
export function formatPhoneNumber(phone) {
  if (!phone) return phone
  
  // Normalize first to ensure consistent handling
  const normalized = normalizePhoneNumber(phone)
  
  if (!normalized) return phone
  
  // Remove '+1' if present
  const digits = normalized.replace(/^\+1/, '')
  
  // Format as (XXX) XXX-XXXX
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
  }
  
  return phone
}

/**
 * Check if two phone numbers are the same after normalization
 * @param {string} phone1 - First phone number
 * @param {string} phone2 - Second phone number
 * @returns {boolean} Whether the phone numbers are the same
 */
export function arePhonesEqual(phone1, phone2) {
  if (!phone1 || !phone2) return false
  
  const norm1 = normalizePhoneNumber(phone1)
  const norm2 = normalizePhoneNumber(phone2)
  
  return norm1 === norm2
}