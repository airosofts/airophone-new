'use client'

import { useState, useEffect, useCallback } from 'react'

const STATUS_BADGE = {
  pending:   { label: 'Pending',    bg: 'bg-[#F7F6F3]',             text: 'text-[#9B9890]'  },
  qualified: { label: 'Qualified',  bg: 'bg-[rgba(214,59,31,0.08)]', text: 'text-[#D63B1F]'  },
  paid:      { label: 'Paid',       bg: 'bg-[rgba(34,197,94,0.1)]',  text: 'text-[#16a34a]'  },
}

const WITHDRAWAL_STATUS_BADGE = {
  pending:    { label: 'Pending',    bg: 'bg-[#F7F6F3]',             text: 'text-[#9B9890]'  },
  processing: { label: 'Processing', bg: 'bg-[rgba(234,179,8,0.1)]', text: 'text-[#ca8a04]'  },
  completed:  { label: 'Completed',  bg: 'bg-[rgba(34,197,94,0.1)]', text: 'text-[#16a34a]'  },
  rejected:   { label: 'Rejected',   bg: 'bg-[rgba(239,68,68,0.1)]', text: 'text-[#dc2626]'  },
}

function Badge({ status, map }) {
  const s = map[status] || map.pending
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${s.bg} ${s.text}`}>
      {s.label}
    </span>
  )
}

const PLANS = [
  { name: 'Starter',    price: 9  },
  { name: 'Growth',     price: 29 },
  { name: 'Enterprise', price: 59 },
]

function calcEarning(commission, price) {
  if (!commission || !commission.enabled) return null
  const val = Number(commission.commission_value)
  if (commission.commission_type === 'percent') return (price * val) / 100
  return val
}

function fmtEarn(n) {
  if (n === null) return '—'
  return `$${n % 1 === 0 ? n.toFixed(0) : n.toFixed(2)}`
}

function fmt(n) { return `$${Number(n || 0).toFixed(2)}` }

function fmtDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function Referrals() {
  const [stats, setStats] = useState(null)
  const [withdrawals, setWithdrawals] = useState([])
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)

  const [showWithdrawModal, setShowWithdrawModal] = useState(false)
  const [showHistoryModal, setShowHistoryModal] = useState(false)
  const [showConvertModal, setShowConvertModal] = useState(false)

  const [wForm, setWForm] = useState({ method: 'paypal', email: '', bank_name: '', account_number: '', routing_number: '' })
  const [wSubmitting, setWSubmitting] = useState(false)
  const [wError, setWError] = useState('')

  const [cSubmitting, setCSubmitting] = useState(false)
  const [cError, setCError] = useState('')
  const [creditRate, setCreditRate] = useState(0.03)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [sRes, wRes, mrRes] = await Promise.all([
        fetch('/api/referral/stats'),
        fetch('/api/referral/withdrawals'),
        fetch('/api/wallet').catch(() => null),
      ])
      if (sRes.ok) setStats(await sRes.json())
      if (wRes.ok) {
        const d = await wRes.json()
        setWithdrawals(d.withdrawals || [])
      }
      if (mrRes?.ok) {
        const w = await mrRes.json()
        if (w?.messageRate) setCreditRate(Number(w.messageRate))
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Pre-fill withdraw form from the most recent payout method so users don't re-enter every time
  useEffect(() => {
    if (!withdrawals.length) return
    const last = withdrawals[0]
    if (!last?.payout_details) return
    setWForm({
      method: last.method || 'paypal',
      email: last.payout_details.email || '',
      bank_name: last.payout_details.bank_name || '',
      account_number: last.payout_details.account_number || '',
      routing_number: last.payout_details.routing_number || '',
    })
  }, [withdrawals])

  const referralLink = stats?.referral_code
    ? `${typeof window !== 'undefined' ? window.location.origin : 'https://app.airophone.com'}/signup?ref=${stats.referral_code}`
    : null

  const handleCopy = () => {
    if (!referralLink) return
    navigator.clipboard.writeText(referralLink)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleWithdraw = async () => {
    setWError('')
    const amt = Number(stats?.balance || 0)
    if (amt <= 0) { setWError('No balance available'); return }

    if (wForm.method === 'paypal' && !wForm.email) {
      setWError('Enter your PayPal email')
      return
    }
    if (wForm.method === 'bank' && (!wForm.bank_name || !wForm.account_number || !wForm.routing_number)) {
      setWError('Fill in all bank fields')
      return
    }

    const payout_details = wForm.method === 'paypal'
      ? { email: wForm.email }
      : { bank_name: wForm.bank_name, account_number: wForm.account_number, routing_number: wForm.routing_number }

    setWSubmitting(true)
    try {
      const res = await fetch('/api/referral/withdraw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: amt, method: wForm.method, payout_details }),
      })
      const data = await res.json()
      if (!res.ok) { setWError(data.error || 'Failed to submit request'); return }

      setShowWithdrawModal(false)
      await load()
    } finally {
      setWSubmitting(false)
    }
  }

  const handleConvert = async () => {
    setCError('')
    const amt = Number(stats?.balance || 0)
    if (amt < 5) { setCError('Need at least $5 balance to convert'); return }
    setCSubmitting(true)
    try {
      const res = await fetch('/api/referral/convert-to-credits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: amt }),
      })
      const data = await res.json()
      if (!res.ok) { setCError(data.error || 'Failed to convert'); return }
      setShowConvertModal(false)
      await load()
    } finally {
      setCSubmitting(false)
    }
  }

  const pendingWithdrawal = withdrawals.find(w => w.status === 'pending' || w.status === 'processing')
  const balance = Number(stats?.balance || 0)
  const estimatedCredits = Math.floor(balance / creditRate)

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-24 bg-[#FFFFFF] border border-[#E3E1DB] rounded-xl animate-pulse" />
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-5">

      {/* Header */}
      <div>
        <h3 className="text-[15px] font-semibold text-[#131210] tracking-tight">Referral Program</h3>
        <p className="text-[13px] text-[#9B9890] mt-0.5">
          Earn cash for every person you refer who starts a paid subscription.
        </p>
      </div>

      {/* Your Referrals Wallet — credit-card-style balance + one-tap action */}
      <div>
        <h4 className="text-[13px] font-semibold text-[#131210] mb-2">Your Referrals Wallet</h4>
        <div className="bg-[#FFFFFF] border border-[#E3E1DB] rounded-2xl overflow-hidden">
        <div className="px-6 py-5">
          <div className="flex items-start justify-between mb-1">
            <p className="text-[12px] font-medium text-[#9B9890] uppercase tracking-widest">Available balance</p>
            {withdrawals.length > 0 && (
              <button
                onClick={() => setShowHistoryModal(true)}
                className="text-[12px] text-[#9B9890] hover:text-[#131210] transition-colors"
              >
                History →
              </button>
            )}
          </div>
          <p className="text-[34px] font-semibold tracking-tight text-[#131210] leading-none">
            {fmt(balance)}
          </p>
          <p className="text-[12.5px] text-[#9B9890] mt-2">
            Lifetime earned <span className="text-[#131210] font-medium">{fmt(stats?.lifetime_earned)}</span>
            <span className="mx-2 text-[#D4D1C9]">·</span>
            Withdrawn <span className="text-[#131210] font-medium">{fmt(stats?.lifetime_withdrawn)}</span>
          </p>

          {/* Pending withdrawal — show inline like the bank-app screenshot */}
          {pendingWithdrawal && (
            <div className="mt-4 flex items-center gap-2.5 px-3.5 py-2.5 bg-[#F7F6F3] border border-[#E3E1DB] rounded-lg">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9B9890" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
              </svg>
              <div className="flex-1 min-w-0">
                <p className="text-[12.5px] text-[#131210]">
                  <span className="font-medium capitalize">{pendingWithdrawal.method}</span> payout {pendingWithdrawal.status}
                </p>
                <p className="text-[11.5px] text-[#9B9890]">{fmt(pendingWithdrawal.amount)} · {fmtDate(pendingWithdrawal.created_at)}</p>
              </div>
            </div>
          )}
        </div>

        {/* Action row — single primary button (uses full balance) + secondary */}
        <div className="px-6 pb-6 pt-1 flex flex-col sm:flex-row gap-2">
          <button
            onClick={() => { setShowWithdrawModal(true); setWError('') }}
            disabled={balance <= 0 || !!pendingWithdrawal}
            className="flex-1 py-3 rounded-xl bg-[#131210] text-white text-[14px] font-semibold tracking-tight hover:bg-[#3a3833] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Cash out {balance > 0 ? fmt(balance) : ''}
          </button>
          <button
            onClick={() => { setShowConvertModal(true); setCError('') }}
            disabled={balance < 5 || !!pendingWithdrawal}
            className="flex-1 sm:flex-none px-4 py-3 rounded-xl border border-[#E3E1DB] bg-[#FFFFFF] text-[13.5px] font-medium text-[#131210] hover:bg-[#F7F6F3] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Convert to credits
          </button>
        </div>
        </div>
      </div>

      {/* Referral link */}
      <div className="bg-[#FFFFFF] border border-[#E3E1DB] rounded-xl">
        <div className="px-5 py-4 border-b border-[#E3E1DB]">
          <h4 className="text-[13px] font-semibold text-[#131210]">Your Referral Link</h4>
        </div>
        <div className="px-5 py-4">
          {referralLink ? (
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={referralLink}
                className="flex-1 text-[13px] text-[#5C5A55] bg-[#F7F6F3] border border-[#E3E1DB] rounded-lg px-3 py-2 focus:outline-none font-mono"
              />
              <button
                onClick={handleCopy}
                className="shrink-0 px-3.5 py-2 rounded-lg border border-[#E3E1DB] bg-[#F7F6F3] text-[12.5px] font-medium text-[#5C5A55] hover:bg-[#EFEDE8] transition-colors"
              >
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
          ) : (
            <p className="text-[13px] text-[#9B9890]">Referral link not yet generated. Try refreshing.</p>
          )}
          <p className="text-[12px] text-[#9B9890] mt-2">
            Commission is credited when the referred user starts a paid subscription.
          </p>
        </div>
      </div>

      {/* Promote & Share */}
      <div className="bg-[#FFFFFF] border border-[#E3E1DB] rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-[#E3E1DB]">
          <h4 className="text-[13px] font-semibold text-[#131210]">Promote &amp; Share</h4>
          <p className="text-[12px] text-[#9B9890] mt-0.5">Download our ready-made graphic and post it with your referral link.</p>
        </div>
        <div className="px-5 py-5 flex flex-col sm:flex-row gap-5 items-start">
          {/* Preview */}
          <div className="shrink-0 w-full sm:w-48 rounded-xl overflow-hidden border border-[#E3E1DB] bg-[#F7F6F3]">
            <img
              src="/promote.png"
              alt="AiroPhone promotional graphic"
              className="w-full h-auto object-cover"
            />
          </div>

          {/* Instructions */}
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-semibold text-[#131210] mb-3">How to promote</p>
            <ol className="space-y-3">
              {[
                { n: '1', text: 'Download the graphic below.' },
                { n: '2', text: 'Copy your referral link above.' },
                { n: '3', text: 'Post the graphic on Instagram, LinkedIn, Twitter/X, Facebook, or any community you\'re part of.' },
                { n: '4', text: 'Add your referral link in the caption or bio so people can sign up directly through you.' },
              ].map(step => (
                <li key={step.n} className="flex items-start gap-3">
                  <span className="shrink-0 w-5 h-5 rounded-full bg-[rgba(214,59,31,0.08)] border border-[rgba(214,59,31,0.2)] flex items-center justify-center text-[10px] font-semibold text-[#D63B1F] font-mono mt-0.5">
                    {step.n}
                  </span>
                  <p className="text-[13px] text-[#5C5A55] leading-[1.6]">{step.text}</p>
                </li>
              ))}
            </ol>

            {/* Caption suggestion */}
            {referralLink && (
              <div className="mt-4 bg-[#F7F6F3] border border-[#E3E1DB] rounded-lg px-4 py-3">
                <p className="text-[11px] font-semibold text-[#9B9890] uppercase tracking-widest mb-2">Suggested caption</p>
                <p className="text-[12.5px] text-[#5C5A55] leading-[1.65] italic">
                  &ldquo;I&rsquo;ve been using AiroPhone for business calls &amp; SMS — it&rsquo;s genuinely great. Sign up with my link and we both benefit 👇<br />
                  {referralLink}&rdquo;
                </p>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(`I've been using AiroPhone for business calls & SMS — it's genuinely great. Sign up with my link and we both benefit 👇\n${referralLink}`)
                    setCopied(true)
                    setTimeout(() => setCopied(false), 2000)
                  }}
                  className="mt-2 text-[11.5px] font-medium text-[#D63B1F] hover:opacity-75 transition-opacity"
                >
                  {copied ? 'Copied!' : 'Copy caption'}
                </button>
              </div>
            )}

            {/* Download button */}
            <a
              href="/promote.png"
              download="airophone-promo.png"
              className="inline-flex items-center gap-2 mt-4 px-4 py-2.5 rounded-lg bg-[#D63B1F] text-white text-[13px] font-medium no-underline hover:opacity-90 transition-opacity"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              Download graphic
            </a>
          </div>
        </div>
      </div>

      {/* Per-plan earnings */}
      {stats?.commission?.enabled && (
        <div className="bg-[#FFFFFF] border border-[#E3E1DB] rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-[#E3E1DB]">
            <h4 className="text-[13px] font-semibold text-[#131210]">What you earn per referral</h4>
            <p className="text-[12px] text-[#9B9890] mt-0.5">
              {stats.commission.commission_type === 'percent'
                ? `${Number(stats.commission.commission_value)}% of the referred user's first payment`
                : `Flat ${fmtEarn(Number(stats.commission.commission_value))} per qualified referral`}
            </p>
          </div>
          <div className="grid grid-cols-3 divide-x divide-[#F7F6F3]">
            {PLANS.map(plan => {
              const earn = calcEarning(stats.commission, plan.price)
              return (
                <div key={plan.name} className="px-5 py-4">
                  <p className="text-[11px] font-medium text-[#9B9890] uppercase tracking-widest mb-3">{plan.name}</p>
                  <p className="text-[12px] text-[#9B9890] mb-1">Plan price</p>
                  <p className="text-[14px] font-medium text-[#131210] mb-3">${plan.price}<span className="text-[11px] text-[#9B9890] font-normal">/mo</span></p>
                  <p className="text-[12px] text-[#9B9890] mb-1">You earn</p>
                  <p className="text-[22px] font-semibold tracking-tight text-[#D63B1F]">{fmtEarn(earn)}</p>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Referrals table */}
      <div className="bg-[#FFFFFF] border border-[#E3E1DB] rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-[#E3E1DB]">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-[13px] font-semibold text-[#131210]">Your Referrals</h4>
            <span className="text-[12px] text-[#9B9890]">{stats?.referrals?.length || 0} total</span>
          </div>
          {/* Status breakdown */}
          <div className="flex items-center gap-2 flex-wrap">
            {[
              { label: 'Signed Up',  count: stats?.referrals?.length || 0,                                              bg: 'bg-[#F7F6F3]',              text: 'text-[#5C5A55]'  },
              { label: 'Pending',    count: stats?.referrals?.filter(r => r.status === 'pending').length   || 0,         bg: 'bg-[#F7F6F3]',              text: 'text-[#9B9890]'  },
              { label: 'Qualified',  count: stats?.referrals?.filter(r => r.status === 'qualified').length || 0,         bg: 'bg-[rgba(214,59,31,0.08)]', text: 'text-[#D63B1F]'  },
              { label: 'Paid Out',   count: stats?.referrals?.filter(r => r.status === 'paid').length      || 0,         bg: 'bg-[rgba(34,197,94,0.1)]',  text: 'text-[#16a34a]'  },
            ].map(s => (
              <div key={s.label} className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg ${s.bg}`}>
                <span className={`text-[13px] font-semibold ${s.text}`}>{s.count}</span>
                <span className="text-[11px] text-[#9B9890]">{s.label}</span>
              </div>
            ))}
          </div>
        </div>

        {!stats?.referrals?.length ? (
          <div className="px-5 py-10 text-center">
            <p className="text-[13px] text-[#9B9890]">No referrals yet.</p>
            <p className="text-[12px] text-[#D4D1C9] mt-1">Share your referral link to get started.</p>
          </div>
        ) : (
          <div className="divide-y divide-[#F7F6F3]">
            {/* Table header */}
            <div className="grid grid-cols-4 px-5 py-2.5 bg-[#F7F6F3]">
              {['Email', 'Joined', 'Status', 'Commission'].map(h => (
                <p key={h} className="text-[11px] font-semibold text-[#9B9890] uppercase tracking-wider">{h}</p>
              ))}
            </div>
            {stats.referrals.map(r => (
              <div key={r.id} className="grid grid-cols-4 px-5 py-3 items-center">
                <p className="text-[13px] text-[#131210] truncate pr-4">{r.referred_email}</p>
                <div>
                  <p className="text-[12.5px] text-[#5C5A55]">{fmtDate(r.created_at)}</p>
                  {r.qualified_at && (
                    <p className="text-[11px] text-[#9B9890] mt-0.5">Qualified {fmtDate(r.qualified_at)}</p>
                  )}
                </div>
                <div><Badge status={r.status} map={STATUS_BADGE} /></div>
                <p className="text-[13px] font-medium text-[#131210]">
                  {r.commission_amount ? fmt(r.commission_amount) : '—'}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Withdraw modal */}
      {showWithdrawModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(19,18,16,0.5)' }}>
          <div className="bg-[#FFFFFF] border border-[#E3E1DB] rounded-2xl w-full max-w-md shadow-xl">
            <div className="px-6 py-5 border-b border-[#E3E1DB] flex items-center justify-between">
              <h3 className="text-[15px] font-semibold text-[#131210]">Request Payout</h3>
              <button onClick={() => setShowWithdrawModal(false)} className="text-[#9B9890] hover:text-[#131210] transition-colors">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div className="px-6 py-5 space-y-4">
              {/* Amount summary — fixed to full balance */}
              <div className="bg-[#F7F6F3] border border-[#E3E1DB] rounded-xl px-4 py-3.5 flex items-center justify-between">
                <p className="text-[12.5px] text-[#9B9890]">You&rsquo;ll receive</p>
                <p className="text-[18px] font-semibold tracking-tight text-[#131210]">{fmt(balance)}</p>
              </div>

              <div>
                <label className="block text-[12.5px] font-medium text-[#131210] mb-1">Payout Method</label>
                <div className="flex gap-2">
                  {['paypal', 'bank'].map(m => (
                    <button
                      key={m}
                      onClick={() => setWForm(f => ({ ...f, method: m }))}
                      className={`flex-1 py-2 rounded-lg border text-[12.5px] font-medium transition-colors ${wForm.method === m ? 'border-[#D63B1F] bg-[rgba(214,59,31,0.06)] text-[#D63B1F]' : 'border-[#E3E1DB] text-[#5C5A55] hover:bg-[#F7F6F3]'}`}
                    >
                      {m === 'paypal' ? 'PayPal' : 'Bank Transfer'}
                    </button>
                  ))}
                </div>
              </div>

              {wForm.method === 'paypal' ? (
                <div>
                  <label className="block text-[12.5px] font-medium text-[#131210] mb-1">PayPal Email</label>
                  <input
                    type="email"
                    value={wForm.email}
                    onChange={e => setWForm(f => ({ ...f, email: e.target.value }))}
                    placeholder="your@paypal.com"
                    className="w-full text-[13px] border border-[#E3E1DB] rounded-lg px-3 py-2.5 text-[#131210] focus:outline-none focus:border-[#D63B1F] bg-[#FFFFFF]"
                  />
                </div>
              ) : (
                <div className="space-y-3">
                  <div>
                    <label className="block text-[12.5px] font-medium text-[#131210] mb-1">Bank Name</label>
                    <input
                      type="text"
                      value={wForm.bank_name}
                      onChange={e => setWForm(f => ({ ...f, bank_name: e.target.value }))}
                      placeholder="Chase, Wells Fargo…"
                      className="w-full text-[13px] border border-[#E3E1DB] rounded-lg px-3 py-2.5 text-[#131210] focus:outline-none focus:border-[#D63B1F] bg-[#FFFFFF]"
                    />
                  </div>
                  <div>
                    <label className="block text-[12.5px] font-medium text-[#131210] mb-1">Account Number</label>
                    <input
                      type="text"
                      value={wForm.account_number}
                      onChange={e => setWForm(f => ({ ...f, account_number: e.target.value }))}
                      className="w-full text-[13px] border border-[#E3E1DB] rounded-lg px-3 py-2.5 text-[#131210] focus:outline-none focus:border-[#D63B1F] bg-[#FFFFFF]"
                    />
                  </div>
                  <div>
                    <label className="block text-[12.5px] font-medium text-[#131210] mb-1">Routing Number</label>
                    <input
                      type="text"
                      value={wForm.routing_number}
                      onChange={e => setWForm(f => ({ ...f, routing_number: e.target.value }))}
                      className="w-full text-[13px] border border-[#E3E1DB] rounded-lg px-3 py-2.5 text-[#131210] focus:outline-none focus:border-[#D63B1F] bg-[#FFFFFF]"
                    />
                  </div>
                </div>
              )}

              {wError && <p className="text-[12.5px] text-[#D63B1F]">{wError}</p>}

              <button
                onClick={handleWithdraw}
                disabled={wSubmitting || balance <= 0}
                className="w-full py-3 rounded-xl bg-[#131210] text-white text-[14px] font-semibold tracking-tight hover:bg-[#3a3833] transition-colors disabled:opacity-50"
              >
                {wSubmitting ? 'Submitting…' : `Cash out ${fmt(balance)}`}
              </button>
              <p className="text-[12px] text-[#9B9890] text-center">
                Payouts are processed manually within 3–5 business days.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Convert-to-credits modal */}
      {showConvertModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(19,18,16,0.5)' }}>
          <div className="bg-[#FFFFFF] border border-[#E3E1DB] rounded-2xl w-full max-w-md shadow-xl">
            <div className="px-6 py-5 border-b border-[#E3E1DB] flex items-center justify-between">
              <h3 className="text-[15px] font-semibold text-[#131210]">Convert to Credits</h3>
              <button onClick={() => setShowConvertModal(false)} className="text-[#9B9890] hover:text-[#131210] transition-colors">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div className="bg-[#F7F6F3] border border-[#E3E1DB] rounded-xl px-4 py-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-[12.5px] text-[#9B9890]">Convert</p>
                  <p className="text-[15px] font-semibold text-[#131210]">{fmt(balance)}</p>
                </div>
                <div className="border-t border-[#E3E1DB] -mx-4 mb-3" />
                <div className="flex items-center justify-between">
                  <p className="text-[12.5px] text-[#9B9890]">You&rsquo;ll get</p>
                  <p className="text-[20px] font-semibold tracking-tight text-[#D63B1F]">
                    {estimatedCredits.toLocaleString()} credits
                  </p>
                </div>
                <p className="text-[11.5px] text-[#9B9890] mt-1 text-right">
                  at ${creditRate}/credit (your current rate)
                </p>
              </div>

              <p className="text-[12.5px] text-[#5C5A55] leading-[1.55]">
                Credits are added to your wallet immediately and can be used for SMS sends. This action cannot be reversed.
              </p>

              {cError && <p className="text-[12.5px] text-[#D63B1F]">{cError}</p>}

              <button
                onClick={handleConvert}
                disabled={cSubmitting || balance < 5}
                className="w-full py-3 rounded-xl bg-[#D63B1F] text-white text-[14px] font-semibold tracking-tight hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {cSubmitting ? 'Converting…' : `Add ${estimatedCredits.toLocaleString()} credits to wallet`}
              </button>
              {balance < 5 && (
                <p className="text-[12px] text-[#9B9890] text-center">Minimum $5 balance required.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Payout history modal */}
      {showHistoryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(19,18,16,0.5)' }}>
          <div className="bg-[#FFFFFF] border border-[#E3E1DB] rounded-2xl w-full max-w-lg shadow-xl max-h-[80vh] flex flex-col">
            <div className="px-6 py-5 border-b border-[#E3E1DB] flex items-center justify-between shrink-0">
              <h3 className="text-[15px] font-semibold text-[#131210]">Payout History</h3>
              <button onClick={() => setShowHistoryModal(false)} className="text-[#9B9890] hover:text-[#131210] transition-colors">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div className="overflow-y-auto flex-1 divide-y divide-[#F7F6F3]">
              {withdrawals.map(w => (
                <div key={w.id} className="px-6 py-4 flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold text-[#131210]">{fmt(w.amount)}</p>
                    <p className="text-[12px] text-[#9B9890] capitalize">{w.method} · {fmtDate(w.created_at)}</p>
                    {w.admin_note && <p className="text-[12px] text-[#5C5A55] mt-0.5 italic">{w.admin_note}</p>}
                  </div>
                  <Badge status={w.status} map={WITHDRAWAL_STATUS_BADGE} />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
