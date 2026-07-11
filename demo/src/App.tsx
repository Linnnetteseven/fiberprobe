/**
 * fnn-ts SDK Demo
 *
 * Demonstrates FiberClient, PaymentChecker, and FiberEventEmitter
 * against a real FNN node running on http://127.0.0.1:8227.
 *
 * The Vite dev server proxies /rpc → 127.0.0.1:8227 to avoid CORS.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import {
  FiberClient,
  PaymentChecker,
  FiberEventEmitter,
} from 'fnn-ts'
import type {
  NodeInfo,
  PaymentCheckResult,
  ReceiveCheckResult,
  ChannelCapacityEntry,
} from 'fnn-ts'

// ── SDK instances (proxied through Vite /rpc to avoid CORS) ──────────────────
const client  = new FiberClient('/rpc')
const checker = new PaymentChecker(client)
const emitter = new FiberEventEmitter(client)

// ── Design tokens ─────────────────────────────────────────────────────────────
const C = {
  bg:       '#0a0e14',
  surface:  '#12181f',
  border:   '#1e2a38',
  accent:   '#00d4aa',
  text:     '#e8f0f7',
  muted:    '#4a6880',
  success:  '#00c48c',
  warning:  '#f5a623',
  danger:   '#ff4757',
  mono:     "'JetBrains Mono', 'Fira Code', monospace",
  sans:     "'Inter', system-ui, sans-serif",
}

// ── Confidence meter ──────────────────────────────────────────────────────────

function ConfidenceMeter({ value }: { value: number }) {
  const bars    = 5
  const filled  = Math.ceil((value / 100) * bars)
  const colour  = value >= 80 ? C.success : value >= 50 ? C.warning : C.danger

  return (
    <div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
        {Array.from({ length: bars }).map((_, i) => (
          <div
            key={i}
            style={{
              flex: 1,
              height: 20 + i * 4,
              borderRadius: 2,
              backgroundColor: i < filled ? colour : C.border,
              transition: 'background-color 0.3s ease',
              alignSelf: 'flex-end',
            }}
          />
        ))}
      </div>
      <div style={{ fontFamily: C.mono, fontSize: 28, fontWeight: 700, color: colour }}>
        {value}<span style={{ fontSize: 16, color: C.muted }}>%</span>
      </div>
      <div style={{ fontFamily: C.sans, fontSize: 12, color: C.muted, marginTop: 2 }}>
        {value >= 80 ? 'High confidence' : value >= 50 ? 'Moderate confidence' : value > 0 ? 'Low confidence' : 'No route'}
      </div>
    </div>
  )
}

// ── Card wrapper ──────────────────────────────────────────────────────────────

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{
      background:    C.surface,
      border:        `1px solid ${C.border}`,
      borderRadius:  8,
      padding:       24,
      display:       'flex',
      flexDirection: 'column',
      gap:           16,
    }}>
      <div style={{
        fontFamily:    C.sans,
        fontSize:      11,
        fontWeight:    600,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        color:         C.muted,
        borderBottom:  `1px solid ${C.border}`,
        paddingBottom: 12,
      }}>
        {title}
      </div>
      {children}
    </div>
  )
}

// ── Input + button ────────────────────────────────────────────────────────────

function Input({ value, onChange, placeholder }: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        background:   C.bg,
        border:       `1px solid ${C.border}`,
        borderRadius: 4,
        color:        C.text,
        fontFamily:   C.mono,
        fontSize:     12,
        padding:      '8px 12px',
        width:        '100%',
        boxSizing:    'border-box',
        outline:      'none',
      }}
    />
  )
}

function Button({ onClick, disabled, children }: {
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        background:    disabled ? C.border : C.accent,
        border:        'none',
        borderRadius:  4,
        color:         disabled ? C.muted : C.bg,
        cursor:        disabled ? 'not-allowed' : 'pointer',
        fontFamily:    C.sans,
        fontSize:      13,
        fontWeight:    600,
        padding:       '9px 16px',
        width:         '100%',
        transition:    'opacity 0.15s',
      }}
    >
      {children}
    </button>
  )
}

// ── Mono data row ─────────────────────────────────────────────────────────────

function DataRow({ label, value, colour }: { label: string; value: string; colour?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
      <span style={{ fontFamily: C.sans, fontSize: 12, color: C.muted, flexShrink: 0 }}>{label}</span>
      <span style={{ fontFamily: C.mono, fontSize: 12, color: colour ?? C.text, textAlign: 'right', wordBreak: 'break-all' }}>
        {value}
      </span>
    </div>
  )
}

// ── Issue list ────────────────────────────────────────────────────────────────

function IssueList({ issues }: { issues: string[] }) {
  if (issues.length === 0) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {issues.map((issue, i) => (
        <div key={i} style={{
          fontFamily:  C.mono,
          fontSize:    11,
          color:       C.warning,
          background:  '#1a1500',
          border:      `1px solid #3a2e00`,
          borderRadius: 3,
          padding:     '4px 8px',
        }}>
          ⚠ {issue}
        </div>
      ))}
    </div>
  )
}

// ── Event log entry ───────────────────────────────────────────────────────────

interface LogEntry {
  time:    string
  type:    string
  hash:    string
  status:  string
  colour:  string
}

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  // Node info
  const [nodeInfo,     setNodeInfo]     = useState<NodeInfo | null>(null)
  const [nodeError,    setNodeError]    = useState<string | null>(null)

  // canPay
  const [invoice,      setInvoice]      = useState('')
  const [payChecking,  setPayChecking]  = useState(false)
  const [payResult,    setPayResult]    = useState<PaymentCheckResult | null>(null)

  // canReceive
  const [amount,       setAmount]       = useState('')
  const [rxChecking,   setRxChecking]   = useState(false)
  const [rxResult,     setRxResult]     = useState<ReceiveCheckResult | null>(null)

  // event log
  const [log,          setLog]          = useState<LogEntry[]>([])
  const logRef                          = useRef<HTMLDivElement>(null)

  const pushLog = useCallback((entry: Omit<LogEntry, 'time'>) => {
    const time = new Date().toLocaleTimeString('en-GB', { hour12: false })
    setLog((prev) => [{ time, ...entry }, ...prev].slice(0, 50))
  }, [])

  // Load node info on mount
  useEffect(() => {
    client.nodeInfo()
      .then(setNodeInfo)
      .catch((e: unknown) => setNodeError(e instanceof Error ? e.message : String(e)))
  }, [])

  // canPay handler
  const handleCanPay = async () => {
    if (!invoice.trim()) return
    setPayChecking(true)
    setPayResult(null)
    try {
      const result = await checker.canPay({ invoice: invoice.trim() })
      setPayResult(result)
      pushLog({
        type:   'canPay()',
        hash:   invoice.slice(0, 20) + '…',
        status: result.canPay ? `${result.confidence}% confidence` : 'cannot pay',
        colour: result.canPay ? C.success : C.danger,
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setPayResult({ canPay: false, confidence: 0, issues: [msg] })
    } finally {
      setPayChecking(false)
    }
  }

  // canReceive handler
  const handleCanReceive = async () => {
    const ckb    = parseFloat(amount)
    if (isNaN(ckb) || ckb <= 0) return
    // Convert CKB to shannon (1 CKB = 100_000_000 shannon), return as hex
    const shannon  = BigInt(Math.round(ckb * 100_000_000))
    const hexAmt   = '0x' + shannon.toString(16)
    setRxChecking(true)
    setRxResult(null)
    try {
      const result = await checker.canReceive({ amount: hexAmt })
      setRxResult(result)
      pushLog({
        type:   'canReceive()',
        hash:   `${ckb} CKB`,
        status: result.canReceive ? 'sufficient capacity' : 'insufficient capacity',
        colour: result.canReceive ? C.success : C.danger,
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setRxResult({
        canReceive: false, totalInboundCapacity: 0n,
        activeChannelCount: 0, channelBreakdown: [], issues: [msg],
      })
    } finally {
      setRxChecking(false)
    }
  }

  const isOnline = nodeInfo !== null

  return (
    <>
      {/* Google Fonts */}
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600&family=Inter:wght@400;600&display=swap" />

      <div style={{
        minHeight:       '100vh',
        background:      C.bg,
        color:           C.text,
        fontFamily:      C.sans,
        padding:         '0 0 40px',
      }}>

        {/* Header */}
        <div style={{
          borderBottom: `1px solid ${C.border}`,
          padding:      '16px 32px',
          display:      'flex',
          alignItems:   'center',
          justifyContent: 'space-between',
        }}>
          <div>
            <span style={{ fontFamily: C.mono, fontSize: 18, fontWeight: 600, color: C.accent }}>
              fnn-ts
            </span>
            <span style={{ color: C.muted, marginLeft: 8, fontSize: 13 }}>
              SDK Demo · Fiber Network Node
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              width: 8, height: 8, borderRadius: '50%',
              background: isOnline ? C.success : C.danger,
              boxShadow:  isOnline ? `0 0 6px ${C.success}` : 'none',
            }} />
            <span style={{ fontFamily: C.mono, fontSize: 12, color: isOnline ? C.success : C.danger }}>
              {isOnline ? 'Node online' : nodeError ? 'Node unreachable' : 'Connecting…'}
            </span>
          </div>
        </div>

        {/* Node pubkey strip */}
        {nodeInfo && (
          <div style={{
            background:  C.surface,
            borderBottom: `1px solid ${C.border}`,
            padding:     '8px 32px',
            display:     'flex',
            gap:         32,
          }}>
            <DataRow label="pubkey"   value={nodeInfo.pubkey} />
            <DataRow label="version"  value={nodeInfo.version} />
            <DataRow label="peers"    value={String(parseInt(String(nodeInfo.peers_count), 16))} />
            <DataRow label="channels" value={String(parseInt(String(nodeInfo.channel_count), 16))} />
          </div>
        )}

        {/* Main panels */}
        <div style={{
          display:             'grid',
          gridTemplateColumns: '1fr 1fr',
          gap:                 20,
          padding:             '24px 32px 0',
        }}>

          {/* canPay panel */}
          <Card title="Pre-flight Payment Check — canPay()">
            <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.6 }}>
              Validates routing via <span style={{ color: C.accent, fontFamily: C.mono }}>dry_run</span> without
              broadcasting. Scores per-hop liquidity from the network graph.
            </div>
            <Input
              value={invoice}
              onChange={setInvoice}
              placeholder="fibt1… (Fiber testnet invoice)"
            />
            <Button onClick={handleCanPay} disabled={payChecking || !invoice.trim()}>
              {payChecking ? 'Checking route…' : 'Run canPay()'}
            </Button>

            {payResult && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <ConfidenceMeter value={payResult.confidence} />
                {payResult.canPay && payResult.estimatedFee && (
                  <DataRow label="Estimated fee" value={payResult.estimatedFee + ' shannon'} />
                )}
                {payResult.canPay && payResult.hopCount !== undefined && (
                  <DataRow label="Route hops" value={String(payResult.hopCount)} />
                )}
                {payResult.error && (
                  <div>
                    <DataRow label="Error" value={payResult.error.code} colour={C.danger} />
                    <div style={{
                      fontFamily: C.sans, fontSize: 11, color: C.warning,
                      marginTop: 6, lineHeight: 1.5,
                    }}>
                      {payResult.error.suggestion}
                    </div>
                  </div>
                )}
                <IssueList issues={payResult.issues} />
              </div>
            )}
          </Card>

          {/* canReceive panel */}
          <Card title="Inbound Capacity Check — canReceive()">
            <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.6 }}>
              Sums usable inbound across all <span style={{ color: C.accent, fontFamily: C.mono }}>ChannelReady</span> channels,
              subtracting in-flight HTLCs from remote balance.
            </div>
            <Input
              value={amount}
              onChange={setAmount}
              placeholder="Amount in CKB (e.g. 100)"
            />
            <Button onClick={handleCanReceive} disabled={rxChecking || !amount.trim()}>
              {rxChecking ? 'Checking capacity…' : 'Run canReceive()'}
            </Button>

            {rxResult && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{
                  fontFamily: C.mono,
                  fontSize:   28,
                  fontWeight: 700,
                  color:      rxResult.canReceive ? C.success : C.danger,
                }}>
                  {rxResult.canReceive ? 'CAN RECEIVE' : 'INSUFFICIENT'}
                </div>
                <DataRow
                  label="Total inbound"
                  value={(Number(rxResult.totalInboundCapacity) / 1e8).toFixed(4) + ' CKB'}
                />
                <DataRow
                  label="Active channels"
                  value={String(rxResult.activeChannelCount)}
                />
                {rxResult.channelBreakdown.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <div style={{ fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                      Channel breakdown
                    </div>
                    {rxResult.channelBreakdown.map((ch: ChannelCapacityEntry) => (
                      <div key={ch.channelId} style={{
                        display:      'flex',
                        justifyContent: 'space-between',
                        fontFamily:   C.mono,
                        fontSize:     11,
                        color:        ch.isEnabled ? C.text : C.muted,
                        padding:      '3px 0',
                        borderBottom: `1px solid ${C.border}`,
                      }}>
                        <span>{ch.channelId.slice(0, 16)}…</span>
                        <span>{(Number(ch.usableInbound) / 1e8).toFixed(4)} CKB</span>
                      </div>
                    ))}
                  </div>
                )}
                <IssueList issues={rxResult.issues} />
              </div>
            )}
          </Card>
        </div>

        {/* Event log */}
        <div style={{ padding: '20px 32px 0' }}>
          <Card title="Event Log — FiberEventEmitter">
            <div style={{ fontSize: 12, color: C.muted }}>
              Adaptive-polling watcher events appear here in real time.
              Start a payment or invoice watch to see events fire.
            </div>
            <div
              ref={logRef}
              style={{
                fontFamily:  C.mono,
                fontSize:    12,
                display:     'flex',
                flexDirection: 'column',
                gap:         4,
                maxHeight:   200,
                overflowY:   'auto',
              }}
            >
              {log.length === 0 ? (
                <div style={{ color: C.muted }}>No events yet — run a check above to see entries here.</div>
              ) : log.map((entry, i) => (
                <div key={i} style={{ display: 'flex', gap: 16, alignItems: 'baseline' }}>
                  <span style={{ color: C.muted, flexShrink: 0 }}>{entry.time}</span>
                  <span style={{ color: C.accent, flexShrink: 0 }}>{entry.type}</span>
                  <span style={{ color: C.muted, flexShrink: 0, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.hash}</span>
                  <span style={{ color: entry.colour }}>{entry.status}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* Footer */}
        <div style={{
          padding:    '20px 32px 0',
          fontSize:   11,
          color:      C.muted,
          fontFamily: C.mono,
          display:    'flex',
          gap:        24,
        }}>
          <span>fnn-ts · Category 2: Node, Routing & Diagnostics</span>
          <span>Gone in 60ms Hackathon · Fiber Network · July 2026</span>
          
          <a 
            href="https://github.com/Linnnetteseven/fnn-ts"
            style={{ color: C.accent, textDecoration: 'none' }}
            target="_blank"
            rel="noreferrer"
          >
            github.com/Linnnetteseven/fnn-ts ↗
          </a>
        </div>
      </div>
    </>
  )
}
