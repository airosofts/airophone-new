// Shared contact-status (call outcome / disposition) definitions.
// Used by the inbox contact panel, the conversation list badge, and the
// voicemail-campaign audience filter so labels + colors stay consistent.

export const CONTACT_STATUSES = [
  // Positive / pipeline
  { id: 'lead',            label: 'Lead',             color: '#16A34A', bg: '#EAF7EE' },
  { id: 'motivated_seller',label: 'Motivated Seller', color: '#059669', bg: '#E7F6F1' },
  { id: 'appointment',     label: 'Appointment',      color: '#2563EB', bg: '#EAF0FE' },
  { id: 'callback',        label: 'Callback',         color: '#D97706', bg: '#FEF4E6' },
  { id: 'follow_up',       label: 'Follow Up',        color: '#CA8A04', bg: '#FBF6E3' },
  { id: 'under_contract',  label: 'Under Contract',   color: '#4F46E5', bg: '#ECECFB' },
  // Negative / stop-contacting
  { id: 'not_interested',  label: 'Not Interested',   color: '#6B7280', bg: '#F1F1EF' },
  { id: 'already_sold',    label: 'Already Sold/Listed', color: '#7C3AED', bg: '#F3EEFF' },
  { id: 'renter',          label: 'Renter / Not Owner', color: '#0891B2', bg: '#E4F4F8' },
  { id: 'wrong_number',    label: 'Wrong Number',     color: '#EA580C', bg: '#FEEDE3' },
  { id: 'do_not_call',     label: 'Do Not Call',      color: '#DC2626', bg: '#FDEAEA' },
  { id: 'disconnected',    label: 'Disconnected',     color: '#57534E', bg: '#F0EEE9' },
]

export const CONTACT_STATUS_MAP = Object.fromEntries(CONTACT_STATUSES.map(s => [s.id, s]))

// The "don't contact again" outcomes — pre-checked in the campaign audience
// filter as a sensible default (the user can still adjust). Covers dead/wrong
// numbers, compliance, and "deal done / wrong person" for wholesaling.
export const DEFAULT_EXCLUDED_STATUSES = [
  'do_not_call', 'wrong_number', 'disconnected', 'under_contract', 'already_sold', 'renter',
]

// Validate an incoming status slug (else treat as null/clear).
export function isValidStatus(s) {
  return typeof s === 'string' && Object.prototype.hasOwnProperty.call(CONTACT_STATUS_MAP, s)
}
