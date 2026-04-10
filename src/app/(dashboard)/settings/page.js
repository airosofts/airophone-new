'use client'

import { useState } from 'react'
import ManageNumbers from '@/components/settings/ManageNumbers'
import MessageTemplates from '@/components/settings/MessageTemplates'
import ApiKeys from '@/components/settings/ApiKeys'
import Blocklist from '@/components/settings/Blocklist'
import AiSettings from '@/components/settings/AiSettings'
import CallForwarding from '@/components/settings/CallForwarding'

const sections = [
  {
    label: 'Workspace',
    items: [
      { id: 'numbers',    name: 'Phone Numbers',     icon: 'fa-sim-card' },
      { id: 'templates',  name: 'Message Templates', icon: 'fa-layer-group' },
      { id: 'apikeys',    name: 'API Keys',           icon: 'fa-plug' },
      { id: 'blocklist',  name: 'Blocklist',          icon: 'fa-ban' },
      { id: 'ai',         name: 'AI Settings',        icon: 'fa-robot' },
      { id: 'forwarding', name: 'Call Forwarding',    icon: 'fa-phone-alt' },
    ],
  },
  {
    label: 'Account',
    items: [
      { id: 'profile',       name: 'Profile',         icon: 'fa-user-circle' },
      { id: 'notifications', name: 'Notifications',   icon: 'fa-bell' },
      { id: 'security',      name: 'Security',        icon: 'fa-shield-alt' },
    ],
  },
]

const placeholders = {
  profile:       { title: 'Profile', description: 'Manage your name, avatar and contact details.' },
  notifications: { title: 'Notifications', description: 'Choose what you want to be notified about.' },
  security:      { title: 'Security', description: 'Manage your password and two-factor authentication.' },
}

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState('numbers')

  return (
    <div className="h-full flex bg-[#F7F6F3]">

      {/* Settings sidebar */}
      <aside className="w-56 flex-shrink-0 bg-[#FFFFFF] border-r border-[#E3E1DB] flex flex-col overflow-y-auto">

        {/* Sidebar header */}
        <div className="px-5 pt-7 pb-5">
          <h2 className="text-[13px] font-semibold text-[#131210] tracking-tight">Settings</h2>
        </div>

        {/* Nav sections */}
        <nav className="flex-1 px-2 pb-6 space-y-5">
          {sections.map((section) => (
            <div key={section.label}>
              <p className="px-3 mb-1 text-[10.5px] font-semibold uppercase tracking-widest text-[#9B9890]">
                {section.label}
              </p>
              <div className="space-y-0.5">
                {section.items.map((item) => {
                  const active = activeTab === item.id
                  return (
                    <button
                      key={item.id}
                      onClick={() => setActiveTab(item.id)}
                      className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-[13px] transition-colors text-left ${
                        active
                          ? 'bg-[#EFEDE8] text-[#131210] font-medium'
                          : 'text-[#9B9890] hover:bg-[#F7F6F3] hover:text-[#131210]'
                      }`}
                    >
                      <i className={`fas ${item.icon} text-[12px] w-3.5 text-center flex-shrink-0 ${active ? 'text-[#D63B1F]' : 'text-[#9B9890]'}`} />
                      <span>{item.name}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </nav>
      </aside>

      {/* Content */}
      <div className="flex-1 overflow-auto p-7">
        {activeTab === 'numbers'   && <ManageNumbers />}
        {activeTab === 'templates' && <MessageTemplates />}
        {activeTab === 'apikeys'   && <ApiKeys />}
        {activeTab === 'blocklist' && <Blocklist />}
        {activeTab === 'ai'        && <AiSettings />}
        {activeTab === 'forwarding' && <CallForwarding />}

        {['profile', 'notifications', 'security'].includes(activeTab) && (
          <div className="bg-[#FFFFFF] border border-[#E3E1DB] rounded-lg">
            <div className="px-5 py-4 border-b border-[#E3E1DB]">
              <h3 className="text-sm font-semibold text-[#131210]">{placeholders[activeTab].title}</h3>
            </div>
            <div className="px-5 py-8 text-center">
              <p className="text-sm text-[#9B9890]">{placeholders[activeTab].description}</p>
              <p className="text-xs text-[#D4D1C9] mt-1">Coming soon</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
