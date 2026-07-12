/**
 * Live integration test for PaymentChecker against real running FNN nodes.
 *
 * Prerequisites:
 *   - Alice node running on http://127.0.0.1:8227
 *   - Bob node running on http://127.0.0.1:8237
 *   - A ChannelReady channel open between them
 *
 * Run with: npx tsx test/live-test.ts
 */

import { FiberClient } from '../src/client/index.js'
import { PaymentChecker } from '../src/payment/checker.js'

const alice = new FiberClient('http://127.0.0.1:8227')
const bob   = new FiberClient('http://127.0.0.1:8237')
const checker = new PaymentChecker(alice)

async function main() {
  console.log('═══════════════════════════════════════')
  console.log('  fnn-ts Live Integration Test')
  console.log('═══════════════════════════════════════\n')

  // ── Test 1: node connectivity ────────────────────────────────────────────
  console.log('[1] Checking node connectivity...')
  const aliceInfo = await alice.nodeInfo()
  const bobInfo   = await bob.nodeInfo()
  console.log(`    Alice: ${aliceInfo.pubkey.slice(0, 20)}… (${aliceInfo.channel_count} channels)`)
  console.log(`    Bob:   ${bobInfo.pubkey.slice(0, 20)}… (${bobInfo.channel_count} channels)\n`)

  // ── Test 2: canReceive on Bob's side ──────────────────────────────────────
  console.log('[2] Testing canReceive() — can Bob receive 5 CKB?')
  const bobChecker = new PaymentChecker(bob)
  const receiveResult = await bobChecker.canReceive({ amount: '0x12A05F200' }) // 5 CKB
  console.log(`    canReceive: ${receiveResult.canReceive}`)
  console.log(`    Total inbound: ${receiveResult.totalInboundCapacity} shannon`)
  console.log(`    Active channels: ${receiveResult.activeChannelCount}`)
  if (receiveResult.issues.length) {
    console.log(`    Issues: ${receiveResult.issues.join('; ')}`)
  }
  console.log()

  // ── Test 3: canPay via direct channel ────────────────────────────────────
  console.log('[3] Creating a fresh invoice from Bob for canPay() test...')
  const invoice = await bob.newInvoice({
    amount: '0x3B9ACA00', // 10 CKB
    currency: 'Fibt',
    description: 'live-test canPay check',
  })
  console.log(`    Invoice created, payment_hash: ${invoice.invoice.data.payment_hash ?? 'n/a'}`)

  console.log('\n[4] Running canPay() from Alice for that invoice...')
  const payResult = await checker.canPay({ invoice: invoice.invoice_address })
  console.log(`    canPay: ${payResult.canPay}`)
  console.log(`    Confidence: ${payResult.confidence}%`)
  console.log(`    Destination: ${payResult.destinationPubkey?.slice(0, 20)}…`)
  console.log(`    Amount: ${payResult.amount}`)
  console.log(`    Hop count: ${payResult.hopCount}`)
  if (payResult.issues.length) {
    console.log(`    Issues: ${payResult.issues.join('; ')}`)
  }
  if (payResult.error) {
    console.log(`    Error: ${payResult.error.code} — ${payResult.error.message}`)
    console.log(`    Suggestion: ${payResult.error.suggestion}`)
  }

  console.log('\n═══════════════════════════════════════')
  console.log('  Test complete')
  console.log('═══════════════════════════════════════')
}

main().catch((err) => {
  console.error('Test failed:', err)
  process.exit(1)
})

// ── Test 5: Multi-hop canPay (Alice -> Bob -> Carol) ─────────────────────────
async function testMultiHop() {
  console.log('\n[5] Multi-hop test: Alice has no direct channel to Carol')
  const carolInvoice = process.argv[2]
  if (!carolInvoice) {
    console.log('    Skipped — pass Carol\'s invoice_address as an argument')
    return
  }
  const result = await checker.canPay({ invoice: carolInvoice })
  console.log(`    canPay: ${result.canPay}`)
  console.log(`    Confidence: ${result.confidence}%`)
  console.log(`    Destination: ${result.destinationPubkey?.slice(0, 20)}…`)
  console.log(`    Hop count: ${result.hopCount}`)
  if (result.issues.length) console.log(`    Issues: ${result.issues.join('; ')}`)
  if (result.error) console.log(`    Error: ${result.error.code} — ${result.error.message}`)
}

testMultiHop().catch(console.error)
