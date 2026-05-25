/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [
      {
        // The Monday "App Onboarding" feature iframes this page inside
        // monday.com after install. Browsers default to X-Frame-Options:
        // SAMEORIGIN via Next's hosts, so we must explicitly allow monday.
        source: '/integrations/monday/welcome',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: "frame-ancestors 'self' https://*.monday.com https://monday.com",
          },
          // Some legacy embeds still check X-Frame-Options. ALLOW-FROM is
          // deprecated; the safest cross-browser stance is to omit XFO and
          // rely on CSP frame-ancestors, which always wins when both are set.
          // Explicitly clear any inherited DENY/SAMEORIGIN.
          { key: 'X-Frame-Options', value: '' },
        ],
      },
      {
        // Recipe execute / dropdown endpoints are called server-to-server
        // by monday.com — no browser, no frame. But we still want them out
        // of any default frame-deny so Monday's preview tooling can hit them.
        source: '/api/integrations/monday/recipe/:path*',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: "frame-ancestors 'self' https://*.monday.com https://monday.com",
          },
          { key: 'X-Frame-Options', value: '' },
        ],
      },
    ]
  },
}

export default nextConfig
