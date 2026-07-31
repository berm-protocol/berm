# Link your X handle

The whole identity-binding flow with **no API access of any kind** — no developer
account, no API key, no seed phrase, nothing to pay for.

```bash
npm install && npm run build && npm run serve   # http://localhost:8105
npm run verify                                  # headless run against local relays
```

## The five steps

1. **Identity** — a key derived on the device. No seed phrase shown, because
   there is nothing to show.
2. **Post the proof** — a share intent, which is a plain URL. No API.
3. **Paste the post URL** — parsed for handle and post id.
4. **Archive it** — Wayback, so the evidence outlives the account.
5. **Sign and publish** — kind 0 (NIP-39) plus a kind 30078 attestation.

## Step 4 is the point

The proof post **dies with the X account**. That means the evidence for your
identity disappears at exactly the moment someone else has registered your old
handle and is claiming to be you. An archived copy is held by a third party with
no stake in the dispute and carries its own timestamp.

### What the archive APIs actually allow

Measured, not assumed:

| Endpoint | Result |
|---|---|
| `archive.org/wayback/available` | HTTP 200, **`Access-Control-Allow-Origin: *`** |
| `web.archive.org/save/<url>` | no CORS headers |

So a browser **can** verify snapshots directly, and **cannot** submit a capture
and read the result.

The primary path therefore needs no credentials from anyone: open the save URL
in a tab, let the user watch the capture happen, then poll the CORS-open
availability API until the snapshot appears. Server-side automatic capture is an
optional upgrade for nodes that configure archive.org credentials — the same
shape as the X API decision. **Free path primary, automation as convenience.**

### The freshness check that matters

Popular URLs often already have old captures. Accepting one would attach
evidence that *predates the proof post itself* — which is worse than no
evidence, because it looks valid. So any snapshot older than the moment the flow
started is rejected and a fresh capture is requested.

## Two events, deliberately separated

| Event | Contents | Why |
|---|---|---|
| kind 0 | standard NIP-39 `i` tag | Damus and Amethyst render it without knowing XOnly exists |
| kind 30078 `d=berm:identity:v1` | account id, archived proof, capture time | XOnly-specific evidence, kept out of the standard event |

## Why the account id field is there

**Handles recycle; numeric X ids never do.** If an account is deleted, someone
else can register the handle — and a claim bound only to the handle cannot tell
the original owner from the newcomer. The id is public and permanent, and it is
what makes the claim survive.

## Approval prompts name consequences

The signer never says "sign a kind 30078 event". It says *"Publish an identity
attestation linking @dorian"*. A prompt that doesn't say what **this** is has
trained the user to click yes.

## Testing note

Wayback is unreachable from the build sandbox (egress policy), so `verify.mjs`
stubs the two network calls the archive module makes. URL construction, the
freshness rule, and polling are exercised for real; only the network hop is
replaced. The capture path itself is **untested against live Wayback** and
should be run by hand once.

## Verified

URL parsing across `twitter.com`, mobile subdomains, tracking parameters and
`/photo/1` suffixes; the archive step recording a snapshot with capture time;
both events signed with specific approval prompts, published, and
signature-verified by two independent relay processes.
