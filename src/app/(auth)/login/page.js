'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { loginWithEmailPassword } from '@/lib/auth'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const router = useRouter()

  const handleLogin = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      await loginWithEmailPassword(email, password)
      router.push('/inbox')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex overflow-hidden relative bg-gradient-to-br from-gray-50 via-white to-gray-100">
      {/* Animated blob backgrounds */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-gradient-to-br from-[#C54A3F]/20 to-[#B73E34]/10 rounded-full blur-3xl animate-blob"></div>
        <div className="absolute top-1/2 -left-40 w-96 h-96 bg-gradient-to-br from-[#B73E34]/15 to-[#C54A3F]/20 rounded-full blur-3xl animate-blob animation-delay-2000"></div>
        <div className="absolute -bottom-40 right-1/3 w-96 h-96 bg-gradient-to-br from-[#C54A3F]/10 to-purple-400/10 rounded-full blur-3xl animate-blob animation-delay-4000"></div>
        <div className="absolute top-1/4 right-1/4 w-72 h-72 bg-gradient-to-br from-orange-300/10 to-[#C54A3F]/15 rounded-full blur-3xl animate-blob animation-delay-6000"></div>
      </div>

      <style jsx>{`
        @keyframes blob {
          0%, 100% {
            transform: translate(0, 0) scale(1);
          }
          33% {
            transform: translate(30px, -50px) scale(1.1);
          }
          66% {
            transform: translate(-20px, 20px) scale(0.9);
          }
        }
        .animate-blob {
          animation: blob 7s infinite;
        }
        .animation-delay-2000 {
          animation-delay: 2s;
        }
        .animation-delay-4000 {
          animation-delay: 4s;
        }
        .animation-delay-6000 {
          animation-delay: 6s;
        }
      `}</style>

      {/* Left Panel - Enhanced Brand Section */}
      <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 relative overflow-hidden">
        {/* Animated background pattern */}
        <div className="absolute inset-0 opacity-[0.03]">
          <div className="absolute inset-0" style={{
            backgroundImage: 'radial-gradient(circle at 2px 2px, white 1px, transparent 0)',
            backgroundSize: '32px 32px'
          }}></div>
        </div>

        {/* Colorful gradient blobs */}
        <div className="absolute top-0 right-0 w-96 h-96 bg-gradient-to-br from-[#C54A3F]/30 to-purple-500/20 rounded-full blur-3xl animate-blob"></div>
        <div className="absolute bottom-0 left-0 w-96 h-96 bg-gradient-to-br from-blue-500/20 to-[#C54A3F]/30 rounded-full blur-3xl animate-blob animation-delay-4000"></div>
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-gradient-to-br from-orange-400/20 to-pink-500/20 rounded-full blur-3xl animate-blob animation-delay-2000"></div>

        {/* Glass morphism overlay */}
        <div className="absolute inset-0 bg-gradient-to-br from-slate-900/50 to-transparent backdrop-blur-3xl"></div>

        <div className="relative z-10 flex flex-col items-center justify-center p-12 text-white w-full">
          <div className="max-w-lg space-y-8 animate-slideUp text-center">
            {/* Logo */}
            <div className="flex items-center justify-center space-x-3">
              <div className="w-14 h-14 bg-gradient-to-br from-[#C54A3F] to-[#B73E34] backdrop-blur-md rounded-2xl flex items-center justify-center shadow-lg shadow-[#C54A3F]/20">
                <svg className="w-7 h-7" fill="currentColor" viewBox="0 0 512 512">
                  <path d="M164.9 24.6c-7.7-18.6-28-28.5-47.4-23.2l-88 24C12.1 30.2 0 46 0 64C0 311.4 200.6 512 448 512c18 0 33.8-12.1 38.6-29.5l24-88c5.3-19.4-4.6-39.7-23.2-47.4l-96-40c-16.3-6.8-35.2-2.1-46.3 11.6L304.7 368C234.3 334.7 177.3 277.7 144 207.3L193.3 167c13.7-11.2 18.4-30 11.6-46.3l-40-96z"/>
                </svg>
              </div>
              <span className="text-3xl font-bold tracking-tight">AiroPhone</span>
            </div>

            {/* Main Content */}
            <div>
              <h1 className="text-5xl font-bold mb-4 leading-tight bg-gradient-to-br from-white via-white to-gray-300 bg-clip-text text-transparent">
                Unified SMS Platform
              </h1>
              <p className="text-lg text-gray-400 leading-relaxed">
                Manage all your business SMS conversations in one powerful platform with team collaboration
              </p>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-3 gap-8 pt-4">
              <div className="space-y-1">
                <div className="text-3xl font-bold bg-gradient-to-r from-[#C54A3F] to-orange-400 bg-clip-text text-transparent">99.9%</div>
                <div className="text-xs text-gray-500">Uptime</div>
              </div>
              <div className="space-y-1">
                <div className="text-3xl font-bold bg-gradient-to-r from-[#C54A3F] to-orange-400 bg-clip-text text-transparent">2M+</div>
                <div className="text-xs text-gray-500">Messages</div>
              </div>
              <div className="space-y-1">
                <div className="text-3xl font-bold bg-gradient-to-r from-[#C54A3F] to-orange-400 bg-clip-text text-transparent">24/7</div>
                <div className="text-xs text-gray-500">Support</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Right Panel - Enhanced Login Form */}
      <div className="flex-1 flex items-center justify-center p-6 sm:p-8 relative z-10">
        <div className="w-full max-w-md">
          {/* Mobile Header */}
          <div className="lg:hidden mb-6 text-center animate-fadeIn">
            <div className="inline-flex items-center justify-center w-14 h-14 bg-gradient-to-br from-[#C54A3F] to-[#B73E34] rounded-2xl mb-3 shadow-lg">
              <svg className="w-7 h-7 text-white" fill="currentColor" viewBox="0 0 512 512">
                <path d="M164.9 24.6c-7.7-18.6-28-28.5-47.4-23.2l-88 24C12.1 30.2 0 46 0 64C0 311.4 200.6 512 448 512c18 0 33.8-12.1 38.6-29.5l24-88c5.3-19.4-4.6-39.7-23.2-47.4l-96-40c-16.3-6.8-35.2-2.1-46.3 11.6L304.7 368C234.3 334.7 177.3 277.7 144 207.3L193.3 167c13.7-11.2 18.4-30 11.6-46.3l-40-96z"/>
              </svg>
            </div>
            <h2 className="text-2xl font-bold bg-gradient-to-r from-gray-900 to-gray-700 bg-clip-text text-transparent">AiroPhone</h2>
          </div>

          {/* Card Container */}
          <div className="bg-white/90 backdrop-blur-xl rounded-3xl shadow-2xl border border-gray-200/50 p-6 sm:p-8 animate-slideUp hover:shadow-[#C54A3F]/10 hover:shadow-3xl transition-shadow duration-500">
            {/* Header */}
            <div className="mb-6">
              <h2 className="text-2xl font-bold text-gray-900 mb-1 bg-gradient-to-r from-gray-900 to-gray-700 bg-clip-text text-transparent">
                Welcome back
              </h2>
              <p className="text-gray-600 text-sm">Sign in to continue</p>
            </div>

            {/* Form */}
            <form className="space-y-4" onSubmit={handleLogin}>
              {/* Email */}
              <div className="group">
                <label htmlFor="email" className="block text-sm font-semibold text-gray-700 mb-1.5 group-focus-within:text-[#C54A3F] transition-colors">
                  Email
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                    <svg className="h-5 w-5 text-gray-400 group-focus-within:text-[#C54A3F] transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 12a4 4 0 10-8 0 4 4 0 008 0zm0 0v1.5a2.5 2.5 0 005 0V12a9 9 0 10-9 9m4.5-1.206a8.959 8.959 0 01-4.5 1.207" />
                    </svg>
                  </div>
                  <input
                    id="email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full pl-11 pr-4 py-3 border-2 border-gray-300 rounded-xl focus:outline-none focus:ring-4 focus:ring-[#C54A3F]/10 focus:border-[#C54A3F] transition-all duration-200 bg-white/70 backdrop-blur-sm hover:bg-white hover:border-gray-400"
                    placeholder="you@company.com"
                  />
                </div>
              </div>

              {/* Password */}
              <div className="group">
                <label htmlFor="password" className="block text-sm font-semibold text-gray-700 mb-1.5 group-focus-within:text-[#C54A3F] transition-colors">
                  Password
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                    <svg className="h-5 w-5 text-gray-400 group-focus-within:text-[#C54A3F] transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                  </div>
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full pl-11 pr-11 py-3 border-2 border-gray-300 rounded-xl focus:outline-none focus:ring-4 focus:ring-[#C54A3F]/10 focus:border-[#C54A3F] transition-all duration-200 bg-white/70 backdrop-blur-sm hover:bg-white hover:border-gray-400"
                    placeholder="Enter your password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-[#C54A3F] transition-colors p-1 hover:bg-gray-100 rounded-lg"
                  >
                    {showPassword ? (
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                      </svg>
                    ) : (
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>

              {/* Error */}
              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3.5 rounded-xl text-sm flex items-start space-x-3 animate-fadeIn">
                  <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd"/>
                  </svg>
                  <span>{error}</span>
                </div>
              )}

              {/* Submit Button */}
              <button
                type="submit"
                disabled={loading}
                className={`group relative w-full py-3 px-4 rounded-xl font-semibold text-white transition-all duration-300 shadow-lg overflow-hidden ${
                  loading
                    ? 'bg-gray-400 cursor-not-allowed'
                    : 'bg-gradient-to-r from-[#C54A3F] to-[#B73E34] hover:from-[#B73E34] hover:to-[#A53329] hover:shadow-xl hover:shadow-[#C54A3F]/30 active:scale-[0.98] hover:-translate-y-0.5'
                }`}
              >
                <div className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/20 to-white/0 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000"></div>
                {loading ? (
                  <span className="flex items-center justify-center relative z-10">
                    <svg className="animate-spin -ml-1 mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Signing in...
                  </span>
                ) : (
                  <span className="relative z-10 flex items-center justify-center gap-2">
                    Sign in
                    <svg className="w-4 h-4 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                    </svg>
                  </span>
                )}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  )
}