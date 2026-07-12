/**
 * fnn-ts SDK Demo
 * Live against real FNN nodes: Alice (/rpc-alice -> 8227), Bob (/rpc-bob -> 8237)
 */

import { useState, useEffect, useCallback } from 'react'
import { FiberClient, PaymentChecker } from 'fnn-ts'
import type { NodeInfo, PaymentCheckResult, ReceiveCheckResult } from 'fnn-ts'

const alice = new FiberClient('/rpc-alice')
const bob   = new FiberClient('/rpc-bob')
const aliceChecker = new PaymentChecker(alice)
const bobChecker   = new PaymentChecker(bob)

// ── Design tokens ──────────────────────────────────────────────────────────
const C = {
  bg:        '#080b10',
  surface:   '#0f1420',
  surface2:  '#141b2a',
  border:    '#212b3d',
  borderHi:  '#2e3b52',
  signal:    '#ff9d5c',   // fiber-optic amber light
  signalDim: '#7a4a26',
  data:      '#5ec8d8',   // cool data/structure cyan
  text:      '#e8edf5',
  muted:     '#5b6b85',
  good:      '#4ade80',
  warn:      '#ff9d5c',
  bad:       '#f2555a',
  mono:      "'IBM Plex Mono', ui-monospace, monospace",
  sans:      "'Inter', system-ui, sans-serif",
}

function fmtCkb(shannon: bigint | string): string {
  const n = typeof shannon === 'bigint' ? shannon : BigInt(shannon)
  return (Number(n) / 1e8).toLocaleString(undefined, { maximumFractionDigits: 4 })
}

// ── Signal meter (signature element) ────────────────────────────────────────
function SignalMeter({ value }: { value: number }) {
  const bars = 6
  const filled = Math.round((value / 100) * bars)
  const colour = value >= 80 ? C.good : value >= 50 ? C.warn : value > 0 ? C.bad : C.muted

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 36 }}>
        {Array.from({ length: bars }).map((_, i) => {
          const active = i < filled
          const h = 10 + i * 4.5
          return (
            <div
              key={i}
              style={{
                width: 7,
                height: h,
                borderRadius: 1,
                background: active ? colour : C.border,
                boxShadow: active ? `0 0 8px ${colour}66` : 'none',
                transition: 'background 0.4s ease, box-shadow 0.4s ease',
              }}
            />
          )
        })}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontFamily: C.mono, fontSize: 32, fontWeight: 600, color: colour, lineHeight: 1 }}>
          {value}
        </span>
        <span style={{ fontFamily: C.mono, fontSize: 13, color: C.muted }}>% confidence</span>
      </div>
    </div>
  )
}

// ── Hop trace — animated light pulse across route nodes ─────────────────────
function HopTrace({ hopCount, resolved }: { hopCount: number; resolved: boolean }) {
  const nodeCount = Math.max(hopCount, 0) + 1 // +1 for destination
  const nodes = Array.from({ length: nodeCount })

  return (
    <div style={{ display: 'flex', alignItems: 'center', padding: '4px 0' }}>
      <div style={{
        width: 8, height: 8, borderRadius: '50%',
        background: C.data, flexShrink: 0,
        boxShadow: `0 0 6px ${C.data}`,
      }} />
      {nodes.map((_, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
          <div style={{
            height: 2,
            flex: 1,
            background: resolved ? `linear-gradient(90deg, ${C.signal}, ${C.signal})` : C.border,
            boxShadow: resolved ? `0 0 6px ${C.signal}88` : 'none',
            transition: 'background 0.3s ease',
          }} />
          <div style={{
            width: i === nodes.length - 1 ? 10 : 7,
            height: i === nodes.length - 1 ? 10 : 7,
            borderRadius: '50%',
            background: resolved ? C.signal : C.border,
            boxShadow: resolved ? `0 0 8px ${C.signal}aa` : 'none',
            flexShrink: 0,
          }} />
        </div>
      ))}
    </div>
  )
}

// ── UI primitives ─────────────────────────────────────────────────────────

function Panel({ eyebrow, title, children }: { eyebrow: string; title: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: C.surface,
      border: `1px solid ${C.border}`,
      borderRadius: 10,
      padding: 26,
      display: 'flex',
      flexDirection: 'column',
      gap: 18,
    }}>
      <div>
        <div style={{
          fontFamily: C.mono, fontSize: 11, letterSpacing: '0.12em',
          color: C.data, textTransform: 'uppercase', marginBottom: 4,
        }}>
          {eyebrow}
        </div>
        <div style={{ fontFamily: C.sans, fontSize: 17, fontWeight: 600, color: C.text }}>
          {title}
        </div>
      </div>
      {children}
    </div>
  )
}

function Field({ value, onChange, placeholder, mono = true }: {
  value: string; onChange: (v: string) => void; placeholder?: string; mono?: boolean
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        background: C.bg,
        border: `1px solid ${C.border}`,
        borderRadius: 6,
        color: C.text,
        fontFamily: mono ? C.mono : C.sans,
        fontSize: 13,
        padding: '11px 13px',
        width: '100%',
        boxSizing: 'border-box',
        outline: 'none',
      }}
      onFocus={(e) => (e.target.style.borderColor = C.data)}
      onBlur={(e) => (e.target.style.borderColor = C.border)}
    />
  )
}

function Button({ onClick, disabled, children, variant = 'primary' }: {
  onClick: () => void; disabled?: boolean; children: React.ReactNode; variant?: 'primary' | 'ghost'
}) {
  const isPrimary = variant === 'primary'
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        background: disabled ? C.border : isPrimary ? C.signal : 'transparent',
        border: isPrimary ? 'none' : `1px solid ${C.borderHi}`,
        borderRadius: 6,
        color: disabled ? C.muted : isPrimary ? '#1a0e05' : C.text,
        cursor: disabled ? 'not-allowed' : 'pointer',
        fontFamily: C.sans,
        fontSize: 13,
        fontWeight: 600,
        padding: '10px 18px',
        width: '100%',
        transition: 'opacity 0.15s, transform 0.1s',
      }}
      onMouseDown={(e) => { if (!disabled) e.currentTarget.style.transform = 'scale(0.98)' }}
      onMouseUp={(e) => { e.currentTarget.style.transform = 'scale(1)' }}
    >
      {children}
    </button>
  )
}

function StatRow({ label, value, colour }: { label: string; value: string; colour?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
      <span style={{ fontFamily: C.sans, fontSize: 12, color: C.muted }}>{label}</span>
      <span style={{ fontFamily: C.mono, fontSize: 12.5, color: colour ?? C.text, textAlign: 'right', wordBreak: 'break-all' }}>
        {value}
      </span>
    </div>
  )
}

function IssueList({ issues }: { issues: string[] }) {
  if (!issues.length) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {issues.map((issue, i) => (
        <div key={i} style={{
          fontFamily: C.mono, fontSize: 11.5, color: C.warn,
          background: '#2a1a0c', border: `1px solid #4a2e14`,
          borderRadius: 5, padding: '6px 10px', lineHeight: 1.5,
        }}>
          {issue}
        </div>
      ))}
    </div>
  )
}

interface LogEntry { time: string; label: string; detail: string; colour: string }

// ── App ───────────────────────────────────────────────────────────────────

export default function App() {
  const [aliceInfo, setAliceInfo] = useState<NodeInfo | null>(null)
  const [bobInfo, setBobInfo]     = useState<NodeInfo | null>(null)

  const [invoice, setInvoice]         = useState('')
  const [payChecking, setPayChecking] = useState(false)
  const [payResult, setPayResult]     = useState<PaymentCheckResult | null>(null)

  const [rxAmount, setRxAmount]       = useState('5')
  const [rxChecking, setRxChecking]   = useState(false)
  const [rxResult, setRxResult]       = useState<ReceiveCheckResult | null>(null)

  const [generating, setGenerating]   = useState(false)
  const [log, setLog]                 = useState<LogEntry[]>([])

  const pushLog = useCallback((label: string, detail: string, colour: string) => {
    const time = new Date().toLocaleTimeString('en-GB', { hour12: false })
    setLog((prev) => [{ time, label, detail, colour }, ...prev].slice(0, 40))
  }, [])

  useEffect(() => {
    alice.nodeInfo().then(setAliceInfo).catch(() => {})
    bob.nodeInfo().then(setBobInfo).catch(() => {})
  }, [])

  const handleGenerateInvoice = async () => {
    setGenerating(true)
    try {
      const result = await bob.newInvoice({
        amount: '0x3B9ACA00', // 10 CKB
        currency: 'Fibt',
        description: 'fnn-ts demo payment',
      })
      setInvoice(result.invoice_address)
      pushLog('new_invoice', 'Bob generated a 10 CKB invoice', C.data)
    } catch (e) {
      pushLog('new_invoice', e instanceof Error ? e.message : String(e), C.bad)
    } finally {
      setGenerating(false)
    }
  }

  const handleCanPay = async () => {
    if (!invoice.trim()) return
    setPayChecking(true)
    setPayResult(null)
    try {
      const result = await aliceChecker.canPay({ invoice: invoice.trim() })
      setPayResult(result)
      pushLog(
        'canPay()',
        result.canPay ? `${result.confidence}% confidence · ${result.hopCount} hop(s)` : 'no route found',
        result.canPay ? C.good : C.bad
      )
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setPayResult({ canPay: false, confidence: 0, issues: [msg] })
      pushLog('canPay()', msg, C.bad)
    } finally {
      setPayChecking(false)
    }
  }

  const handleCanReceive = async () => {
    const ckb = parseFloat(rxAmount)
    if (isNaN(ckb) || ckb <= 0) return
    const shannon = BigInt(Math.round(ckb * 100_000_000))
    const hex = '0x' + shannon.toString(16)
    setRxChecking(true)
    setRxResult(null)
    try {
      const result = await bobChecker.canReceive({ amount: hex })
      setRxResult(result)
      pushLog(
        'canReceive()',
        result.canReceive ? `${ckb} CKB clears · ${fmtCkb(result.totalInboundCapacity)} CKB available` : 'insufficient inbound',
        result.canReceive ? C.good : C.bad
      )
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setRxResult({ canReceive: false, totalInboundCapacity: 0n, activeChannelCount: 0, channelBreakdown: [], issues: [msg] })
      pushLog('canReceive()', msg, C.bad)
    } finally {
      setRxChecking(false)
    }
  }

  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Inter:wght@400;500;600;700&display=swap" />

      <div style={{ minHeight: '100vh', background: C.bg, color: C.text, fontFamily: C.sans }}>

        {/* Header */}
        <div style={{
          borderBottom: `1px solid ${C.border}`,
          padding: '18px 32px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <span style={{
              fontFamily: C.mono, fontSize: 19, fontWeight: 600, color: C.signal,
              textShadow: `0 0 16px ${C.signal}55`,
            }}>
              fnn-ts
            </span>
            <span style={{ color: C.muted, fontSize: 13 }}>
              TypeScript SDK for Fiber Network Node
            </span>
          </div>
          <div style={{ display: 'flex', gap: 20 }}>
            <NodePill label="alice" pubkey={aliceInfo?.pubkey} online={!!aliceInfo} />
            <NodePill label="bob" pubkey={bobInfo?.pubkey} online={!!bobInfo} />
          </div>
        </div>

        {/* Node stats strip */}
        {aliceInfo && bobInfo && (
          <div style={{
            background: C.surface2, borderBottom: `1px solid ${C.border}`,
            padding: '10px 32px', display: 'flex', gap: 36,
          }}>
            <StatRow label="alice channels" value={String(parseInt(String(aliceInfo.channel_count), 16))} />
            <StatRow label="bob channels" value={String(parseInt(String(bobInfo.channel_count), 16))} />
            <StatRow label="alice peers" value={String(parseInt(String(aliceInfo.peers_count), 16))} />
            <StatRow label="fnn version" value={aliceInfo.version} colour={C.data} />
          </div>
        )}

        {/* Main grid */}
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 22,
          padding: '28px 32px 0', maxWidth: 1200, margin: '0 auto',
        }}>

          {/* canPay panel */}
          <Panel eyebrow="Pre-flight check" title="canPay() — route feasibility">
            <p style={{ fontFamily: C.sans, fontSize: 12.5, color: C.muted, lineHeight: 1.6, margin: 0 }}>
              Resolves the invoice destination, checks for a direct channel, then
              searches the public graph for a route and scores liquidity per hop.
            </p>

            <div style={{ display: 'flex', gap: 8 }}>
              <Field value={invoice} onChange={setInvoice} placeholder="fibt1… invoice address" />
              <div style={{ width: 140, flexShrink: 0 }}>
                <Button onClick={handleGenerateInvoice} disabled={generating} variant="ghost">
                  {generating ? '…' : 'Generate'}
                </Button>
              </div>
            </div>

            <Button onClick={handleCanPay} disabled={payChecking || !invoice.trim()}>
              {payChecking ? 'Checking route…' : 'Run canPay()'}
            </Button>

            {payResult && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingTop: 4 }}>
                <SignalMeter value={payResult.confidence} />
                <HopTrace hopCount={payResult.hopCount ?? 0} resolved={payResult.canPay} />
                {payResult.canPay && (
                  <>
                    <StatRow label="destination" value={(payResult.destinationPubkey ?? '').slice(0, 24) + '…'} colour={C.data} />
                    <StatRow label="amount" value={payResult.amount ? `${fmtCkb(BigInt(payResult.amount))} CKB` : '—'} />
                    <StatRow label="hops" value={String(payResult.hopCount ?? 0)} />
                  </>
                )}
                {payResult.error && (
                  <StatRow label="error" value={payResult.error.code} colour={C.bad} />
                )}
                <IssueList issues={payResult.issues} />
              </div>
            )}
          </Panel>

          {/* canReceive panel */}
          <Panel eyebrow="Capacity check" title="canReceive() — inbound liquidity">
            <p style={{ fontFamily: C.sans, fontSize: 12.5, color: C.muted, lineHeight: 1.6, margin: 0 }}>
              Sums usable inbound capacity across Bob's ChannelReady channels,
              subtracting any in-flight HTLCs from the remote balance.
            </p>

            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <Field value={rxAmount} onChange={setRxAmount} placeholder="Amount" />
              <span style={{ fontFamily: C.mono, fontSize: 13, color: C.muted, flexShrink: 0 }}>CKB</span>
            </div>

            <Button onClick={handleCanReceive} disabled={rxChecking || !rxAmount.trim()}>
              {rxChecking ? 'Checking capacity…' : 'Run canReceive()'}
            </Button>

            {rxResult && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingTop: 4 }}>
                <div style={{
                  fontFamily: C.mono, fontSize: 26, fontWeight: 600,
                  color: rxResult.canReceive ? C.good : C.bad,
                  textShadow: `0 0 14px ${rxResult.canReceive ? C.good : C.bad}44`,
                }}>
                  {rxResult.canReceive ? 'CLEARS' : 'INSUFFICIENT'}
                </div>
                <StatRow label="total inbound" value={`${fmtCkb(rxResult.totalInboundCapacity)} CKB`} colour={C.data} />
                <StatRow label="active channels" value={String(rxResult.activeChannelCount)} />
                {rxResult.channelBreakdown.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 4 }}>
                    <div style={{ fontFamily: C.mono, fontSize: 10.5, color: C.muted, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                      Channel breakdown
                    </div>
                    {rxResult.channelBreakdown.map((ch) => (
                      <div key={ch.channelId} style={{
                        display: 'flex', justifyContent: 'space-between',
                        fontFamily: C.mono, fontSize: 11.5,
                        color: ch.isEnabled ? C.text : C.muted,
                        padding: '5px 0', borderBottom: `1px solid ${C.border}`,
                      }}>
                        <span>{ch.channelId.slice(0, 18)}…</span>
                        <span>{fmtCkb(ch.usableInbound)} CKB</span>
                      </div>
                    ))}
                  </div>
                )}
                <IssueList issues={rxResult.issues} />
              </div>
            )}
          </Panel>
        </div>

        {/* Event log */}
        <div style={{ padding: '22px 32px 40px', maxWidth: 1200, margin: '0 auto' }}>
          <Panel eyebrow="Activity" title="Event log">
            <div style={{
              fontFamily: C.mono, fontSize: 12, display: 'flex',
              flexDirection: 'column', gap: 7, maxHeight: 220, overflowY: 'auto',
            }}>
              {log.length === 0 ? (
                <div style={{ color: C.muted }}>No activity yet. Run a check above.</div>
              ) : log.map((entry, i) => (
                <div key={i} style={{ display: 'flex', gap: 16, alignItems: 'baseline' }}>
                  <span style={{ color: C.muted, flexShrink: 0, width: 68 }}>{entry.time}</span>
                  <span style={{ color: C.data, flexShrink: 0, width: 110 }}>{entry.label}</span>
                  <span style={{ color: entry.colour }}>{entry.detail}</span>
                </div>
              ))}
            </div>
          </Panel>
        </div>

        {/* Footer */}
        <div style={{
          borderTop: `1px solid ${C.border}`,
          padding: '18px 32px', maxWidth: 1200, margin: '0 auto',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          fontFamily: C.mono, fontSize: 11, color: C.muted,
        }}>
          <span>Category 2 · Node, Routing &amp; Diagnostics · Gone in 60ms Hackathon</span>
          <a href="https://github.com/Linnnetteseven/fnn-ts" target="_blank" rel="noreferrer"
             style={{ color: C.signal, textDecoration: 'none' }}>
            github.com/Linnnetteseven/fnn-ts ↗
          </a>
        </div>
      </div>
    </>
  )
}

function NodePill({ label, pubkey, online }: { label: string; pubkey?: string; online: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{
        width: 7, height: 7, borderRadius: '50%',
        background: online ? '#4ade80' : '#f2555a',
        boxShadow: online ? '0 0 6px #4ade8099' : 'none',
      }} />
      <span style={{ fontFamily: C.mono, fontSize: 11.5, color: C.text, textTransform: 'uppercase' }}>
        {label}
      </span>
      <span style={{ fontFamily: C.mono, fontSize: 11, color: C.muted }}>
        {pubkey ? pubkey.slice(0, 10) + '…' : '—'}
      </span>
    </div>
  )
}

