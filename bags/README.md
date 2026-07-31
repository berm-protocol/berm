# @berm/bags

Fee continuity for Bags launches. Not an integration with Bags — a fix for the
identity fragility a Bags launch inherits.

```bash
npm install
npm test          # 17 assertions, offline, no API key
npm run probe     # read-only; needs BAGS_API_KEY
```

## The problem

Bags lets a token launch assign fee shares to a **social handle** rather than a
wallet. The SDK resolves it:

```
sdk.state.getLaunchWalletV2({ provider: 'twitter', username: 'alice' })
GET /token-launch/fee-share/wallet/v2  →  a Solana wallet
```

That is a binding from a **mutable string** to a claim on money. Handles get
renamed, abandoned, suspended, and re-registered by strangers — the same
fragility as a NIP-39 claim, except the stake is a revenue stream rather than a
badge.

Three failure modes, none exotic:

| | What happens |
|---|---|
| **Renamed** | `@alice` → `@alice_eth`; the old binding is dead or pointing at whoever takes `@alice` next |
| **Suspended** | The creator cannot demonstrate the handle was theirs — the proof lived on the account that is gone |
| **Re-registered** | Someone else holds `@alice` and has a plausible claim to a revenue stream they did not earn |

## The fix

No new mechanism. The creator's durable identity is their npub; the handle is a
*claim* attached to it, with a proof archived by a neutral third party **before**
any dispute.

```
npub ──verified claim──▶ @handle ──Bags──▶ fee wallet
  └──────── archived proof, third-party timestamp ────────┘
```

When the handle dies, the npub and the archive survive.

**Three grades, and the middle one is where most creators actually are:**

| Grade | Requires | What survives handle loss |
|---|---|---|
| `anchored` | verified claim **+** archived proof **+** immutable account id | You can demonstrate, from an archive nobody involved controls, that this key held the handle and when |
| `claim-only` | verified claim | Nothing. The proof disappears at the moment you need it |
| `none` | — | Nothing connects the fee share to a key you hold |

`summarise()` reports the number that matters to a launch operator: **what
percentage of the fee split depends on a handle alone.**

## What this does NOT do

It changes nothing on Bags' side. It cannot move a fee wallet, re-point a claim,
or touch a chain. It produces **evidence** and a signed, publishable record.

Whether Bags honours that evidence in a dispute is Bags' decision — the same
honest limit as guardian rotation, and it should never be described as anything
stronger.

The approval prompt says so out loud, and a test enforces it:

> Publish a public record linking @alice and this key to a 25% fee share.
> **This is evidence, not a transfer — it moves no funds and changes nothing on Bags.**

Anyone signing an event near a token launch must not think they are authorising
a payment.

## Verified vs modelled

**Verified.** The endpoint is live and the request shape is accepted: a
`GET /token-launch/fee-share/wallet/v2` with an `x-api-key` header returns a
clean `401 {"success":false,"error":"Invalid or inactive API key."}` on a dummy
key — a 404 or 400 would have meant the path or header was wrong.

**Modelled from public docs, not observed.** The response body shape, whether
resolution requires prior onboarding, case sensitivity, and everything about
renamed handles. `src/bags.ts` isolates all of it behind one injected
`WalletResolver`, so the tests run offline and a change in Bags' surface touches
one file.

**Unknown, and it matters most.** Run `probe.mjs` with a real key:

- **Q1** Does a handle resolve for anyone, or only after onboarding to Bags?
- **Q2** What comes back for a handle that does not exist?
- **Q3** Is resolution case-sensitive?
- **Q4** Does a **renamed** handle resolve to the old wallet, a new one, or
  nothing? *This decides whether fee continuity is a live problem or a
  theoretical one.* Needs a handle known to have changed.
- **Q5** Can a claimer re-point their wallet after launch, or is the binding
  fixed?

Record the answers here so `src/` stops being a hypothesis.

## How far this can go, honestly

| | Status |
|---|---|
| Model the resolution, validate splits locally, build continuity records | **done, tested offline** |
| Confirm the endpoint exists and accepts our request shape | **done** |
| Answer Q1–Q3 and Q5 against the live API | needs an API key. Read-only, free |
| Answer Q4 | needs a renamed handle to test against |
| Launch a token end to end | **mainnet only — no devnet is documented.** Real SOL, real money, and out of sequence |

The agreed order was protocol → product → pitch Bags → then token. Building
launch plumbing now would be building the fourth step during the second.

What is worth having for the pitch is the **demonstration**: a creator whose fee
claim survives losing their X account. That is one screen, and it is the thing
Bags cannot currently offer anyone.

## Safety

`probe.mjs` issues GET requests and nothing else. There is no code path in this
package that builds a transaction, signs anything, or touches a wallet.

Keep the API key in a file, never in a shell history or a chat window:

```bash
echo 'BAGS_API_KEY=...' > .env.local     # gitignored
set -a; . ./.env.local; set +a
npm run probe -- @yourhandle
```

Sources: [Bags API docs](https://docs.bags.fm/how-to-guides/launch-token) ·
[bags-sdk](https://github.com/bagsfm/bags-sdk)
