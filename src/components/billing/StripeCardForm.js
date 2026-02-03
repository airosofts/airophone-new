'use client'

import { useState } from 'react'
import { loadStripe } from '@stripe/stripe-js'
import { Elements, CardElement, useStripe, useElements } from '@stripe/react-stripe-js'

// Initialize Stripe
const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY)

// Card element styling
const CARD_ELEMENT_OPTIONS = {
  style: {
    base: {
      color: '#1f2937',
      fontFamily: 'system-ui, sans-serif',
      fontSmoothing: 'antialiased',
      fontSize: '16px',
      '::placeholder': {
        color: '#9ca3af'
      }
    },
    invalid: {
      color: '#ef4444',
      iconColor: '#ef4444'
    }
  }
}

// The actual form component
function CardForm({ onSuccess, onError, onClose, user }) {
  const stripe = useStripe()
  const elements = useElements()
  const [loading, setLoading] = useState(false)
  const [cardholderName, setCardholderName] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()

    if (!stripe || !elements) {
      return
    }

    if (!cardholderName.trim()) {
      onError({
        title: 'Missing Information',
        message: 'Please enter the cardholder name'
      })
      return
    }

    setLoading(true)

    try {
      const cardElement = elements.getElement(CardElement)

      // Create payment method using Stripe.js (secure, PCI compliant)
      const { error, paymentMethod } = await stripe.createPaymentMethod({
        type: 'card',
        card: cardElement,
        billing_details: {
          name: cardholderName
        }
      })

      if (error) {
        onError({
          title: 'Card Error',
          message: error.message
        })
        setLoading(false)
        return
      }

      // Send only the payment method ID to your server (NOT card details)
      const response = await fetch('/api/payment-methods', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': user?.userId || ''
        },
        body: JSON.stringify({
          payment_method_id: paymentMethod.id,
          cardholder_name: cardholderName
        })
      })

      const data = await response.json()

      if (data.success) {
        onSuccess()
      } else {
        onError({
          title: 'Failed to Add Card',
          message: data.error || 'An error occurred while adding your card.'
        })
      }
    } catch (error) {
      console.error('Error adding card:', error)
      onError({
        title: 'Error',
        message: 'An unexpected error occurred. Please try again.'
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-2">
          <i className="fas fa-user mr-1"></i>
          Cardholder Name *
        </label>
        <input
          type="text"
          required
          value={cardholderName}
          onChange={(e) => setCardholderName(e.target.value)}
          className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#C54A3F] focus:border-transparent"
          placeholder="John Doe"
          disabled={loading}
        />
      </div>

      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-2">
          <i className="fas fa-credit-card mr-1"></i>
          Card Details *
        </label>
        <div className="w-full px-4 py-3 border border-gray-300 rounded-xl focus-within:ring-2 focus-within:ring-[#C54A3F] focus-within:border-transparent">
          <CardElement options={CARD_ELEMENT_OPTIONS} />
        </div>
        <p className="text-xs text-gray-500 mt-2">
          <i className="fas fa-shield-alt mr-1"></i>
          Secure payment processing powered by Stripe
        </p>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
        <p className="text-xs text-blue-800">
          <i className="fas fa-lock mr-2"></i>
          Your payment information is encrypted and secure. Card details never touch our servers.
        </p>
      </div>

      <div className="flex space-x-3 pt-4">
        <button
          type="button"
          onClick={onClose}
          disabled={loading}
          className="flex-1 px-4 py-3 text-sm font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-xl transition-colors disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={loading || !stripe}
          className="flex-1 px-4 py-3 text-sm font-semibold text-white bg-gradient-to-r from-[#C54A3F] to-[#B73E34] hover:from-[#B73E34] hover:to-[#A53329] rounded-xl transition-all shadow-lg hover:shadow-xl disabled:bg-gray-300 disabled:cursor-not-allowed disabled:from-gray-300 disabled:to-gray-300"
        >
          {loading ? (
            <>
              <i className="fas fa-spinner fa-spin mr-2"></i>
              Adding Card...
            </>
          ) : (
            <>
              <i className="fas fa-plus mr-2"></i>
              Add Card
            </>
          )}
        </button>
      </div>
    </form>
  )
}

// Wrapper component with Stripe Elements provider
export default function StripeCardForm({ onSuccess, onError, onClose, user }) {
  return (
    <Elements stripe={stripePromise}>
      <CardForm
        onSuccess={onSuccess}
        onError={onError}
        onClose={onClose}
        user={user}
      />
    </Elements>
  )
}
