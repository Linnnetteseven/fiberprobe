/**
 * Isomorphic Web Crypto helpers for payment probing.
 * Uses globalThis.crypto so this works unchanged in the browser (Vite/React
 * demo) and in Node 19+, with no extra dependency.
 */

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** Generates a random 32-byte value and its SHA-256 hash, both as 0x-prefixed hex. */
export async function generateFakePaymentHash(): Promise<{ preimage: string; paymentHash: string }> {
  const bytes = new Uint8Array(32)
  globalThis.crypto.getRandomValues(bytes)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return {
    preimage:    '0x' + toHex(bytes.buffer),
    paymentHash: '0x' + toHex(digest),
  }
}
