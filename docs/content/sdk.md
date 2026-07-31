---
d: docs/sdk
title: SDK reference
summary: The complete window.berm surface — every method, every error, every guarantee.
t: [berm, sdk, reference]
nav: 4
x_article: none
---

# SDK reference

`@berm/sdk` — the `window.berm` surface.

Every method is **async**, **approvable** and **failable**, because the
production signer speaks NIP-46 and round-trips through relays. Nothing in your
app may assume signing is instant or guaranteed.

**No method accepts or returns a private key.** That is not an oversight.

## Setup

### `install(opts?): XnsbSdk`

Builds the SDK and assigns it to `window.berm`. Refuses to clobber an existing
`window.berm` — two SDKs racing for the global produces bugs that look like
signer flakiness and cost hours.

### `setup(opts?): XnsbSdk`

Same, without touching the global. Throws `NoSignerError` if nothing can sign.

Returns without connecting, deliberately: `connect()` must stay inside a user
gesture or popup blockers eat tier 1.

### `detect(opts?): Availability[]`

What could sign here, right now, and why the rest cannot.

### `SetupOptions`

```ts
{
  relays?: string[];          // defaults to three public relays
  appName?: string;           // shown by signers that name the requesting app
  signer?: { signerOrigin: string; timeoutMs?: number };   // enables tier 1
  bunker?: { bunkerUri: string; clientSecret?: Uint8Array }; // enables tier 2
  dev?: DevSignerOptions | true;   // localhost only; throws elsewhere
  allow?: Tier[];             // restrict regardless of availability
}
```

## Session

### `connect(opts?): Promise<Session>`

```ts
{
  tier: 0 | 1 | 2;
  pubkeyHex: string;
  npub: string;
  displayName: string;
  picture?: string;
  binding: { state: 'verified' | 'claimed' | 'unlinked'; handle?: string };
  custody: string;    // human-readable, safe to show
}
```

### `session(): Session | null`
### `disconnect(): Promise<void>`
### `getPublicKey(): Promise<string>` / `getNpub(): Promise<string>`

## Signing

### `signEvent(template): Promise<SignedEvent>`

```ts
await sdk.signEvent({
  kind: 30023,
  created_at: Math.floor(Date.now() / 1000),
  tags: [['d', 'my-article'], ['title', 'On Sovereignty']],
  content: '# On Sovereignty\n\n…',
});
```

Rejects with `UserDeclinedError` if the user declines. The signer verifies its
own output before returning it — an event that leaves here has already been
checked.

### `encrypt(peerPubkey, plaintext)` / `decrypt(peerPubkey, ciphertext)`

**NIP-44 v2 only.** NIP-04 is deprecated and is not exposed anywhere in this
codebase, including tests. If an extension lacks NIP-44, `encrypt` throws rather
than falling back — silently encrypting with a broken scheme is worse than
failing.

## Relays

### `publish(event, relays?): Promise<PublishReceipt>`

```ts
{
  eventId: string;
  accepted: string[];
  failed: { relay: string; reason: string }[];
  success: boolean;    // true only at >= 2 acceptances
}
```

Never throws on partial failure. Publishing is not atomic, and an API that
pretends otherwise forces every app to guess. The receipt says exactly what
happened at each operator.

### `query(filters, relays?): Promise<SignedEvent[]>`

Standard NIP-01 filters. **Every signature is verified here and failures are
dropped**, then results are deduplicated by event id.

That check lives in the SDK rather than in your code because a relay is an
untrusted party, and an SDK that returns unverified events has quietly made
every consuming app responsible for a step most of them will forget.

### `relays(): string[]`

## Errors

```ts
XnsbSdkError                 // base
├── UserDeclinedError        // a decision, not a failure — no red banner
├── SignerUnavailableError   // offline, asleep, popup-blocked → offer retry
├── NoSignerError            // nothing can sign → show onboarding
│     .tried: string[]
├── DevSignerMisuseError     // dev signer off localhost → you shipped it
└── PublishRejectedError
```

Extension and bunker declines are normalised into `UserDeclinedError`, so you
branch on a type instead of on somebody else's copywriting.

## Event kinds in use

| Kind | Purpose |
|---|---|
| 0 | Profile, including NIP-39 `i` claims |
| 1 | Short note |
| 1111 | Comment (NIP-22). **Not kind 1** — a reply is not a note. |
| 10002 | Relay list (NIP-65) |
| 30023 | Long-form article (NIP-23) |
| 30024 | Draft |
| 30078 | App data (NIP-78), namespaced by `d` |

Berm `d` values: `berm:identity:v1`, `berm:archive:v1`, `berm:recovery:v1`.

## `describeForApproval(template): string`

Turns an event into a sentence naming its consequence:

```
Publish your recovery guardians — 3 named publicly, 2 needed to vouch for a new key
```

not `Save application data (berm:recovery:v1)`. A signer that says "sign this?"
without saying what "this" is has trained the user to click yes, and then the
prompt protects nobody.

Adding a kind? Add a line there rather than inventing your own vocabulary.

## Verifying the build

`npm run bundle` prints SHA-256 and SRI hashes for every artifact and writes
`.sha256` files alongside them.

| Build | Raw | Gzip |
|---|---|---|
| `berm-sdk.global.js` | 299 KB | 73 KB |
| `berm-sdk.global.min.js` | 144 KB | 51 KB |

The unminified build ships deliberately. Someone about to grant a script a
signing surface should be able to read it.
