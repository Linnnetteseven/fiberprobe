import { FiberClient } from '../src/client/index.js'
import { PaymentChecker } from '../src/payment/checker.js'

const alice = new FiberClient('http://127.0.0.1:8227')
const checker = new PaymentChecker(alice)

const targetPubkey = process.argv[2]
if (!targetPubkey) {
  console.error('Usage: npx tsx test/probe-test.ts <target_pubkey> [amount_hex]')
  process.exit(1)
}
const amount = process.argv[3] ?? '0x3B9ACA00'

async function main() {
  console.log(`Probing ${targetPubkey.slice(0, 20)}… for ${amount}...\n`)
  const result = await checker.probePay({ targetPubkey, amount })
  console.log('isViable:', result.isViable)
  console.log('latencyMs:', result.latencyMs)
  console.log('terminalError:', result.terminalError)
  if (result.error) console.log('error:', result.error.code, '-', result.error.message)
}

main().catch(console.error)
