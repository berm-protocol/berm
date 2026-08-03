# @berm/bags

Fee continuity for Bags launches. Not an integration with Bags — a fix for the
identity fragility a Bags launch inherits.

```bash
npm ci
npm test          # 52 assertions, offline, no API key
npm run build     # the dispute screen → dist/dispute.html
npm run verify    # 26 browser checks, mostly about what it refuses to say
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

## Checked against the spec, and one claim we had to withdraw

**Checked.** Every path, parameter, enum and field in `src/bags.ts` is transcribed
from Bags' published OpenAPI specification (`docs.bags.fm/api-reference/openapi.json`,
read 2026-08-03) and pinned in `test/spec.test.ts`. The spec check corrected four
things:

| We had | The spec says |
|---|---|
| `/token-launch/fee-share/wallet/v2` | `/agent/v2/fee-share-wallet` |
| three providers | eleven, including `solana`, `tiktok`, `instagram` |
| no chain parameter | `chain=SOL\|EVM`, default `SOL` — one handle, two wallets |
| account id needs X OAuth | the response carries `platformData.id` for an API key |

**Withdrawn.** This file previously said the endpoint was verified, because a
dummy key returned a clean `401` rather than a `404`, and reasoned that *"a 404
or 400 would have meant the path or header was wrong."*

That inference does not hold. We were calling a path that **does not exist** and
still got `401`, which means authentication is evaluated before routing. A `401`
proves the host and the header and says nothing whatever about the path. The
check could not have failed, which is exactly why it did not — and a check whose
pass condition is also satisfied by the failure case is not a check.

Both the probe and the client used to carry their own copy of the path, and both
were wrong. There is one copy now, in `src/bags.ts`, and a test asserts the probe
imports it rather than restating it.

**The account id, and why it does not raise a grade.** `platformData.id` is the
field that does not move when a handle is re-registered, and it arrives with
nothing but an API key — so the immutable identifier we thought needed an X
developer app is simply in the response. It is still Bags' record of what a
platform said at a moment this response does not timestamp. So it is carried,
displayed, and used to detect a **conflict** with the binding's own account id —
which is the loudest thing the record can say, because it means the account being
paid and the account we hold evidence for are different. It never upgrades
`claim-only` to `anchored`. Founding a grade on a third party's cache is
manufacturing confidence, which is the one thing this package exists not to do.

## Still unverified, and only a key can settle it

Behaviour, not shape. Run `probe.mjs` with a real key:

- **Q1** Does a handle resolve for anyone, or only after onboarding to Bags?
- **Q2** What comes back for a handle that does not exist?
- **Q3** Is resolution case-sensitive?
- **Q4** Does a **renamed** handle resolve to the old wallet, a new one, or
  nothing? *This decides whether fee continuity is a live problem or a
  theoretical one.* Needs a handle known to have changed.
- **Q5** Does `chain=EVM` return a different wallet for the same handle?

Record the answers here.

**No partner program on Solana.** The partner mechanism — earn a share of trading
fees on launches you bring — is documented only for Bags' EVM (Robinhood Chain)
surface: `partnerFeeBps` defaults to 2500, taken from the protocol half, so 0.25%
of volume, and *"the creator half is never shared with partners."* The Solana
fee-share endpoints have no partner field at all. Anyone planning to earn as a
launch partner on Solana should treat that as unavailable until Bags says
otherwise.

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

## The dispute screen

`npm run build` produces one self-contained page: two parties claiming `@alice`,
one fee share, and what an operator actually has to go on.

It exists because everything above prepares evidence, and evidence is worth
having or it is decoration. The screen puts **what Bags can see today** beside
**what a continuity record adds**, because without that comparison a reader sees
a tidy record and feels no gap.

Four scenarios, and three of them are cases where we lose:

| Scenario | Verdict |
|---|---|
| Account suspended, handle re-registered | `demonstrable` — a neutral archive predating the re-registration |
| Creator verified but never archived | `unresolved`. A claim today says nothing about the past |
| A challenger archives the page today | `contested`. Earlier is stronger; two archives is a real conflict |
| Neither side archived anything | `unresolved`, and it says the operator gained nothing |

**The ranking rule.** Evidence is worth what its timestamp is worth, and a
timestamp is worth what the holder does *not* control. A capture by
`web.archive.org` beats any assertion made after a dispute began; a "proof"
hosted by the claimant proves they can write files. `NEUTRAL_ARCHIVES` is a short
allowlist rather than a heuristic — "looks like an archive" is not a property
somebody's revenue should rest on, and `isNeutralArchive` rejects
`web.archive.org.attacker.com`, which a substring check would accept.

**Possession is ranked last, deliberately.** In every failure mode this package
exists for, the wrong party is the one holding the handle.

**It never names a winner.** `adjudicate()` returns `demonstrable`, `contested`
or `unresolved` and an operator decides. A model that always produces a name
launders a guess into a verdict, and the person relying on it cannot tell the
confident case from the coin flip.

The browser suite is mostly negative assertions — that the page does not render
`demonstrable` without a neutral archive behind it, does not promise Bags will
honour anything, and contains no wording suggesting funds moved. A screen that
strengthens a claim on its way to the reader is this package's own failure mode,
one layer up, and no unit test that stops at the module boundary can see it.

**The scenarios are fixtures and the page does not pretend otherwise.** They
become real the moment there is a real npub with a real Wayback capture. A demo
that looked live would be the same overstatement in a nicer font.

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
