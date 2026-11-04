---
d: docs/start
title: Start here
summary: Run the current binding quickstart or build and test the separate generic Nostr event SDK locally.
t: [berm, quickstart]
nav: 1
x_article: none
---

# Start here

For current X-account binding, begin with the
[current binding developer quickstart](developer-current.md). The example below
is the separate generic Nostr event SDK, not proof of a current Berm binding.

## 1. Build the existing SDK locally

From a fresh repository checkout with Node 22.6 or newer:

```bash
npm --prefix sdk ci --no-audit --no-fund
npm --prefix sdk run bundle
npm --prefix sdk run example:verify
```

The bundled file is `sdk/dist/berm-sdk.global.js`. Serve those verified bytes
from your own application origin. Do not use a placeholder integrity string or
assume an unpublished CDN/package URL exists. `example:verify` uses disposable
local relays; its receipt is not public publication authority.

## 2. Connect, sign, publish

```html
<button id="connect">Connect</button>
<button id="publish">Publish</button>

<script>
  const sdk = Berm.install({ dev: true });      // dev key on localhost only

  connect.onclick = async () => {
    const session = await sdk.connect();        // may prompt, may be declined
    console.log(session.npub, session.tier, session.custody);
  };

  publish.onclick = async () => {
    const event = await sdk.signEvent({
      kind: 1,
      created_at: Math.floor(Date.now() / 1000),
      tags: [],
      content: 'hello from berm',
    });
    const receipt = await sdk.publish(event);   // two relays, or it did not publish
    console.log(receipt.success, receipt.accepted);
  };
</script>
```

That is the whole integration. There is no registration step, no key to obtain,
and no quota, because nothing was issued to you.

## 3. Check your work

`receipt.success` is `true` only when **two or more** relays accepted. One relay
accepting is not a publish — it is a single point of failure wearing the costume
of a success message. The receipt gives you the per-relay breakdown:

```json
{
  "eventId": "3a0f1597db61…",
  "accepted": ["wss://relay.damus.io", "wss://nos.lol"],
  "failed": [],
  "success": true
}
```

Paste the event id into any Nostr client. It resolves, because you published to
the open network rather than to us.

## 4. Handle the four failures

Every one of these will happen to a real user. An app that only handles the
happy path is a demo.

| Error | Means | Do |
|---|---|---|
| `UserDeclinedError` | The user said no | Return to the previous state, quietly. Not a red banner. |
| `SignerUnavailableError` | Signer offline, asleep, or popup-blocked | Offer a retry |
| `NoSignerError` | Nothing in this browser can sign | Show onboarding — every new user starts here |
| `DevSignerMisuseError` | Dev signer outside localhost | You shipped it. Remove it. |

```js
try {
  await sdk.signEvent(template);
} catch (e) {
  if (e instanceof Berm.UserDeclinedError) return;   // not an error, a decision
  showRetry(e.message);
}
```

## 5. Turn off the dev signer

`{ dev: true }` gives you a raw key in `localStorage`. It **refuses to load**
anywhere but localhost, a `file://` page, or Node — it throws rather than warns,
because every dev mode that merely warns eventually ships.

For production, give it a real signer to find:

```js
const sdk = Berm.install({
  signer: { signerOrigin: 'https://signer.xonly.ai' },   // passkey, tier 1
  appName: 'My App',
});
```

If the user already has a NIP-07 extension, the SDK uses that instead — without
being asked. They made a custody decision before they met you, and overriding it
would be the behaviour this project exists to be an alternative to.

## Next

- [Concepts](docs/concepts) — what is actually going on, in five minutes
- [Custody tiers](docs/custody) — where the key lives, and who to show that to
- [SDK reference](docs/sdk) — the full surface
- [Limits](docs/limits) — what this does not do, before you find out the hard way
