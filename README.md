# fiberprobe

<div align="center">

### Know whether a Fiber payment will succeed **before** you send it.

A TypeScript SDK for **payment confidence**, **live route validation**, and **liquidity diagnostics** on the Fiber Network.

Built for wallets, merchant checkouts, exchanges, payment processors, bots, and any application that needs reliable payment routing.

Built for the **"Gone in 60ms" Fiber Network Infrastructure Hackathon** — Category 2: Node, Routing & Diagnostics.

[Installation](#installation) •
[Quick Start](#quick-start) •
[Architecture](#architecture) •
[API](#api-reference) •
[Demo](#running-the-demo-yourself)

</div>

---

## Why fiberprobe?

Fiber, like Lightning, splits channel state into two categories. Total capacity is public, broadcast via gossip. The actual balance split between the two peers in a channel is private and changes with every payment — by design, since publishing live balances would leak the entire financial graph of the network.

That means no RPC can honestly answer:

> **"Will this payment actually succeed right now?"**

We tested whether Fiber's own `send_payment` **dry_run** flag could answer this, directly against live FNN v0.8.1 nodes. It doesn't: dry-run sessions return `Created` immediately with no route detail, and are never queryable afterward — not even the instant after creation (`get_payment` returns `Payment session not found`). Whatever a real router computes during a dry run is discarded, not surfaced.

Every wallet, checkout flow, and payment bot built on Fiber hits this same wall. `fiberprobe` is the SDK layer that solves it — with a free static estimate, and, when it matters, a live empirical probe that proves real liquidity on the exact route, right now.

```ts
const estimate = await checker.canPay({ invoice })

if (estimate.confidence > 0.9) {
    await checker.probePay(...)
}

const inbound = await checker.canReceive(...)
```

---

# Features

### ⚡ `canPay()`
Free, instant, approximate. Estimates payment success from Fiber's public routing graph — no network traffic, just a confidence score, hop count, and estimated route in milliseconds.

### 🔍 `probePay()`
The ground truth. Performs a real HTLC probe using an intentionally unclaimable payment hash. No funds move, no invoice required — but every forwarding node must lock and forward the HTLC before the destination rejects it.

### 📥 `canReceive()`
Real inbound capacity, correctly computed across every `ChannelReady` channel, properly excluding in-flight HTLCs so capacity isn't over-reported.

### 🌐 Typed Fiber RPC Client
A fully typed JSON-RPC client covering the FNN node API — typed against the live v0.8.1 RPC surface, not just the docs.

### 👀 Event Watchers
Adaptive-backoff watchers for payments, invoices, and channels — no hand-rolled polling loops.

### 🛡 Typed Errors
Raw RPC failures become typed exceptions (`RouteNotFoundError`, `InsufficientCapacityError`, `TemporaryChannelFailureError`, `PeerUnreachableError`, `PaymentTimeoutError`, `FeeInsufficientError`, `AmountBelowMinimumError`), each with a machine-readable `code` and a plain-English `suggestion`.

### ✅ Proven Against Real Infrastructure
Every feature was verified against **live FNN v0.8.1 nodes** on Fiber testnet — real channels, real invoices, real HTLC forwarding — and the process caught five real bugs along the way (see [Real-World Discoveries](#real-world-discoveries)).

---

# Installation

```bash
npm install fiberprobe
```

---

# Quick Start

```ts
import { FiberClient, PaymentChecker } from 'fiberprobe'

const client = new FiberClient('http://127.0.0.1:8227') // your FNN node's RPC address
const checker = new PaymentChecker(client)

// Fast, free, approximate
const estimate = await checker.canPay({ invoice: 'fibt1...' })
console.log(estimate.confidence, estimate.hopCount)

// Slower, costs a brief HTLC lock, gives you the real answer
const probe = await checker.probePay({
  targetPubkey: estimate.destinationPubkey!,
  amount: estimate.amount!,
})
console.log(probe.isViable, probe.latencyMs, probe.terminalError)

// Inbound capacity, correctly computed
const rx = await checker.canReceive({ amount: '0x3B9ACA00' }) // 10 CKB
console.log(rx.canReceive, rx.totalInboundCapacity)
```

Every method returns typed results. Errors carry a machine-readable `code` and a plain-English `suggestion`, so an application can branch on failure type without parsing raw RPC strings itself.

---

# Architecture

```
                          Your Application
                                  │
                                  ▼
                      ┌────────────────────────┐
                      │      fiberprobe        │
                      ├────────────────────────┤
                      │       canPay()         │
                      │      probePay()        │
                      │     canReceive()       │
                      │    FiberEventEmitter   │
                      │      FiberClient       │
                      └────────────────────────┘
                                  │
                                  ▼
                         Fiber JSON-RPC API
                                  │
                                  ▼
                           Fiber Network
                                  │
                     ┌────────────┴────────────┐
                     │                         │
                 Public Graph            Private Liquidity
             (Channel Capacity)      (Live Channel Balances)
```

fiberprobe sits between application code and Fiber's RPC interface, providing higher-level primitives that help applications understand whether payments are actually possible.

---

# Two Tiers, Because One Estimate Isn't Enough

```
          Fast
           │
           ▼
      canPay()
Public Graph Analysis
     ~ milliseconds
           │
           ▼
   Need certainty?
           │
           ▼
     probePay()
   Live HTLC Probe
     Ground Truth
           │
           ▼
Need receiving capacity?
           │
           ▼
    canReceive()
Inbound Liquidity Analysis
```

| Method | Speed | Network Cost | Accuracy |
|---------|:----:|:------------:|:--------:|
| `canPay()` | ⭐⭐⭐⭐⭐ | None | Estimate |
| `probePay()` | ⭐⭐⭐ | Brief HTLC lock | Ground Truth |
| `canReceive()` | ⭐⭐⭐⭐⭐ | None | Exact (Local Node) |

---

# `canPay()`

Resolves the destination from an invoice, checks for a direct channel, and — if none exists — falls back to a **Breadth-First Search** over the public channel graph. BFS is used because the goal isn't the globally optimal route; it's finding practical candidate paths fast, minimizing hop count for a quick pre-flight estimate. Weighted algorithms (Dijkstra, probability-aware routing) are on the roadmap.

Each hop is scored against whatever `outbound_liquidity` operators have chosen to publish — most don't; it's optional and frequently `null` — combined using weakest-link logic, since a payment fails the moment any single hop can't forward it.

```ts
{
  canPay: true,
  confidence: 0.67,
  hopCount: 2,
  destinationPubkey: "...",
  estimatedRoute: ["Alice", "Bob", "Carol"]
}
```

```ts
const estimate = await checker.canPay({ invoice })

if (estimate.confidence >= 0.90) {
    // Very likely to succeed.
}
if (estimate.confidence >= 0.60) {
    // Good candidate — consider verifying with probePay().
}
if (estimate.confidence < 0.30) {
    // Unlikely to succeed.
}
```

Costs nothing, takes milliseconds, and is right most of the time — but it's necessarily an estimate, because gossip-announced capacity is not the same as current usable liquidity. Graph traversal is **O(V + E)**, memory **O(V)**, so it stays fast even as the network grows.

| Property | `canPay()` |
|----------|------------|
| Network traffic | None |
| Speed | Very Fast |
| Cost | Free |
| Accuracy | Estimate |
| Uses HTLCs | No |
| Requires invoice | Yes |

---

# `probePay()`

This is the part of the SDK we're most confident about, because we verified it directly against our own live Fiber testnet nodes before writing any production code.

**The mechanism:** generate a random 32-byte value, hash it, and send a real HTLC to the destination's pubkey using that fake hash as the payment hash — no invoice involved.

```
Random 32-byte secret → SHA-256 → Fake Payment Hash → Real HTLC → Alice → Bob → Carol
```

The payment travels the real route with real HTLCs locked at every hop. Because the true preimage was never generated by the destination and never revealed by us, no node on the path — including the destination — can ever claim the funds. Two outcomes are possible:

**Success.** The destination receives the HTLC and rejects it with `IncorrectOrUnknownPaymentDetails`. This is the "successful failure": the only reason it failed is that we made up the hash. Every hop along the entire route had enough live liquidity to carry this exact amount, at this exact moment. Verified live on our own 3-node testnet topology (Alice → Bob → Carol, 2 hops): **resolved in 577ms.**

**Failure.** The HTLC gets rejected by an intermediate hop — e.g. `TemporaryChannelFailure` or an explicit insufficient-liquidity error. We tested this too, by probing for an amount larger than any real channel could carry, and got back the actual RPC error with real numbers:

```text
max outbound liquidity 89100000000 is insufficient, required amount: 409600000000000
```

```ts
{
    isViable: true,
    latencyMs: 577,
    hops: 2,
    terminalError: "IncorrectOrUnknownPaymentDetails"
}
```

No funds move. No invoice is required. The cost is a brief HTLC lock at each hop while the probe resolves (under 600ms end-to-end on testnet). Use it when a real payment is imminent and the answer needs to be right, not just probably right.

| Property | `probePay()` |
|-----------|--------------|
| Network traffic | Yes |
| Uses HTLCs | Yes |
| Cost | Temporary HTLC lock |
| Accuracy | Ground Truth |
| Requires destination pubkey | Yes |
| Best for | Final verification |

Fiber currently implements this using HTLCs, same as Bitcoin Lightning. PTLCs (Point Time-Locked Contracts) are a documented future upgrade in the Fiber litepaper aimed at closing a route-correlation privacy gap that HTLC-based probing shares with Lightning. `probePay()` is built against what Fiber ships today; when PTLCs land, the probing mechanism will need a corresponding update (tracked in the roadmap below).

---

# `canReceive()`

Sums usable inbound capacity across `ChannelReady` channels: `remote_balance` minus `received_tlc_balance`, so in-flight HTLCs aren't double-counted as available. Simple on paper, but two real bugs surfaced here during live testing (see below) that would have silently under-reported capacity in production.

```ts
const inbound = await checker.canReceive({ amount: "0x3B9ACA00" })

console.log(inbound.canReceive)
console.log(inbound.totalInboundCapacity)
```

Entirely local — no network probing — so it's fast enough to run continuously inside wallets and payment services.

---

# FiberClient & FiberEventEmitter

`FiberClient` is a fully typed JSON-RPC client covering node operations, peers, channels, payments, invoices, and graph queries:

```ts
const client = new FiberClient("http://127.0.0.1:8227")
```

`FiberEventEmitter` wraps adaptive backoff (250ms up to 10s, capped attempts) behind `watchPayment()`, `watchInvoice()`, and `watchChannel()`, each returning a cancel function:

```ts
const cancel = watcher.watchPayment(paymentHash, payment => {
    console.log(payment.status)
})
```

---

# Real-World Discoveries

Everything in this SDK has been run against real FNN v0.8.1 nodes on Fiber testnet, not mocked. Along the way we found and fixed five bugs that only showed up under real conditions:

1. **`graph_channels`' `limit` param must be a hex string**, not a plain integer, unlike the pattern you'd expect from other RPC fields. A naive integer call fails outright.
2. **The public graph paginates.** Testnet has 600+ channels; a single 500-entry page silently missed our own freshly opened channel. Fixed with cursor-based pagination via the `after` param, looping until `last_cursor` stabilizes.
3. **`funding_udt_type_script` is returned as `null`, not omitted**, for native CKB channels. A `!== undefined` check let every native channel get misclassified as a UDT channel and excluded from `canReceive()`, reporting 0 capacity on a channel that actually had 891 CKB available.
4. **`outbound_liquidity` is `null`, not `undefined`**, when an operator hasn't published it. Same class of bug, this time crashing `canPay()`'s hop scoring on real graph data.
5. **`peer_id` was renamed to `pubkey`** across `Channel` and related types in FNN v0.8.0; our first type pass, written from RPC docs alone, still used the old field name.

None of these would have surfaced from reading documentation. They surfaced from running three real nodes, opening real channels, and generating real invoices.

---

# Running the Demo Yourself

The demo runs three real FNN nodes locally on Fiber testnet and a React app that calls the SDK against them live. Nothing is mocked.

### 1. Get the FNN binary

```bash
mkdir fnn-node && cd fnn-node
wget https://github.com/nervosnetwork/fiber/releases/download/v0.8.1/fnn_v0.8.1-x86_64-linux.tar.gz
tar xzf fnn_v0.8.1-x86_64-linux.tar.gz
```

(For other platforms, check `https://api.github.com/repos/nervosnetwork/fiber/releases/tags/v0.8.1` for the matching asset.)

### 2. Set up three nodes

Repeat this for three directories (e.g. `fnn-node`, `fnn-node-bob`, `fnn-node-carol`), each with a distinct P2P and RPC port. The shipped `config/testnet/config.yml` needs only two lines changed per node:

```yaml
fiber:
  listening_addr: "/ip4/0.0.0.0/tcp/8228"   # unique per node: 8228, 8229, 8231...
rpc:
  listening_addr: "127.0.0.1:8227"          # unique per node: 8227, 8237, 8247...
```

For each node, generate a CKB account and export its key:

```bash
ckb-cli account new
ckb-cli account export --lock-arg <LOCK_ARG> --extended-privkey-path ./ckb/exported-key
head -n 1 ./ckb/exported-key > ./ckb/key
chmod 600 ./ckb/key && rm ./ckb/exported-key
```

Fund each node's testnet address at the Pudge Faucet: `https://faucet.nervos.org/`

Start each node:

```bash
FIBER_SECRET_KEY_PASSWORD=<your password> RUST_LOG=info ./fnn -c config.yml -d .
```

### 3. Connect peers and open channels

```bash
# From node A's RPC, connect to node B's P2P address (from its startup log)
curl -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"connect_peer","params":[{"address":"/ip4/127.0.0.1/tcp/<PORT>/p2p/<PEER_ID>"}]}' \
  http://127.0.0.1:<RPC_PORT>

# Open a channel (funding well above both sides' auto-accept minimum avoids a manual accept step)
curl -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"open_channel","params":[{"pubkey":"<TARGET_PUBKEY>","funding_amount":"0x174876e800","public":true}]}' \
  http://127.0.0.1:<RPC_PORT>
```

Poll `list_channels` until `state.state_name` reads `ChannelReady`. Our own test topology has no direct channel between the sender and the second recipient, forcing `canPay()`'s BFS and `probePay()`'s live route to actually traverse a real intermediate hop rather than a trivial direct case.

### 4. Run the demo app

```bash
cd demo
npm install
npm run dev
```

Open `http://localhost:5173`. The Vite dev server proxies `/rpc-alice`, `/rpc-bob`, `/rpc-carol` to each node's RPC port (see `demo/vite.config.ts`), so the browser never needs CORS access to raw node ports directly.

---

# API Reference

| Module | What it does |
|---|---|
| `FiberClient` | Fully typed HTTP JSON-RPC client, typed against the live FNN v0.8.1 RPC surface. |
| `PaymentChecker.canPay()` | Free static route + liquidity estimate via direct-channel check or graph BFS. |
| `PaymentChecker.probePay()` | Live empirical route verification via riskless HTLC probing. Ground truth, not an estimate. |
| `PaymentChecker.canReceive()` | Real inbound capacity across `ChannelReady` channels, correctly excluding in-flight HTLCs. |
| `FiberEventEmitter` | Adaptive-backoff watchers for payment, invoice, and channel lifecycle. |
| `FiberError` + subclasses | Typed error hierarchy parsed from raw RPC failure strings, each with a `code` and a `suggestion`. |

---

# Honest Limitations

- `probePay()` briefly locks a real HTLC on every hop along the route while it resolves. In our testing this resolved in well under a second, but if an intermediate node is unreachable, the HTLC could sit until `tlc_expiry_delta` lapses rather than failing fast. Set `timeoutSeconds` accordingly for your use case.
- `canPay()`'s confidence score reflects gossip-announced liquidity, which most operators don't publish (`outbound_liquidity` is frequently `null`). Treat it as a heuristic, not a guarantee — exactly why `probePay()` exists.
- No local "Mission Control"-style penalty cache yet. Every `probePay()` call is independent; nothing is remembered between calls in this version.
- Built and tested against FNN v0.8.1's current HTLC implementation. PTLC support is on Fiber's roadmap, not yet shipped, and this SDK will need updates when it lands.

---

# Roadmap

- Local in-memory penalty tracking for `probePay()`: remember which channels failed recently and skip them in the next BFS pass without re-probing, with a decay window so temporary conditions aren't treated as permanent
- Weighted routing using Dijkstra and probability-aware scoring
- PTLC support once Fiber ships it, since the probing mechanism's privacy properties depend on the underlying lock type
- Multi-path payment analysis
- Multi-asset (UDT/RGB++) coverage in `canReceive()` beyond the CKB-native path already implemented
- Wider RPC coverage in `FiberClient` (currently node, peer, channel, payment, invoice, graph — not yet CCH cross-chain endpoints)

---

# Why This Belongs in the Ecosystem, Not Just a Hackathon Repo

Every wallet, merchant checkout, and payment bot that gets built on Fiber will hit the exact liquidity-visibility wall this SDK addresses, on day one of integration. Right now each of them would either reinvent this from scratch or ship with silent failure modes — exactly the kind of gap that makes a new payment network frustrating to build on.

`fiberprobe` is meant to be the layer that sits between `fnn`'s RPC and application code, so that question doesn't have to be solved twice. It's typed, it's tested against real infrastructure rather than assumptions from documentation, and the failures it caught along the way — five of them, detailed above — are the kind that would otherwise ship silently into production and degrade user experience the first time someone hits an edge case.

---

# Contributing

Issues, feature requests, and pull requests are welcome.

If you've discovered an edge case in the Fiber protocol or have ideas for improving routing diagnostics, we'd love to hear from you.

---

# License

MIT

---

<div align="center">

**Category 2: Node, Routing & Diagnostics Infrastructure**
**"Gone in 60ms" Fiber Network Infrastructure Hackathon (July 2026)**

Repository: `github.com/Linnnetteseven/fiberprobe`

If fiberprobe helps your project, consider giving the repository a ⭐.

</div>
