/**
 * fiberprobe SDK Demo
 * Live against real FNN nodes: Alice (/rpc-alice -> 8227), Bob (/rpc-bob -> 8237), Carol (/rpc-carol -> 8247)
 */

import { useState, useEffect, useCallback } from 'react'
import { FiberClient, PaymentChecker } from 'fnn-ts'
import type { NodeInfo, PaymentCheckResult, ReceiveCheckResult, ProbeResult } from 'fnn-ts'

const alice = new FiberClient('/rpc-alice')
const bob   = new FiberClient('/rpc-bob')
const carol = new FiberClient('/rpc-carol')
const aliceChecker = new PaymentChecker(alice)
const bobChecker   = new PaymentChecker(bob)

// ── Design tokens ──────────────────────────────────────────────────────────
const C = {
  bg:        '#080b10',
  surface:   '#0f1420',
  surface2:  '#141b2a',
  border:    '#212b3d',
  borderHi:  '#2e3b52',
  signal:    '#ff9d5c',
  signalDim: '#7a4a26',
  data:      '#5ec8d8',
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

function ckbToHex(ckbStr: string): string {
  const ckb = parseFloat(ckbStr)
  const shannon = BigInt(Math.round((isNaN(ckb) ? 0 : ckb) * 100_000_000))
  return '0x' + shannon.toString(16)
}

function explainProbeResult(result: ProbeResult): string {
  if (result.isViable) {
    return 'The destination received the probe and rejected it only because the payment hash was intentionally fake — proof every hop had enough live liquidity to carry this exact amount, right now.'
  }
  if (result.error?.code === 'INSUFFICIENT_CAPACITY') {
    return 'A hop along this exact route ran out of outbound liquidity at the moment of probing. This is real-time channel state a static graph estimate cannot see — the gossip-announced capacity said this route should work, but the live balance split says otherwise, right now.'
  }
  return 'The probe could not confirm a viable route. See the terminal state below for the exact reason.'
}

function probeBadgeLabel(result: ProbeResult): string {
  if (result.isViable) return 'VIABLE — LIVE'
  if (result.error?.code === 'INSUFFICIENT_CAPACITY') return 'BLOCKED — LIQUIDITY FAILURE'
  return 'BLOCKED — ROUTE FAILURE'
}

// ── Signal meter ─────────────────────────────────────────────────────────────
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
            <div key={i} style={{
              width: 7, height: h, borderRadius: 1,
              background: active ? colour : C.border,
              boxShadow: active ? `0 0 8px ${colour}66` : 'none',
              transition: 'background 0.4s ease, box-shadow 0.4s ease',
            }} />
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

// ── Hop trace ─────────────────────────────────────────────────────────────────
function HopTrace({ hopCount, resolved }: { hopCount: number; resolved: boolean }) {
  const nodeCount = Math.max(hopCount, 0) + 1
  const nodes = Array.from({ length: nodeCount })

  return (
    <div style={{ display: 'flex', alignItems: 'center', padding: '4px 0' }}>
      <div style={{ width: 8, height: 8, borderRadius: '50%', background: C.data, flexShrink: 0, boxShadow: `0 0 6px ${C.data}` }} />
      {nodes.map((_, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
          <div style={{
            height: 2, flex: 1,
            background: resolved ? C.signal : C.border,
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

// ── UI primitives ─────────────────────────────────────────────────────────────
function Panel({ eyebrow, title, children }: { eyebrow: string; title: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10,
      padding: 26, display: 'flex', flexDirection: 'column', gap: 18,
    }}>
      <div>
        <div style={{ fontFamily: C.mono, fontSize: 11, letterSpacing: '0.12em', color: C.data, textTransform: 'uppercase', marginBottom: 4 }}>
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
        background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6,
        color: C.text, fontFamily: mono ? C.mono : C.sans, fontSize: 13,
        padding: '11px 13px', width: '100%', boxSizing: 'border-box', outline: 'none',
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
        fontFamily: C.sans, fontSize: 13, fontWeight: 600,
        padding: '10px 18px', width: '100%',
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
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
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

type Recipient = 'bob' | 'carol'

interface RecipientState {
  invoice: string
  payResult: PaymentCheckResult | null
  probeResult: ProbeResult | null
  probeStep: number
}

const emptyRecipientState = (): RecipientState => ({
  invoice: '', payResult: null, probeResult: null, probeStep: 0,
})

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  const [aliceInfo, setAliceInfo] = useState<NodeInfo | null>(null)
  const [bobInfo, setBobInfo]     = useState<NodeInfo | null>(null)
  const [carolInfo, setCarolInfo] = useState<NodeInfo | null>(null)

  const [recipient, setRecipient] = useState<Recipient>('bob')
  const [states, setStates] = useState<Record<Recipient, RecipientState>>({
    bob: emptyRecipientState(),
    carol: emptyRecipientState(),
  })

  const [invoiceAmount, setInvoiceAmount] = useState('10')
  const [payChecking, setPayChecking]     = useState(false)
  const [probing, setProbing]             = useState(false)
  const [generating, setGenerating]       = useState(false)

  const [rxAmount, setRxAmount]     = useState('5')
  const [rxChecking, setRxChecking] = useState(false)
  const [rxResult, setRxResult]     = useState<ReceiveCheckResult | null>(null)

  const [log, setLog] = useState<LogEntry[]>([])

  const current = states[recipient]
  const patch = useCallback((who: Recipient, p: Partial<RecipientState>) => {
    setStates((prev) => ({ ...prev, [who]: { ...prev[who], ...p } }))
  }, [])

  const pushLog = useCallback((label: string, detail: string, colour: string) => {
    const time = new Date().toLocaleTimeString('en-GB', { hour12: false })
    setLog((prev) => [{ time, label, detail, colour }, ...prev].slice(0, 40))
  }, [])

  useEffect(() => {
    alice.nodeInfo().then(setAliceInfo).catch(() => {})
    bob.nodeInfo().then(setBobInfo).catch(() => {})
    carol.nodeInfo().then(setCarolInfo).catch(() => {})
  }, [])

  const handleGenerateInvoice = async () => {
    const who = recipient
    setGenerating(true)
    try {
      const target = who === 'bob' ? bob : carol
      const label = who === 'bob' ? 'Bob (direct channel)' : 'Carol (via Bob, 2 hops)'
      const result = await target.newInvoice({
        amount: ckbToHex(invoiceAmount),
        currency: 'Fibt',
        description: `fnn-ts demo payment to ${who}`,
      })
      patch(who, { invoice: result.invoice_address, payResult: null, probeResult: null, probeStep: 0 })
      pushLog('new_invoice', `${label} generated a ${invoiceAmount} CKB invoice`, C.data)
    } catch (e) {
      pushLog('new_invoice', e instanceof Error ? e.message : String(e), C.bad)
    } finally {
      setGenerating(false)
    }
  }

  const handleCanPay = async () => {
    const who = recipient
    const invoice = states[who].invoice
    if (!invoice.trim()) return
    setPayChecking(true)
    patch(who, { payResult: null, probeResult: null, probeStep: 0 })
    try {
      const result = await aliceChecker.canPay({ invoice: invoice.trim() })
      patch(who, { payResult: result })
      pushLog(
        'canPay()',
        result.canPay ? `${result.confidence}% confidence · ${result.hopCount} hop(s)` : 'no route found',
        result.canPay ? C.good : C.bad
      )
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      patch(who, { payResult: { canPay: false, confidence: 0, issues: [msg] } })
      pushLog('canPay()', msg, C.bad)
    } finally {
      setPayChecking(false)
    }
  }

  const handleProbe = async () => {
    const who = recipient
    const payResult = states[who].payResult
    if (!payResult?.destinationPubkey || !payResult?.amount) return
    setProbing(true)
    patch(who, { probeResult: null, probeStep: 1 })

    try {
      const resultPromise = aliceChecker.probePay({
        targetPubkey: payResult.destinationPubkey,
        amount: payResult.amount,
      })
      await new Promise((r) => setTimeout(r, 200))
      patch(who, { probeStep: 2 })
      await new Promise((r) => setTimeout(r, 250))
      patch(who, { probeStep: 3 })

      const result = await resultPromise
      patch(who, { probeStep: 4, probeResult: result })
      pushLog(
        'probePay()',
        result.isViable ? `viable · ${result.latencyMs}ms` : `blocked · ${result.latencyMs}ms`,
        result.isViable ? C.good : C.bad
      )
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      patch(who, { probeStep: 4, probeResult: { isViable: false, terminalError: msg, latencyMs: 0 } })
      pushLog('probePay()', msg, C.bad)
    } finally {
      setProbing(false)
    }
  }

  const handleCanReceive = async () => {
    const ckb = parseFloat(rxAmount)
    if (isNaN(ckb) || ckb <= 0) return
    setRxChecking(true)
    setRxResult(null)
    try {
      const result = await bobChecker.canReceive({ amount: ckbToHex(rxAmount) })
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
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&family=Inter:wght@400;500;600;700&display=swap" />
      <style>{`
        html { scroll-behavior: smooth; }
        * { box-sizing: border-box; }

        @keyframes fnnFadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .fnn-swap { animation: fnnFadeIn 0.28s ease; }

        .fnn-header {
          display: flex; align-items: center; justify-content: space-between;
          flex-wrap: wrap; gap: 14px;
        }
        .fnn-pills { display: flex; gap: 18px; flex-wrap: wrap; }
        .fnn-grid {
          display: grid; grid-template-columns: 1fr 1fr; gap: 22px;
        }
        .fnn-stats-strip { display: flex; gap: 36px; flex-wrap: wrap; }

        @media (max-width: 860px) {
          .fnn-grid { grid-template-columns: 1fr !important; }
          .fnn-header { flex-direction: column; align-items: flex-start; }
          .fnn-logo { font-size: 22px !important; }
          .fnn-tagline { font-size: 12px !important; }
        }
        @media (max-width: 480px) {
          .fnn-page-pad { padding-left: 16px !important; padding-right: 16px !important; }
          .fnn-panel { padding: 18px !important; }
        }
      `}</style>

      <div style={{ minHeight: '100vh', background: C.bg, color: C.text, fontFamily: C.sans, overflowX: 'hidden' }}>

        {/* Header */}
        <div className="fnn-header fnn-page-pad" style={{ borderBottom: `1px solid ${C.border}`, padding: '20px 32px' }}>
          <div>
            <div className="fnn-logo" style={{
              fontFamily: C.mono, fontSize: 30, fontWeight: 700, color: C.signal,
              textShadow: `0 0 20px ${C.signal}66`, letterSpacing: '-0.01em', lineHeight: 1,
            }}>
              Fiber Probe
            </div>
            <div className="fnn-tagline" style={{ color: C.muted, fontSize: 13, marginTop: 6 }}>
              TypeScript SDK for Fiber Network Node · static estimate + live HTLC probing
            </div>
          </div>
          <div className="fnn-pills">
            <NodePill label="alice" pubkey={aliceInfo?.pubkey} online={!!aliceInfo} />
            <NodePill label="bob" pubkey={bobInfo?.pubkey} online={!!bobInfo} />
            <NodePill label="carol" pubkey={carolInfo?.pubkey} online={!!carolInfo} />
          </div>
        </div>

        {/* Node stats strip */}
        {aliceInfo && bobInfo && carolInfo && (
          <div className="fnn-stats-strip fnn-page-pad" style={{
            background: C.surface2, borderBottom: `1px solid ${C.border}`, padding: '10px 32px',
          }}>
            <StatRow label="alice channels" value={String(parseInt(String(aliceInfo.channel_count), 16))} />
            <StatRow label="bob channels" value={String(parseInt(String(bobInfo.channel_count), 16))} />
            <StatRow label="carol channels" value={String(parseInt(String(carolInfo.channel_count), 16))} />
            <StatRow label="fnn version" value={aliceInfo.version} colour={C.data} />
          </div>
        )}

        {/* Main grid */}
        <div className="fnn-grid fnn-page-pad" style={{ padding: '28px 32px 0', maxWidth: 1200, margin: '0 auto' }}>

          {/* canPay + probePay panel */}
          <div className="fnn-panel">
            <Panel eyebrow="Pre-flight check" title="canPay() + probePay() — route feasibility">
              <p style={{ fontFamily: C.sans, fontSize: 12.5, color: C.muted, lineHeight: 1.6, margin: 0 }}>
                Resolves the invoice destination, checks for a direct channel, searches the
                public graph for a route, then optionally probes it live for ground truth.
              </p>

              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={() => setRecipient('bob')}
                  style={{
                    flex: 1, padding: '9px 10px', borderRadius: 6, cursor: 'pointer',
                    fontFamily: C.mono, fontSize: 11.5, fontWeight: 600,
                    background: recipient === 'bob' ? C.signal : 'transparent',
                    color: recipient === 'bob' ? '#1a0e05' : C.muted,
                    border: `1px solid ${recipient === 'bob' ? C.signal : C.border}`,
                    transition: 'background 0.2s ease, color 0.2s ease, border-color 0.2s ease',
                  }}
                >
                  → Bob (direct)
                </button>
                <button
                  onClick={() => setRecipient('carol')}
                  style={{
                    flex: 1, padding: '9px 10px', borderRadius: 6, cursor: 'pointer',
                    fontFamily: C.mono, fontSize: 11.5, fontWeight: 600,
                    background: recipient === 'carol' ? C.signal : 'transparent',
                    color: recipient === 'carol' ? '#1a0e05' : C.muted,
                    border: `1px solid ${recipient === 'carol' ? C.signal : C.border}`,
                    transition: 'background 0.2s ease, color 0.2s ease, border-color 0.2s ease',
                  }}
                >
                  → Carol (2 hops)
                </button>
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ width: 90, flexShrink: 0 }}>
                  <Field value={invoiceAmount} onChange={setInvoiceAmount} placeholder="CKB" />
                </div>
                <div style={{ width: 110, flexShrink: 0 }}>
                  <Button onClick={handleGenerateInvoice} disabled={generating} variant="ghost">
                    {generating ? '…' : 'Generate'}
                  </Button>
                </div>
              </div>

              <Field value={current.invoice} onChange={(v) => patch(recipient, { invoice: v })} placeholder="fibt1… invoice address" />

              <Button onClick={handleCanPay} disabled={payChecking || !current.invoice.trim()}>
                {payChecking ? 'Checking route…' : 'Run canPay()'}
              </Button>

              {/* Results — keyed by recipient so switching tabs replays a smooth fade-in */}
              <div key={recipient} className="fnn-swap">
                {current.payResult && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingTop: 4 }}>
                    <SignalMeter value={current.payResult.confidence} />
                    <HopTrace hopCount={current.payResult.hopCount ?? 0} resolved={current.payResult.canPay} />
                    {current.payResult.canPay && (
                      <>
                        <StatRow label="destination" value={(current.payResult.destinationPubkey ?? '').slice(0, 24) + '…'} colour={C.data} />
                        <StatRow label="amount" value={current.payResult.amount ? `${fmtCkb(BigInt(current.payResult.amount))} CKB` : '—'} />
                        <StatRow label="hops" value={String(current.payResult.hopCount ?? 0)} />
                      </>
                    )}
                    {current.payResult.error && (
                      <StatRow label="error" value={current.payResult.error.code} colour={C.bad} />
                    )}
                    <IssueList issues={current.payResult.issues} />

                    {current.payResult.destinationPubkey && current.payResult.amount && (
                      <div style={{
                        borderTop: `1px solid ${C.border}`, paddingTop: 16, marginTop: 4,
                        display: 'flex', flexDirection: 'column', gap: 12,
                      }}>
                        <div style={{ fontFamily: C.mono, fontSize: 10.5, color: C.data, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                          Ground truth · live HTLC probe
                        </div>
                        <Button onClick={handleProbe} disabled={probing} variant="ghost">
                          {probing ? 'Probing live route…' : 'Run probePay()'}
                        </Button>

                        {(probing || current.probeResult) && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {[
                              'Generating one-time fake payment hash',
                              'Sending real HTLC through the live route',
                              'Awaiting destination response',
                            ].map((label, i) => {
                              const stepNum = i + 1
                              const active = current.probeStep >= stepNum
                              return (
                                <div key={i} style={{
                                  display: 'flex', alignItems: 'center', gap: 8,
                                  fontFamily: C.mono, fontSize: 11.5,
                                  color: active ? C.data : C.muted,
                                  opacity: active ? 1 : 0.4,
                                  transition: 'opacity 0.25s ease, color 0.25s ease',
                                }}>
                                  <span style={{
                                    width: 6, height: 6, borderRadius: '50%',
                                    background: active ? C.data : C.border,
                                    boxShadow: active ? `0 0 6px ${C.data}` : 'none',
                                    flexShrink: 0,
                                  }} />
                                  {label}
                                </div>
                              )
                            })}
                          </div>
                        )}

                        {current.probeResult && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                            <div style={{
                              display: 'inline-flex', alignItems: 'center', gap: 8,
                              padding: '8px 14px', borderRadius: 6, width: 'fit-content',
                              background: current.probeResult.isViable ? '#0d2a1a' : '#2a0d0f',
                              border: `1px solid ${current.probeResult.isViable ? C.good : C.bad}`,
                            }}>
                              <span style={{
                                width: 8, height: 8, borderRadius: '50%',
                                background: current.probeResult.isViable ? C.good : C.bad,
                                boxShadow: `0 0 8px ${current.probeResult.isViable ? C.good : C.bad}`,
                              }} />
                              <span style={{
                                fontFamily: C.mono, fontSize: 16, fontWeight: 700,
                                color: current.probeResult.isViable ? C.good : C.bad,
                                letterSpacing: '0.02em',
                              }}>
                                {probeBadgeLabel(current.probeResult)}
                              </span>
                            </div>
                            <p style={{ fontFamily: C.sans, fontSize: 12, color: C.muted, lineHeight: 1.6, margin: 0 }}>
                              {explainProbeResult(current.probeResult)}
                            </p>
                            <StatRow label="resolved in" value={`${current.probeResult.latencyMs}ms`} colour={C.data} />
                            {current.probeResult.terminalError && (
                              <StatRow label="terminal state" value={current.probeResult.terminalError} />
                            )}
                            {current.probeResult.error && (
                              <StatRow label="error code" value={current.probeResult.error.code} colour={C.bad} />
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </Panel>
          </div>

          {/* canReceive panel */}
          <div className="fnn-panel">
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
                          flexWrap: 'wrap', gap: 4,
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
        </div>

        {/* Event log */}
        <div className="fnn-page-pad" style={{ padding: '22px 32px 40px', maxWidth: 1200, margin: '0 auto' }}>
          <Panel eyebrow="Activity" title="Event log">
            <div style={{
              fontFamily: C.mono, fontSize: 12, display: 'flex',
              flexDirection: 'column', gap: 7, maxHeight: 220, overflowY: 'auto',
            }}>
              {log.length === 0 ? (
                <div style={{ color: C.muted }}>No activity yet. Run a check above.</div>
              ) : log.map((entry, i) => (
                <div key={i} style={{ display: 'flex', gap: 16, alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <span style={{ color: C.muted, flexShrink: 0, width: 68 }}>{entry.time}</span>
                  <span style={{ color: C.data, flexShrink: 0, width: 110 }}>{entry.label}</span>
                  <span style={{ color: entry.colour }}>{entry.detail}</span>
                </div>
              ))}
            </div>
          </Panel>
        </div>

        {/* Footer */}
        <div className="fnn-page-pad" style={{
          borderTop: `1px solid ${C.border}`,
          padding: '18px 32px', maxWidth: 1200, margin: '0 auto',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          fontFamily: C.mono, fontSize: 11, color: C.muted, flexWrap: 'wrap', gap: 8,
        }}>
          <span>Category 2 · Node, Routing &amp; Diagnostics · Gone in 60ms Hackathon</span>
          <a href="https://github.com/Linnnetteseven/fiberprobe" target="_blank" rel="noreferrer"
             style={{ color: C.signal, textDecoration: 'none' }}>
            github.com/Linnnetteseven/fiberprobe ↗
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
