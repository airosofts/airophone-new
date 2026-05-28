// Public "How to use" docs page for the monday.com marketplace listing.
// Long-form, screenshot-free — all UI illustrations are inline CSS/SVG
// mockups so the page works without the maintenance burden of real
// screenshots. Linked from the marketplace submission's "How to use Link"
// field. Sits in PUBLIC_ROUTES (no session required).

export const metadata = {
  title: 'AiroPhone × monday.com — Setup Guide',
  description: 'Connect monday.com to AiroPhone, build your first recipe, and start texting leads automatically.',
}

// ── Design tokens ───────────────────────────────────────────────────────────
const ink = '#131210'
const muted = '#5C5A55'
const fade = '#9B9890'
const line = '#E3E1DB'
const lineSoft = '#F0EEE9'
const bg = '#F7F6F3'
const accent = '#D63B1F'
const mondayBlue = '#0073EA'

// Step contents ─────────────────────────────────────────────────────────────
const STEPS = [
  {
    n: 1,
    h: 'Sign up for AiroPhone',
    body: 'Create your AiroPhone account at app.airophone.com. Pick a phone number for your sends (US 10DLC numbers are compliant with carrier rules out of the box).',
  },
  {
    n: 2,
    h: 'Install AiroPhone on monday',
    body: 'In monday.com → Apps marketplace → search "AiroPhone" → Install. Your monday admin must approve the install once; everyone on the workspace can use it after.',
  },
  {
    n: 3,
    h: 'Connect monday from AiroPhone',
    body: 'In AiroPhone → Settings → Integrations → click Connect Monday. One-click OAuth — you stay logged into both products.',
  },
  {
    n: 4,
    h: 'Add the recipe to a board',
    body: 'Open the board where new leads land → Integrate → search AiroPhone → pick "When an item is created, send an AiroPhone SMS…". Fill in phone column, sender number, and message.',
  },
  {
    n: 5,
    h: 'Watch it work',
    body: 'Create a new item on the board. Within ~30 seconds, the lead receives a personalized SMS. Replies show up in your AiroPhone inbox; the monday status column updates automatically when the lead replies.',
  },
]

const PLACEHOLDERS = [
  { key: '{pulse.name}',          desc: 'Item title (usually the lead\'s name)' },
  { key: '{pulse.<ColumnTitle>}', desc: 'Any column on the item — e.g. {pulse.Email}, {pulse.Company}' },
  { key: '{name}',                desc: 'Short alias for the item title' },
  { key: '{<column_slug>}',       desc: 'Slug-cased column name — e.g. {deal_size}, {first_name}' },
]

// ── Shared inline components ────────────────────────────────────────────────

function Section({ id, eyebrow, title, children }) {
  return (
    <section id={id} style={{ marginTop: 56, scrollMarginTop: 24 }}>
      <p style={{
        margin: 0, fontSize: 11, fontWeight: 600, color: accent,
        letterSpacing: '0.12em', textTransform: 'uppercase', fontFamily: 'var(--font-mono)',
      }}>{eyebrow}</p>
      <h2 style={{
        margin: '6px 0 18px 0', fontSize: 26, fontWeight: 700,
        color: ink, letterSpacing: '-0.025em', lineHeight: 1.2,
      }}>{title}</h2>
      <div style={{ fontSize: 15, color: muted, lineHeight: 1.7 }}>{children}</div>
    </section>
  )
}

function Card({ children, style }) {
  return (
    <div style={{
      background: '#fff', border: `1px solid ${line}`, borderRadius: 14,
      padding: 0, overflow: 'hidden',
      boxShadow: '0 1px 0 rgba(19,18,16,0.02), 0 8px 24px -16px rgba(19,18,16,0.12)',
      ...style,
    }}>{children}</div>
  )
}

// Fake browser window chrome — wraps any UI mockup so it reads as "this is
// a screen, not part of the docs page proper".
function BrowserFrame({ url, children }) {
  return (
    <div style={{
      background: '#fff', border: `1px solid ${line}`, borderRadius: 12,
      overflow: 'hidden',
      boxShadow: '0 1px 0 rgba(19,18,16,0.02), 0 16px 40px -24px rgba(19,18,16,0.18)',
      margin: '20px 0',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 14px', borderBottom: `1px solid ${lineSoft}`,
        background: '#FAFAF8',
      }}>
        <div style={{ display: 'flex', gap: 6 }}>
          <div style={{ width: 10, height: 10, borderRadius: 5, background: '#FF5F57' }} />
          <div style={{ width: 10, height: 10, borderRadius: 5, background: '#FEBC2E' }} />
          <div style={{ width: 10, height: 10, borderRadius: 5, background: '#28C840' }} />
        </div>
        <div style={{
          flex: 1, padding: '4px 10px', background: '#fff', border: `1px solid ${lineSoft}`,
          borderRadius: 6, fontSize: 11, color: fade, fontFamily: 'var(--font-mono)',
        }}>{url}</div>
      </div>
      <div>{children}</div>
    </div>
  )
}

// ── Mockup 1 — AiroPhone Settings → Integrations page ───────────────────────

function IntegrationsPageMockup() {
  const integrations = [
    {
      name: 'monday.com',
      desc: 'Text leads automatically when items land on a board. Status column updates on reply.',
      status: 'connected',
      logo: (
        <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
          <div style={{ width: 8, height: 8, borderRadius: 8, background: '#FF3D57' }} />
          <div style={{ width: 8, height: 8, borderRadius: 8, background: '#FFCB00' }} />
          <div style={{ width: 8, height: 8, borderRadius: 8, background: '#00CA72' }} />
        </div>
      ),
    },
    { name: 'Google Calendar', desc: 'Send SMS reminders before meetings.', status: 'soon', logo: '📅' },
    { name: 'HubSpot',         desc: 'Sync contacts and trigger SMS on deal stage.', status: 'soon', logo: '🟠' },
  ]
  return (
    <BrowserFrame url="https://app.airophone.com/settings/integrations">
      <div style={{ display: 'flex', minHeight: 360 }}>
        {/* Sidebar */}
        <div style={{ width: 200, padding: 18, borderRight: `1px solid ${lineSoft}`, background: '#FBFAF7' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
            <div style={{
              width: 26, height: 26, borderRadius: 7, background: accent, color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 700, fontSize: 13,
            }}>A</div>
            <span style={{ fontSize: 14, fontWeight: 700, color: ink }}>AiroPhone</span>
          </div>
          {['Inbox', 'Automations', 'Phone numbers', 'Settings'].map((it, i) => (
            <div key={it} style={{
              padding: '7px 10px', borderRadius: 6, marginBottom: 2,
              fontSize: 12.5, color: i === 3 ? ink : muted,
              background: i === 3 ? lineSoft : 'transparent',
              fontWeight: i === 3 ? 600 : 500,
            }}>{it}</div>
          ))}
        </div>
        {/* Main */}
        <div style={{ flex: 1, padding: 24 }}>
          <p style={{ margin: 0, fontSize: 11, color: fade, fontFamily: 'var(--font-mono)', letterSpacing: '0.08em' }}>SETTINGS / INTEGRATIONS</p>
          <h3 style={{ margin: '4px 0 16px 0', fontSize: 18, fontWeight: 700, color: ink, letterSpacing: '-0.02em' }}>
            Connect external tools
          </h3>
          {integrations.map((it, i) => (
            <div key={it.name} style={{
              display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px',
              border: `1px solid ${i === 0 ? '#D8EBFA' : lineSoft}`,
              background: i === 0 ? '#F6FAFE' : '#fff',
              borderRadius: 10, marginBottom: 8,
            }}>
              <div style={{
                width: 38, height: 38, borderRadius: 8, background: i === 0 ? '#fff' : lineSoft,
                border: i === 0 ? `1px solid ${lineSoft}` : 'none',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 16,
              }}>{it.logo}</div>
              <div style={{ flex: 1 }}>
                <p style={{ margin: 0, fontSize: 13.5, fontWeight: 600, color: ink }}>{it.name}</p>
                <p style={{ margin: '2px 0 0 0', fontSize: 12, color: muted, lineHeight: 1.5 }}>{it.desc}</p>
              </div>
              {it.status === 'connected' ? (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '5px 10px', borderRadius: 999,
                  background: 'rgba(0,180,90,0.08)', color: '#118A53',
                  fontSize: 11.5, fontWeight: 600,
                }}>
                  <div style={{ width: 6, height: 6, borderRadius: 6, background: '#118A53' }} />
                  Connected
                </div>
              ) : (
                <div style={{
                  padding: '5px 10px', borderRadius: 999, background: lineSoft, color: fade,
                  fontSize: 11.5, fontWeight: 600,
                }}>
                  Coming soon
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </BrowserFrame>
  )
}

// ── Mockup 2 — Connect monday OAuth modal ───────────────────────────────────

function ConnectMondayPopupMockup() {
  const scopes = [
    { k: 'boards:read',       why: 'List your boards and read columns' },
    { k: 'boards:write',      why: 'Update status columns when leads reply' },
    { k: 'me:read',           why: 'Identify the connecting user' },
    { k: 'account:read',      why: 'Label this connection in AiroPhone' },
    { k: 'workspaces:read',   why: 'Pick which workspace to connect' },
    { k: 'webhooks:write',    why: 'Register board automations' },
  ]
  return (
    <div style={{
      background: 'linear-gradient(180deg, #F6FAFE 0%, #EEF5FC 100%)',
      padding: '36px 24px', borderRadius: 12, margin: '20px 0',
    }}>
      <div style={{
        maxWidth: 440, margin: '0 auto', background: '#fff', borderRadius: 12,
        border: `1px solid ${line}`, overflow: 'hidden',
        boxShadow: '0 20px 50px -20px rgba(19,18,16,0.25)',
      }}>
        <div style={{ padding: '22px 24px 18px 24px', borderBottom: `1px solid ${lineSoft}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
              <div style={{ width: 9, height: 9, borderRadius: 9, background: '#FF3D57' }} />
              <div style={{ width: 9, height: 9, borderRadius: 9, background: '#FFCB00' }} />
              <div style={{ width: 9, height: 9, borderRadius: 9, background: '#00CA72' }} />
            </div>
            <span style={{ fontSize: 12, color: fade, fontFamily: 'var(--font-mono)' }}>auth.monday.com</span>
          </div>
          <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: ink, letterSpacing: '-0.01em' }}>
            AiroPhone is requesting access
          </p>
          <p style={{ margin: '4px 0 0 0', fontSize: 12.5, color: muted, lineHeight: 1.5 }}>
            Allow AiroPhone to access your monday.com account
          </p>
        </div>
        <div style={{ padding: '16px 24px 0 24px' }}>
          <p style={{
            margin: 0, fontSize: 11, fontWeight: 600, color: fade,
            letterSpacing: '0.08em', textTransform: 'uppercase', fontFamily: 'var(--font-mono)',
          }}>Permissions</p>
          {scopes.map(s => (
            <div key={s.k} style={{
              display: 'flex', gap: 10, padding: '8px 0',
              borderBottom: `1px solid ${lineSoft}`,
            }}>
              <div style={{
                flexShrink: 0, width: 16, height: 16, borderRadius: 4,
                background: 'rgba(0,180,90,0.12)', color: '#118A53',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, fontWeight: 700,
              }}>✓</div>
              <div>
                <p style={{ margin: 0, fontSize: 12.5, fontWeight: 600, color: ink, fontFamily: 'var(--font-mono)' }}>{s.k}</p>
                <p style={{ margin: '1px 0 0 0', fontSize: 12, color: muted }}>{s.why}</p>
              </div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 10, padding: '20px 24px', justifyContent: 'flex-end' }}>
          <button style={{
            padding: '9px 16px', borderRadius: 8, border: `1px solid ${line}`,
            background: '#fff', color: muted, fontSize: 13, fontWeight: 500,
            cursor: 'default',
          }}>Cancel</button>
          <button style={{
            padding: '9px 18px', borderRadius: 8, border: 'none',
            background: mondayBlue, color: '#fff', fontSize: 13, fontWeight: 600,
            cursor: 'default',
          }}>Authorize</button>
        </div>
      </div>
    </div>
  )
}

// ── Mockup 3 — Two-way sync component ────────────────────────────────────────

function TwoWaySyncMockup() {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 18, alignItems: 'stretch',
      margin: '20px 0',
    }}>
      {/* Left card — AiroPhone event */}
      <Card style={{ padding: 18 }}>
        <p style={{
          margin: 0, fontSize: 10.5, fontWeight: 700, color: accent,
          letterSpacing: '0.1em', fontFamily: 'var(--font-mono)',
        }}>AIROPHONE EVENT</p>
        <p style={{ margin: '6px 0 14px 0', fontSize: 15, fontWeight: 600, color: ink }}>
          Lead replies to SMS
        </p>
        <div style={{
          background: '#F7F6F3', borderRadius: 8, padding: '10px 12px',
          border: `1px solid ${lineSoft}`,
        }}>
          <p style={{ margin: 0, fontSize: 11, color: fade, fontFamily: 'var(--font-mono)' }}>
            From: +1 (415) 555-0102
          </p>
          <p style={{ margin: '4px 0 0 0', fontSize: 12.5, color: ink, fontStyle: 'italic' }}>
            "Yes — Tuesday at 3 PM works."
          </p>
        </div>
      </Card>
      {/* Arrow */}
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', minWidth: 50,
      }}>
        <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
          <line x1="0" y1="20" x2="34" y2="20" stroke={accent} strokeWidth="2" strokeLinecap="round" />
          <polyline points="28,12 36,20 28,28" stroke={accent} strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <p style={{
          margin: '6px 0 0 0', fontSize: 10, color: fade,
          fontFamily: 'var(--font-mono)', letterSpacing: '0.08em',
        }}>SYNC</p>
      </div>
      {/* Right card — Monday writeback */}
      <Card style={{ padding: 18 }}>
        <p style={{
          margin: 0, fontSize: 10.5, fontWeight: 700, color: mondayBlue,
          letterSpacing: '0.1em', fontFamily: 'var(--font-mono)',
        }}>MONDAY UPDATE</p>
        <p style={{ margin: '6px 0 14px 0', fontSize: 15, fontWeight: 600, color: ink }}>
          Status column → Engaged
        </p>
        <div style={{
          background: '#F7F6F3', borderRadius: 8, padding: '10px 12px',
          border: `1px solid ${lineSoft}`, display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: '#FDBC64', color: '#3A2900', padding: '3px 10px',
            borderRadius: 999, fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
            letterSpacing: '0.04em', textDecoration: 'line-through', opacity: 0.7,
          }}>New</div>
          <span style={{ color: fade, fontSize: 13 }}>→</span>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: '#9CD326', color: '#1F3300', padding: '3px 10px',
            borderRadius: 999, fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
            letterSpacing: '0.04em',
          }}>Engaged</div>
        </div>
      </Card>
    </div>
  )
}

// ── Recipe-builder mockup ────────────────────────────────────────────────────

function RecipeBuilderMockup() {
  return (
    <BrowserFrame url="southern-investment-llc.monday.com/boards/9530708393">
      <div style={{ padding: 28, background: '#FBFAF7', minHeight: 320 }}>
        <p style={{ margin: 0, fontSize: 11, color: fade, fontFamily: 'var(--font-mono)', letterSpacing: '0.08em' }}>
          MONDAY · AUTOMATIONS · CREATE
        </p>
        <h3 style={{ margin: '4px 0 18px 0', fontSize: 17, fontWeight: 700, color: ink }}>
          Build your recipe
        </h3>
        <div style={{
          background: '#fff', border: `1px solid ${line}`, borderRadius: 12, padding: 20,
        }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap', fontSize: 14, lineHeight: 2, color: ink }}>
            <span>When</span>
            <Pill color={mondayBlue}>an item is created</Pill>
            <span>, send an AiroPhone SMS to</span>
            <Pill color={accent}>{'{Phone}'}</Pill>
            <span>from</span>
            <Pill color={accent}>{'{Sender number}'}</Pill>
            <span>saying</span>
            <Pill color={accent}>{'{Message Template}'}</Pill>
          </div>
          <div style={{ marginTop: 18, display: 'flex', gap: 10 }}>
            <button style={{
              padding: '8px 18px', borderRadius: 8, border: 'none',
              background: mondayBlue, color: '#fff', fontWeight: 600, fontSize: 13,
              cursor: 'default',
            }}>Create automation</button>
            <button style={{
              padding: '8px 16px', borderRadius: 8, border: `1px solid ${line}`,
              background: '#fff', color: muted, fontWeight: 500, fontSize: 13,
              cursor: 'default',
            }}>Cancel</button>
          </div>
        </div>
      </div>
    </BrowserFrame>
  )
}

function Pill({ children, color }) {
  return (
    <span style={{
      display: 'inline-block', padding: '2px 10px', borderRadius: 6,
      background: `${color}14`, color, fontWeight: 600, fontSize: 13,
      fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap',
    }}>{children}</span>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function MondaySetupPage() {
  return (
    <div style={{ minHeight: '100vh', background: bg, fontFamily: 'var(--font-sans)' }}>
      <div style={{ maxWidth: 820, margin: '0 auto', padding: '56px 28px 96px 28px' }}>

        {/* Brand */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 40 }}>
          <div style={{
            width: 44, height: 44, borderRadius: 12,
            background: accent, color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 700, fontSize: 22, letterSpacing: '-0.04em',
          }}>A</div>
          <div>
            <p style={{ margin: 0, fontSize: 18, fontWeight: 700, color: ink, letterSpacing: '-0.02em' }}>AiroPhone</p>
            <p style={{ margin: 0, fontSize: 12, color: fade, fontFamily: 'var(--font-mono)' }}>
              MONDAY INTEGRATION · SETUP GUIDE
            </p>
          </div>
        </div>

        {/* Hero */}
        <h1 style={{
          fontSize: 36, fontWeight: 700, color: ink,
          letterSpacing: '-0.035em', lineHeight: 1.15, marginBottom: 14,
        }}>
          AiroPhone × monday.com — full setup in five steps.
        </h1>
        <p style={{ fontSize: 16, color: muted, lineHeight: 1.65, marginBottom: 8 }}>
          AiroPhone texts new monday leads automatically and updates their status when they reply.
          This guide walks through everything from install to your first send. Most teams are live
          in under 10 minutes.
        </p>

        {/* TOC */}
        <div style={{
          marginTop: 28, padding: '16px 18px',
          background: '#fff', border: `1px solid ${line}`, borderRadius: 10,
        }}>
          <p style={{
            margin: 0, fontSize: 11, fontWeight: 600, color: fade,
            letterSpacing: '0.1em', textTransform: 'uppercase', fontFamily: 'var(--font-mono)',
          }}>On this page</p>
          <ol style={{ margin: '10px 0 0 0', paddingLeft: 18, color: muted, fontSize: 14, lineHeight: 1.9 }}>
            <li><a href="#prereqs" style={{ color: ink, textDecoration: 'none' }}>Prerequisites</a></li>
            <li><a href="#install" style={{ color: ink, textDecoration: 'none' }}>Install AiroPhone on monday</a></li>
            <li><a href="#connect" style={{ color: ink, textDecoration: 'none' }}>Connect monday to AiroPhone</a></li>
            <li><a href="#recipe" style={{ color: ink, textDecoration: 'none' }}>Add the recipe to your board</a></li>
            <li><a href="#placeholders" style={{ color: ink, textDecoration: 'none' }}>Message placeholders</a></li>
            <li><a href="#twoway" style={{ color: ink, textDecoration: 'none' }}>Two-way status sync</a></li>
            <li><a href="#latency" style={{ color: ink, textDecoration: 'none' }}>Form-fill timing &amp; retries</a></li>
            <li><a href="#troubleshoot" style={{ color: ink, textDecoration: 'none' }}>Troubleshooting</a></li>
          </ol>
        </div>

        {/* Quick steps overview */}
        <div style={{ marginTop: 36, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {STEPS.map((s) => (
            <div key={s.n} style={{
              padding: '14px 16px', background: '#fff',
              border: `1px solid ${line}`, borderRadius: 10,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                <div style={{
                  width: 22, height: 22, borderRadius: 11,
                  background: `${accent}14`, color: accent,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, fontWeight: 700,
                }}>{s.n}</div>
                <p style={{ margin: 0, fontSize: 13.5, fontWeight: 600, color: ink }}>{s.h}</p>
              </div>
              <p style={{ margin: 0, fontSize: 12.5, color: muted, lineHeight: 1.55 }}>{s.body}</p>
            </div>
          ))}
        </div>

        {/* ── Prerequisites ─────────────────────────────── */}
        <Section id="prereqs" eyebrow="01 · Prerequisites" title="What you'll need before you start">
          <ul style={{ paddingLeft: 18, margin: 0 }}>
            <li><strong style={{ color: ink }}>A monday.com account</strong> with admin permissions on the workspace you'll install the app on. (Non-admins can use the integration once installed; only admins can install it.)</li>
            <li><strong style={{ color: ink }}>An AiroPhone account</strong> with at least one phone number. US numbers must have an approved <code style={{ background: lineSoft, padding: '1px 6px', borderRadius: 4, fontSize: 13 }}>A2P 10DLC</code> campaign before they can send.</li>
            <li><strong style={{ color: ink }}>A monday board</strong> with a <em>Phone</em>-type column on it. Text columns work too, but Phone is recommended for proper country-code parsing.</li>
          </ul>
        </Section>

        {/* ── Install on monday ────────────────────────── */}
        <Section id="install" eyebrow="02 · Install" title="Install AiroPhone on your monday workspace">
          <p style={{ marginTop: 0 }}>
            In monday.com, click the apps grid in the top-right corner → <strong style={{ color: ink }}>App Marketplace</strong> →
            search for <em>"AiroPhone"</em> → click <strong style={{ color: ink }}>Install</strong>. Monday will ask you to
            authorize the permissions listed below. Click <em>Authorize</em> to complete the install.
          </p>
          <ConnectMondayPopupMockup />
          <p style={{ marginTop: 16 }}>
            Every scope above maps to a single, scoped feature inside AiroPhone — we don't request anything we don't actively use.
          </p>
        </Section>

        {/* ── Connect from AiroPhone ───────────────────── */}
        <Section id="connect" eyebrow="03 · Connect" title="Link AiroPhone to your monday account">
          <p style={{ marginTop: 0 }}>
            Installing the app on monday is half the picture — AiroPhone also needs to know which of your AiroPhone
            workspaces should send the texts. Open <strong style={{ color: ink }}>app.airophone.com → Settings → Integrations</strong>
            and click <strong style={{ color: ink }}>Connect Monday</strong>. You'll be bounced through a one-screen OAuth flow
            and dropped back in AiroPhone with the connection live.
          </p>
          <IntegrationsPageMockup />
          <p>
            Once connected, the AiroPhone phone numbers you own become selectable in the monday recipe builder. If you
            ever need to disconnect, the same screen has a <em>Disconnect</em> button — your stored monday OAuth token
            is deleted immediately.
          </p>
        </Section>

        {/* ── Recipe ───────────────────────────────────── */}
        <Section id="recipe" eyebrow="04 · Recipe" title="Add the SMS recipe to a board">
          <p style={{ marginTop: 0 }}>
            Open the monday board where new leads land. Click <strong style={{ color: ink }}>Integrate</strong> (top-right) →
            search <em>AiroPhone</em> → pick the recipe:
          </p>
          <RecipeBuilderMockup />
          <p>
            Fill in three things:
          </p>
          <ul style={{ paddingLeft: 18 }}>
            <li><strong style={{ color: ink }}>Phone</strong> — which column on the board holds the lead's mobile number.</li>
            <li><strong style={{ color: ink }}>Sender number</strong> — which AiroPhone number to send <em>from</em>. The dropdown lists every active number in the AiroPhone workspace you connected.</li>
            <li><strong style={{ color: ink }}>Message template</strong> — what to send. See <a href="#placeholders" style={{ color: accent }}>Message placeholders</a> below for how to personalize per lead.</li>
          </ul>
        </Section>

        {/* ── Placeholders ─────────────────────────────── */}
        <Section id="placeholders" eyebrow="05 · Templating" title="Personalize the message with placeholders">
          <p style={{ marginTop: 0 }}>
            Wrap any column reference in curly braces and AiroPhone substitutes the value per lead before sending.
            All these forms work:
          </p>
          <div style={{ marginTop: 12, background: '#fff', border: `1px solid ${line}`, borderRadius: 10, overflow: 'hidden' }}>
            {PLACEHOLDERS.map((p, i) => (
              <div key={p.key} style={{
                display: 'grid', gridTemplateColumns: '220px 1fr', gap: 14,
                padding: '12px 16px',
                borderBottom: i === PLACEHOLDERS.length - 1 ? 'none' : `1px solid ${lineSoft}`,
              }}>
                <code style={{ fontSize: 13, color: accent, fontFamily: 'var(--font-mono)' }}>{p.key}</code>
                <span style={{ fontSize: 13.5, color: muted }}>{p.desc}</span>
              </div>
            ))}
          </div>
          <p style={{ marginTop: 18 }}>
            A typical opening message:
          </p>
          <div style={{
            background: '#fff', border: `1px solid ${line}`, borderRadius: 10,
            padding: '14px 16px', marginTop: 10, fontFamily: 'var(--font-mono)',
            fontSize: 13.5, color: ink, lineHeight: 1.6,
          }}>
            Hi {'{pulse.name}'}, this is Sam from Acme. I saw you requested info on the {'{pulse.Product}'} package — got a couple minutes Tuesday to chat?
          </div>
        </Section>

        {/* ── Two-way sync ─────────────────────────────── */}
        <Section id="twoway" eyebrow="06 · Two-way sync" title="Status updates when leads reply">
          <p style={{ marginTop: 0 }}>
            AiroPhone doesn't just push messages out — it pushes state <em>back</em> into monday. The moment a lead
            replies on SMS, AiroPhone updates the configured status column on the matching monday item. Your team
            sees pipeline movement in monday without ever opening AiroPhone.
          </p>
          <TwoWaySyncMockup />
          <p>
            Configure the writeback under <strong style={{ color: ink }}>AiroPhone → Automations → Two-way sync</strong>.
            Pick which monday board it applies to, which column to update, and the target value. Common patterns:
          </p>
          <ul style={{ paddingLeft: 18 }}>
            <li>On <em>reply received</em> → status column → <code style={{ background: lineSoft, padding: '1px 6px', borderRadius: 4, fontSize: 13 }}>Engaged</code></li>
            <li>On <em>opt-out keyword (STOP)</em> → status column → <code style={{ background: lineSoft, padding: '1px 6px', borderRadius: 4, fontSize: 13 }}>Do Not Contact</code></li>
            <li>On <em>conversation closed</em> → status column → <code style={{ background: lineSoft, padding: '1px 6px', borderRadius: 4, fontSize: 13 }}>Cold</code></li>
          </ul>
        </Section>

        {/* ── Latency ──────────────────────────────────── */}
        <Section id="latency" eyebrow="07 · Timing" title="What happens when the phone column fills in late">
          <p style={{ marginTop: 0 }}>
            Form-fill workflows often create the monday item first and populate columns a moment later (10–30s).
            AiroPhone handles this automatically: if the phone column is empty when the trigger fires, the run is
            marked <em>pending</em> and a 1-minute sweeper retries until the phone fills or two hours elapse.
          </p>
          <div style={{
            margin: '14px 0', padding: '14px 16px',
            background: '#fff', border: `1px solid ${line}`, borderRadius: 10,
            fontFamily: 'var(--font-mono)', fontSize: 12.5, color: muted, lineHeight: 1.8,
          }}>
            T+0s   item created on monday (phone column still empty)<br/>
            T+0s   AiroPhone receives trigger → marks run pending<br/>
            T+20s  your form populates the phone column<br/>
            T+60s  sweeper picks up the pending row → SMS sends<br/>
            <span style={{ color: '#118A53' }}>T+62s  lead's phone rings</span>
          </div>
          <p>
            You don't configure this — it's on by default for every recipe. Average end-to-end latency: 30–60 seconds
            after the phone column fills.
          </p>
        </Section>

        {/* ── Troubleshooting ──────────────────────────── */}
        <Section id="troubleshoot" eyebrow="08 · Troubleshooting" title="Common issues and fixes">
          <Trouble q="The sender-number dropdown is empty in the recipe builder">
            You haven't connected monday from AiroPhone yet (Step 3). Open <em>app.airophone.com → Settings →
            Integrations → Connect Monday</em>. After connecting, refresh the recipe builder.
          </Trouble>
          <Trouble q="The SMS never arrives">
            Three usual causes, in order: (1) the lead phone column is empty — check the item; (2) the AiroPhone
            number has no A2P 10DLC campaign approved yet — check <em>Settings → Compliance</em>; (3) the AiroPhone
            account is out of SMS credit — check <em>Billing</em>.
          </Trouble>
          <Trouble q="The SMS arrives but {pulse.name} shows up literally instead of the lead's name">
            You're inside double-quotes or your placeholder is misspelled. Use <code style={{ background: lineSoft, padding: '1px 6px', borderRadius: 4, fontSize: 13 }}>{'{pulse.name}'}</code> (lowercase, with the dot) — not
            <code style={{ background: lineSoft, padding: '1px 6px', borderRadius: 4, fontSize: 13 }}>{'{user.name}'}</code>.
          </Trouble>
          <Trouble q="Status column doesn't update when leads reply">
            The two-way sync writeback is configured separately from the inbound recipe. Go to
            <em> AiroPhone → Automations → Two-way sync</em> and add a writeback rule for the relevant board.
          </Trouble>
        </Section>

        {/* Footer */}
        <div style={{
          marginTop: 64, padding: '20px 24px',
          background: '#fff', border: `1px solid ${line}`, borderRadius: 12,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap',
        }}>
          <div>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: ink }}>Stuck?</p>
            <p style={{ margin: '2px 0 0 0', fontSize: 13, color: muted }}>
              Email <a href="mailto:support@airophone.com" style={{ color: accent, textDecoration: 'none' }}>support@airophone.com</a> — we reply within one business day.
            </p>
          </div>
          <a href="https://app.airophone.com" style={{
            padding: '10px 20px', borderRadius: 8,
            background: accent, color: '#fff', fontSize: 13.5, fontWeight: 600,
            textDecoration: 'none',
          }}>
            Open AiroPhone →
          </a>
        </div>

      </div>
    </div>
  )
}

function Trouble({ q, children }) {
  return (
    <div style={{
      marginBottom: 12, padding: '14px 16px',
      background: '#fff', border: `1px solid ${line}`, borderRadius: 10,
    }}>
      <p style={{ margin: 0, fontSize: 13.5, fontWeight: 600, color: ink }}>{q}</p>
      <p style={{ margin: '6px 0 0 0', fontSize: 13.5, color: muted, lineHeight: 1.6 }}>{children}</p>
    </div>
  )
}
