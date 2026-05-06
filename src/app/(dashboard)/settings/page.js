'use client'

import { useState } from 'react'
import ManageNumbers from '@/components/settings/ManageNumbers'
import MessageTemplates from '@/components/settings/MessageTemplates'
import ApiKeys from '@/components/settings/ApiKeys'
import Blocklist from '@/components/settings/Blocklist'
import AiSettings from '@/components/settings/AiSettings'
import CallForwarding from '@/components/settings/CallForwarding'
import WorkspaceMembers from '@/components/settings/WorkspaceMembers'
import Referrals from '@/components/settings/Referrals'

const sections = [
  {
    label: 'Workspace',
    items: [
      { id: 'numbers',    name: 'Phone Numbers',     icon: 'fa-sim-card',    desc: 'Buy and manage lines' },
      { id: 'members',    name: 'Team Members',      icon: 'fa-users',       desc: 'Invite and manage access' },
      { id: 'templates',  name: 'Message Templates', icon: 'fa-layer-group', desc: 'Reusable message templates' },
      { id: 'apikeys',    name: 'API Keys',           icon: 'fa-plug',        desc: 'External integrations' },
      { id: 'blocklist',  name: 'Blocklist',          icon: 'fa-ban',         desc: 'Blocked numbers' },
      { id: 'ai',         name: 'AI Settings',        icon: 'fa-robot',       desc: 'Reply delay and behavior' },
      { id: 'forwarding', name: 'Call Forwarding',    icon: 'fa-phone-alt',   desc: 'Forward incoming calls' },
      { id: 'referrals',  name: 'Referrals',          icon: 'fa-gift',        desc: 'Earn cash for referrals' },
    ],
  },
  {
    label: 'Account',
    items: [
      { id: 'profile',       name: 'Profile',       icon: 'fa-user-circle', desc: 'Name and avatar' },
      { id: 'notifications', name: 'Notifications', icon: 'fa-bell',        desc: 'Alerts and updates' },
      { id: 'security',      name: 'Security',      icon: 'fa-shield-alt',  desc: 'Password and 2FA' },
    ],
  },
]

const placeholders = {
  profile:       { title: 'Profile',       description: 'Manage your name, avatar and contact details.' },
  notifications: { title: 'Notifications', description: 'Choose what you want to be notified about.' },
  security:      { title: 'Security',      description: 'Manage your password and two-factor authentication.' },
}

// Icon background colors per section item
const iconColors = {
  numbers:       { bg: 'bg-[rgba(214,59,31,0.08)]', text: 'text-[#D63B1F]' },
  members:       { bg: 'bg-[rgba(214,59,31,0.08)]', text: 'text-[#D63B1F]' },
  templates:     { bg: 'bg-[rgba(214,59,31,0.08)]', text: 'text-[#D63B1F]' },
  apikeys:       { bg: 'bg-[rgba(214,59,31,0.08)]', text: 'text-[#D63B1F]' },
  blocklist:     { bg: 'bg-[rgba(214,59,31,0.08)]', text: 'text-[#D63B1F]' },
  ai:            { bg: 'bg-[rgba(214,59,31,0.08)]', text: 'text-[#D63B1F]' },
  forwarding:    { bg: 'bg-[rgba(214,59,31,0.08)]', text: 'text-[#D63B1F]' },
  referrals:     { bg: 'bg-[rgba(214,59,31,0.08)]', text: 'text-[#D63B1F]' },
  profile:       { bg: 'bg-[rgba(214,59,31,0.08)]', text: 'text-[#D63B1F]' },
  notifications: { bg: 'bg-[rgba(214,59,31,0.08)]', text: 'text-[#D63B1F]' },
  security:      { bg: 'bg-[rgba(214,59,31,0.08)]', text: 'text-[#D63B1F]' },
}

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState('numbers')
  const [mobileShowContent, setMobileShowContent] = useState(false)

  const allItems = sections.flatMap(s => s.items)
  const currentItem = allItems.find(i => i.id === activeTab)

  const handleNavClick = (id) => {
    setActiveTab(id)
    setMobileShowContent(true)
  }

  return (
    <div className="h-full bg-[#F7F6F3]" style={{ display: 'flex' }}>

      {/* ── Sidebar / Mobile nav list ── */}
      <aside
        className={`${mobileShowContent ? 'hidden' : 'flex'} md:flex flex-col w-full md:w-56 shrink-0 bg-[#FFFFFF] border-r border-[#E3E1DB] overflow-y-auto`}
      >
        {/* Header */}
        <div className="px-4 pt-5 pb-3 border-b border-[#E3E1DB] md:px-5 md:pt-7 md:pb-5">
          <h2 className="text-[15px] md:text-[13px] font-semibold text-[#131210] tracking-tight">Settings</h2>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto pb-6">
          {sections.map((section, si) => (
            <div key={section.label} className={si > 0 ? 'border-t border-[#F0EEE9] mt-1' : ''}>
              {/* Section label */}
              <p className="px-4 pt-4 pb-1.5 text-[11px] font-semibold uppercase tracking-widest text-[#9B9890] md:px-3 md:pt-3 md:pb-1">
                {section.label}
              </p>
              {/* Items */}
              <div className="md:px-2 md:space-y-0.5">
                {section.items.map((item) => {
                  const active = activeTab === item.id
                  const color = iconColors[item.id] || { bg: 'bg-[#EFEDE8]', text: 'text-[#5C5A55]' }
                  return (
                    <button
                      key={item.id}
                      onClick={() => handleNavClick(item.id)}
                      className={`
                        w-full flex items-center gap-3 px-4 py-3 text-left transition-colors
                        border-b border-[#F7F6F3] last:border-0
                        md:border-0 md:gap-2.5 md:px-3 md:py-2 md:rounded-md md:mb-0.5
                        ${active
                          ? 'bg-[#F7F6F3] md:bg-[#EFEDE8]'
                          : 'bg-[#FFFFFF] hover:bg-[#F7F6F3]'
                        }
                      `}
                    >
                      {/* Icon box — larger on mobile, compact on desktop */}
                      <div className={`
                        w-9 h-9 rounded-xl flex items-center justify-center shrink-0
                        md:w-auto md:h-auto md:rounded-none md:flex-none md:bg-transparent
                        ${active ? `${color.bg}` : 'bg-[#F0EEE9] md:bg-transparent'}
                      `}>
                        <i className={`
                          fas ${item.icon} text-[13px]
                          md:text-[12px] md:w-3.5 md:text-center
                          ${active ? color.text : 'text-[#5C5A55] md:text-[#9B9890]'}
                        `} />
                      </div>

                      {/* Label + desc */}
                      <div className="flex-1 min-w-0">
                        <p className={`text-[13.5px] md:text-[13px] leading-tight ${active ? 'font-semibold text-[#131210]' : 'font-medium text-[#131210] md:font-normal md:text-[#5C5A55]'}`}>
                          {item.name}
                        </p>
                        <p className="text-[11.5px] text-[#9B9890] mt-0.5 md:hidden">{item.desc}</p>
                      </div>

                      {/* Chevron — mobile only */}
                      <i className="fas fa-chevron-right text-[11px] text-[#D4D1C9] shrink-0 md:hidden" />
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </nav>
      </aside>

      {/* ── Content panel ── */}
      <div
        className={`${mobileShowContent ? 'flex' : 'hidden'} md:flex flex-col flex-1 overflow-hidden`}
      >
        {/* Mobile top bar */}
        <div className="md:hidden flex items-center h-14 px-2 border-b border-[#E3E1DB] bg-[#FFFFFF] shrink-0">
          <button
            onClick={() => setMobileShowContent(false)}
            className="flex items-center justify-center w-10 h-10 rounded-xl hover:bg-[#F7F6F3] transition-colors"
          >
            <i className="fas fa-chevron-left text-[#131210] text-sm" />
          </button>
          <h2 className="flex-1 text-[15px] font-semibold text-[#131210] tracking-tight ml-1">
            {currentItem?.name || 'Settings'}
          </h2>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-auto p-4 md:p-7">
          {activeTab === 'numbers'    && <ManageNumbers />}
          {activeTab === 'members'    && <WorkspaceMembers />}
          {activeTab === 'templates'  && <MessageTemplates />}
          {activeTab === 'apikeys'    && <ApiKeys />}
          {activeTab === 'blocklist'  && <Blocklist />}
          {activeTab === 'ai'         && <AiSettings />}
          {activeTab === 'forwarding' && <CallForwarding />}
          {activeTab === 'referrals'  && <Referrals />}

          {['profile', 'notifications', 'security'].includes(activeTab) && (
            <div className="bg-[#FFFFFF] border border-[#E3E1DB] rounded-xl">
              <div className="px-5 py-4 border-b border-[#E3E1DB]">
                <h3 className="text-sm font-semibold text-[#131210]">{placeholders[activeTab].title}</h3>
              </div>
              <div className="px-5 py-10 text-center">
                <p className="text-sm text-[#9B9890]">{placeholders[activeTab].description}</p>
                <p className="text-xs text-[#D4D1C9] mt-1">Coming soon</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
