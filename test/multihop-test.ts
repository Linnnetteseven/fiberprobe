import { FiberClient } from '../src/client/index.js'
import { PaymentChecker } from '../src/payment/checker.js'

const alice = new FiberClient('http://127.0.0.1:8227')
const checker = new PaymentChecker(alice)

const carolInvoice = process.argv[2]
if (!carolInvoice) {
  console.error('Usage: npx tsx test/multihop-test.ts <carol_invoice_address>')
  process.exit(1)
}

async function main() {
  console.log('Testing multi-hop canPay(): Alice -> Bob -> Carol\n')
  const result = await checker.canPay({ invoice: carolInvoice })
  console.log('canPay:', result.canPay)
  console.log('Confidence:', result.confidence + '%')
  console.log('Destination:', result.destinationPubkey)
  console.log('Amount:', result.amount)
  console.log('Hop count:', result.hopCount)
  if (result.issues.length) console.log('Issues:', result.issues)
  if (result.error) console.log('Error:', result.error.code, '-', result.error.message)
}

main().catch(console.error)
