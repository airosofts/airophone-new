// components/Sidebar.jsx
'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { logout } from '@/lib/auth'
import { apiGet } from '@/lib/api-client'
import { validateAndUpgradeSession } from '@/lib/session-validator'

export default function Sidebar({ user, currentPath, onClose }) {
  const [phoneNumbers, setPhoneNumbers] = useState([])
  const [loading, setLoading] = useState(true)
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  // Get the currently selected phone number from URL
  const selectedPhoneNumber = searchParams?.get('from')

  useEffect(() => {
    const init = async () => {
      await validateAndUpgradeSession()
      fetchPhoneNumbers()
    }
    init()
  }, [])

  const fetchPhoneNumbers = async () => {
    try {
      const response = await apiGet('/api/phone-numbers')
      const data = await response.json()
      if (data.success) {
        setPhoneNumbers(data.phoneNumbers || [])
      } else {
        console.error('Failed to fetch phone numbers:', data.error)
        // Don't clear existing numbers on error - keep showing what we have
      }
    } catch (error) {
      console.error('Error fetching phone numbers:', error)
      // Don't clear existing numbers on error - smooth experience
    } finally {
      setLoading(false)
    }
  }

  const formatPhoneNumber = (phone) => {
    if (!phone) return phone
    const digits = phone.replace(/\D/g, '')
    const withoutCountry = digits.startsWith('1') && digits.length === 11 ? digits.slice(1) : digits

    if (withoutCountry.length === 10) {
      return `(${withoutCountry.slice(0, 3)}) ${withoutCountry.slice(3, 6)}-${withoutCountry.slice(6)}`
    }
    return phone
  }

  const navigation = [
    { name: 'Inbox', href: '/inbox', icon: 'fa-inbox' },
    { name: 'Contacts', href: '/contacts', icon: 'fa-address-book' },
    { name: 'Campaigns', href: '/campaigns', icon: 'fa-bullhorn' },
    { name: 'Scenarios', href: '/scenarios', icon: 'fa-robot' },
    { name: 'Credits', href: '/billing', icon: 'fa-coins' },
    { name: 'Settings', href: '/settings', icon: 'fa-cog' },
  ]

  const handleLogout = () => {
    logout()
  }

  const handlePhoneNumberClick = (phoneNumber) => {
    router.push(`/inbox?from=${encodeURIComponent(phoneNumber)}`)
  }

  return (
    <div className="w-56 h-screen bg-white border-r border-gray-200 flex flex-col z-40">
      {/* Header */}
      <div className="px-4 py-4 border-b border-gray-100">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-[#C54A3F] rounded-lg flex items-center justify-center flex-shrink-0">
              <i className="fas fa-comments text-white text-sm"></i>
            </div>
            <h1 className="text-sm font-semibold text-gray-900 tracking-tight">AiroPhone</h1>
          </div>
          {onClose && (
            <button onClick={onClose} className="lg:hidden p-1 hover:bg-gray-100 rounded">
              <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-2 py-3 overflow-y-auto space-y-5">
        {/* Main nav */}
        <div className="space-y-0.5">
          {navigation.map((item) => {
            const isActive = pathname?.startsWith(item.href)
            return (
              <Link
                key={item.name}
                href={item.href}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-md text-[13px] transition-colors ${
                  isActive
                    ? 'bg-gray-100 text-gray-900 font-medium'
                    : 'text-gray-500 hover:bg-gray-50 hover:text-gray-800'
                }`}
              >
                <i className={`fas ${item.icon} text-[12px] w-3.5 text-center flex-shrink-0 ${isActive ? 'text-[#C54A3F]' : 'text-gray-400'}`}></i>
                <span>{item.name}</span>
              </Link>
            )
          })}
        </div>

        {/* Phone Numbers Section */}
        <div>
          <p className="px-3 mb-1 text-[10.5px] font-semibold uppercase tracking-widest text-gray-400">
            Phone Numbers
          </p>
          <div className="space-y-0.5">
            {phoneNumbers.map((phone) => {
              const isSelected = selectedPhoneNumber === phone.phoneNumber
              return (
                <button
                  key={phone.id}
                  onClick={() => handlePhoneNumberClick(phone.phoneNumber)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 text-[13px] rounded-md transition-colors text-left ${
                    isSelected
                      ? 'bg-gray-100 text-gray-900'
                      : 'text-gray-500 hover:bg-gray-50 hover:text-gray-800'
                  }`}
                >
                  <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                    phone.status === 'active' || phone.status === 'purchased'
                      ? 'bg-green-500'
                      : 'bg-yellow-400'
                  }`} />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">
                      {phone.custom_name || formatPhoneNumber(phone.phoneNumber)}
                    </p>
                    {phone.custom_name && (
                      <p className="text-[11px] text-gray-400 truncate">
                        {formatPhoneNumber(phone.phoneNumber)}
                      </p>
                    )}
                  </div>
                </button>
              )
            })}

            {phoneNumbers.length === 0 && !loading && (
              <p className="px-3 py-2 text-xs text-gray-400">No phone numbers yet</p>
            )}
          </div>
        </div>
      </nav>

      {/* User Profile */}
      <div className="border-t border-gray-100 p-3">
        <div className="flex items-center gap-2.5 px-2 py-2 rounded-md hover:bg-gray-50 transition-colors group cursor-pointer">
          <div className="relative flex-shrink-0">
            {user?.profile_photo_url ? (
              <img src={user.profile_photo_url} alt={user.name} className="w-7 h-7 rounded-full" />
            ) : (
              <div className="w-7 h-7 bg-[#C54A3F] rounded-full flex items-center justify-center">
                <span className="text-xs font-semibold text-white">
                  {user?.name?.charAt(0)?.toUpperCase()}
                </span>
              </div>
            )}
            <div className="absolute bottom-0 right-0 w-2 h-2 bg-green-500 border-2 border-white rounded-full" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-medium text-gray-900 truncate leading-tight">{user?.name}</p>
            <p className="text-[11px] text-gray-400 truncate">{user?.email}</p>
          </div>
          <button
            onClick={handleLogout}
            className="p-1 text-gray-400 hover:text-gray-700 opacity-0 group-hover:opacity-100 transition-opacity"
            title="Sign out"
          >
            <i className="fas fa-sign-out-alt text-xs"></i>
          </button>
        </div>
      </div>
    </div>
  )
}
