'use client'

import { useState } from 'react'
import ManageNumbers from '@/components/settings/ManageNumbers'
import MessageTemplates from '@/components/settings/MessageTemplates'

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState('numbers')

  const tabs = [
    { id: 'numbers', name: 'Manage Numbers', icon: 'fa-phone' },
    { id: 'templates', name: 'Message Templates', icon: 'fa-file-alt' },
    { id: 'profile', name: 'Profile', icon: 'fa-user' },
    { id: 'notifications', name: 'Notifications', icon: 'fa-bell' },
    { id: 'security', name: 'Security', icon: 'fa-lock' },
  ]

  return (
    <div className="h-full bg-gray-50 flex flex-col">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 p-6 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Settings</h1>
            <p className="text-sm text-gray-500 mt-1">
              Manage your account settings and preferences
            </p>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-7xl mx-auto">
          {/* Tabs */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 mb-6">
            <div className="border-b border-gray-200">
              <nav className="flex space-x-8 px-6" aria-label="Tabs">
                {tabs.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`
                      py-4 px-1 border-b-2 font-medium text-sm transition-colors
                      ${
                        activeTab === tab.id
                          ? 'border-[#C54A3F] text-[#C54A3F]'
                          : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                      }
                    `}
                  >
                    <i className={`fas ${tab.icon} mr-2`}></i>
                    {tab.name}
                  </button>
                ))}
              </nav>
            </div>
          </div>

          {/* Tab Content */}
          <div>
            {activeTab === 'numbers' && <ManageNumbers />}
            {activeTab === 'templates' && <MessageTemplates />}
            {activeTab === 'profile' && (
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8">
                <h2 className="text-xl font-bold text-gray-900 mb-4">Profile Settings</h2>
                <p className="text-gray-500">Profile settings coming soon...</p>
              </div>
            )}
            {activeTab === 'notifications' && (
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8">
                <h2 className="text-xl font-bold text-gray-900 mb-4">Notification Settings</h2>
                <p className="text-gray-500">Notification settings coming soon...</p>
              </div>
            )}
            {activeTab === 'security' && (
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8">
                <h2 className="text-xl font-bold text-gray-900 mb-4">Security Settings</h2>
                <p className="text-gray-500">Security settings coming soon...</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
