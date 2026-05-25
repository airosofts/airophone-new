// Iframe-able onboarding page for the Monday marketplace App Onboarding
// feature. Shown inside monday.com immediately after a user installs the
// airophone app — gives them a one-paragraph orientation and a single CTA
// that punts them out to app.airophone.com to finish setup.
//
// Public route — must be reachable without a session (Monday users haven't
// signed into AiroPhone yet). Added to PUBLIC_ROUTES in middleware.js.

export const metadata = {
  title: 'Welcome to AiroPhone',
  description: 'Connect your monday.com workspace to AiroPhone — automated SMS for every lead.',
}

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://app.airophone.com'

const STEPS = [
  {
    n: 1,
    title: 'Create your AiroPhone account',
    body: 'Sign up at app.airophone.com (free to start) and pick a phone number for your sends.',
  },
  {
    n: 2,
    title: 'Connect this monday account',
    body: 'In AiroPhone → Settings → Integrations → click Connect Monday. One-click OAuth.',
  },
  {
    n: 3,
    title: 'Build your first automation',
    body: 'Pick a board, choose "New item created", write your SMS template — leads get texted automatically.',
  },
]

export default function MondayWelcomePage() {
  return (
    <div style={{ minHeight: '100vh', background: '#F7F6F3' }}>
      <div style={{ maxWidth: 640, margin: '0 auto', padding: '48px 32px' }}>
        {/* Brand */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 32 }}>
          <div style={{
            width: 44, height: 44, borderRadius: 12,
            background: '#D63B1F', color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 700, fontSize: 22, letterSpacing: '-0.04em',
          }}>A</div>
          <div>
            <p style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#131210', letterSpacing: '-0.02em' }}>AiroPhone</p>
            <p style={{ margin: 0, fontSize: 12, color: '#9B9890', fontFamily: "var(--font-mono)" }}>
              MONDAY INTEGRATION
            </p>
          </div>
        </div>

        {/* Hero */}
        <h1 style={{
          fontSize: 28, fontWeight: 700, color: '#131210',
          letterSpacing: '-0.03em', lineHeight: 1.25, marginBottom: 12,
        }}>
          Text every new monday lead — automatically.
        </h1>
        <p style={{ fontSize: 15, color: '#5C5A55', lineHeight: 1.6, marginBottom: 32 }}>
          AiroPhone watches your monday boards and sends a personalized SMS the moment a lead lands. Replies are
          handled by an AI scenario; when a lead replies, their monday status updates itself. You stay in monday;
          the conversation happens on autopilot.
        </p>

        {/* Steps */}
        <div style={{
          background: '#fff', border: '1px solid #E3E1DB', borderRadius: 14,
          padding: 24, marginBottom: 24,
        }}>
          <p style={{
            margin: '0 0 16px 0', fontSize: 11, fontWeight: 600,
            color: '#9B9890', letterSpacing: '0.08em', textTransform: 'uppercase',
          }}>
            Three steps to get going
          </p>
          {STEPS.map((s, i) => (
            <div key={s.n} style={{
              display: 'flex', gap: 14, paddingTop: i === 0 ? 0 : 14,
              paddingBottom: i === STEPS.length - 1 ? 0 : 14,
              borderBottom: i === STEPS.length - 1 ? 'none' : '1px solid #F0EEE9',
            }}>
              <div style={{
                flexShrink: 0, width: 24, height: 24, borderRadius: 12,
                background: 'rgba(214,59,31,0.07)', color: '#D63B1F',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12, fontWeight: 700,
              }}>{s.n}</div>
              <div>
                <p style={{ margin: '2px 0 4px 0', fontSize: 14, fontWeight: 600, color: '#131210' }}>{s.title}</p>
                <p style={{ margin: 0, fontSize: 13, color: '#5C5A55', lineHeight: 1.5 }}>{s.body}</p>
              </div>
            </div>
          ))}
        </div>

        {/* CTAs — open in new tab because we're iframed inside monday.com */}
        <a
          href={APP_URL}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'inline-block', padding: '12px 22px', borderRadius: 10,
            background: '#D63B1F', color: '#fff', textDecoration: 'none',
            fontWeight: 600, fontSize: 14, letterSpacing: '-0.005em',
          }}
        >
          Open AiroPhone →
        </a>
        <a
          href={`${APP_URL}/signup`}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            marginLeft: 12, display: 'inline-block', padding: '12px 18px', borderRadius: 10,
            border: '1px solid #E3E1DB', color: '#5C5A55', textDecoration: 'none',
            fontWeight: 500, fontSize: 14, background: '#fff',
          }}
        >
          Create account
        </a>

        {/* Footer */}
        <p style={{ marginTop: 40, fontSize: 12, color: '#9B9890', lineHeight: 1.6 }}>
          Need help? Email <a href="mailto:support@airophone.com" style={{ color: '#D63B1F', textDecoration: 'none' }}>support@airophone.com</a>.
          Read the integration guide at <a href={APP_URL} target="_blank" rel="noopener noreferrer" style={{ color: '#D63B1F', textDecoration: 'none' }}>app.airophone.com</a>.
        </p>
      </div>
    </div>
  )
}
