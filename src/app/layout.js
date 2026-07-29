// src/app/layout.js
import Script from 'next/script'
import { Plus_Jakarta_Sans, JetBrains_Mono } from 'next/font/google'
import './globals.css'
import AudioUnlock from '@/components/AudioUnlock'
import PushSetup from '@/components/PushSetup'
import AnalyticsProvider from '@/components/AnalyticsProvider'

// Google tag (gtag.js) — hardcoded, loads on every page via the root layout.
const GA_MEASUREMENT_ID = 'G-1DQJB2E530'
// Google Ads account id — enables direct Ads conversion tracking (see
// src/lib/google-conversions.js). Provided by the ads manager; env overrides.
const GOOGLE_ADS_ID = process.env.NEXT_PUBLIC_GOOGLE_ADS_ID || 'AW-18356615565'
// Google Tag Manager container — provided by the ads team (Tahir). GTM shares
// window.dataLayer with the gtag.js tag below; conversion events also push
// plain {event: ...} entries so GTM custom-event triggers can fire on them.
const GTM_CONTAINER_ID = 'GTM-MN5DZCVZ'

const jakarta = Plus_Jakarta_Sans({ subsets: ['latin'], weight: ['300', '400', '500', '600'], variable: '--font-sans' })
const jetbrains = JetBrains_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-mono' })

export const metadata = {
  title: 'AiroPhone — Business Calls & Messaging, Automated',
  description: 'Manage your business conversations, run bulk SMS campaigns, and let AI handle replies — all from one app.',
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
    ],
    apple: '/apple-touch-icon.png',
  },
  manifest: '/site.webmanifest',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link
          rel="stylesheet"
          href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css"
          integrity="sha512-DTOQO9RWCH3ppGqcWaEA1BIZOC6xxalwEsw9c2QQeAIftl+Vegovlnee1c9QX4TctnWMn13TZye+giMm8e2LwA=="
          crossOrigin="anonymous"
          referrerPolicy="no-referrer"
        />
        {/* Google Tag Manager — container managed by the ads team */}
        <Script id="google-tag-manager" strategy="afterInteractive">
          {`(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
            new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
            j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
            'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
            })(window,document,'script','dataLayer','${GTM_CONTAINER_ID}');`}
        </Script>
        {/* Google tag (gtag.js) */}
        <Script
          src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`}
          strategy="afterInteractive"
        />
        <Script id="google-analytics" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', '${GA_MEASUREMENT_ID}');
            ${GOOGLE_ADS_ID ? `gtag('config', '${GOOGLE_ADS_ID}');` : ''}
          `}
        </Script>
      </head>
      <body className={`${jakarta.variable} ${jetbrains.variable} ${jakarta.className}`}>
        {/* Google Tag Manager (noscript) */}
        <noscript>
          <iframe
            src={`https://www.googletagmanager.com/ns.html?id=${GTM_CONTAINER_ID}`}
            height="0"
            width="0"
            style={{ display: 'none', visibility: 'hidden' }}
          />
        </noscript>
        <AudioUnlock />
        <PushSetup />
        <AnalyticsProvider>{children}</AnalyticsProvider>
      </body>
    </html>
  )
}
