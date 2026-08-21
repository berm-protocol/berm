# xonly signer

**Tier 1 custody at its own origin.** A person with no extension and no bunker
gets a real Nostr key they own, encrypted to a NIP-49 file they hold. Other
origins ask for signatures over `signer/1` and never see the key.

```
npm run build     # dist/xonly-signer.html — one self-contained file
npm test          # asserts the no-persistence guarantee against the BUILT bundle
npm run verify    # cross-origin end to end: real popup, real postMessage, real signature
npm run serve     # http://localhost:8200
```

## What holds the guarantee

| Claim | How it is held |
|---|---|
| The key is never persisted | `test/no-persistence.test.mjs` scans the shipped bundle for every storage and egress API and fails the build on a hit |
| The signer talks to no network | same test rejects `fetch(`, `XMLHttpRequest`, `sendBeacon` |
| `postMessage` never uses `targetOrigin: '*'` | same test, by regex; and the signer sends no ready announcement precisely because it would require one |
| A popup, never an iframe | `frame-ancestors 'none'` in `infra/Caddyfile.xonly`, plus `X-Frame-Options: DENY` |
| The requesting origin cannot be forged | it is read from `MessageEvent.origin`, never from the message body |
| Absence of an explanation is shown | `explains()` checks a sentence exists and is not the method name; the raw event is shown **always**, so the sentence is a courtesy on top of the evidence |
| A grant cannot mean "sign anything" | `grants.ts` scopes every grant to methods **and** kinds, and expires it |

## What it deliberately does not do

`nip04_encrypt` / `nip04_decrypt` — NIP-04 is prohibited repo-wide, and a signer
that ships a broken primitive because clients ask for it is how broken primitives
survive. `nip44_*` returns `unsupported_method` in this build rather than a stub
that returns something plausible.

There is no passkey tier here. `ENROLLMENT-SPEC.md` §1.3 defers it, so no WebAuthn
ceremony runs and no RP ID is committed.

**No handle claiming.** The signer makes a key and signs events; it does not
write a kind 0 or attach an external identity. That is not an omission to fill in
later without reading `nips/01-issue-nip39-fragility.md` first: NIP-39 binds to a
**mutable handle** on X, GitHub and Mastodon — a name that can be released and
re-registered by someone else — while only Telegram binds to an immutable ID.
A badge rendered from such a claim is doing real work for a reader, and it breaks
in exactly the case it exists for. Whatever this project ships for handle claims
has to answer that first.

## Where it sits

One tier-1 client talks to this page: `sdk/src/backends/berm-signer.ts`, reached
through `connect.ts` `setup()`. Applications do not choose a backend — they name
a signer origin and let `detect()` report what is actually available. Tier 0, an
extension the user already has, still wins over this whenever it is present.
