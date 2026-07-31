# @berm/signer-log

Signer transparency. Turns "trust the signer origin" into "check the signer
origin, and let everyone else check it too."

```bash
npm install
npm test                       # 20 assertions, offline
php ../wordpress/tests/test-signer-gate.php   # 16 assertions, the node side
```

## The problem

A signer origin serves JavaScript that derives or unlocks identity keys. It can
serve *different* JavaScript tomorrow — to one user, from one IP, for one hour —
and nothing in the browser will say so. SRI doesn't help: the same origin
controls the page that declares the hash.

This is the structural limit of browser-delivered cryptography, and it applies
to every hosted signer, not just ours.

## What this does instead

Transparency doesn't remove the power. It makes *using* it leave permanent,
public, third-party-verifiable evidence.

```
signer publishes   "version 2.4.1 of my bundle hashes to H"   (signed, offline key)
anyone fetches     the bytes actually served, hashes them
mismatch           a provable accusation, not an opinion
```

## The one rule that makes or breaks it

**The attestation key must not live on the web server.**

If it does, whoever takes the server signs whatever they serve, and the log
attests to their code as faithfully as to yours. Offline key, published pubkey,
signed at release time.

Everything else here is decoration if that rule is broken.

## The node is the watchdog

This is what makes federation work rather than just multiplying single points of
failure.

The WordPress node already opens the signer popup for its visitors. Before it
does, it fetches the bundle server-side, hashes it, compares against the
published attestation, and **refuses to open the popup on mismatch**.

That inverts the "replaceable / untrusted" layer: thousands of independent
installs, on thousands of networks, each checking a signer it doesn't control
and has no incentive to cover for. Better detection than anything a signer
operator could run for itself.

The PHP side reuses the node's existing pure-PHP BIP-340 verifier — no new
cryptography, no extensions.

## Three states, and the middle one is the point

| State | Meaning | Action |
|---|---|---|
| `verified` | served bytes match the signed attestation | proceed |
| `unattested` | nothing to check against — unknown, not proven bad | policy: default **block** |
| `mismatch` | served bytes differ from what was signed for | **always block** |

A mismatch is never a warning, never a degraded badge, never a console message.
Same discipline as `claimed` vs `verified` in the identity layer: collapsing
"couldn't check" into either "passed" or "failed" produces the wrong action.

Unreachable never allows either — *cannot check and cannot reach* is the worst
state, not a permissive one.

## Who may speak for an origin

Pinned keys, deliberately. Publishing the key at the origin lets a hijacker
publish their own; NIP-05 has the same hole. This is the certificate-root-store
model — rigid, updated out of band, and honest about being a trust decision.

The on-chain root replaces this with a commitment nobody can rewrite. Until
then, an operator pins what they choose to trust.

## The honest limit

**A signer can serve different bytes to a monitor than to a user**, keyed on IP
or user agent. Transparency does not prevent that.

What it does: makes broad tampering impossible to hide, and targeted tampering
expensive and permanent once caught — the attacker must correctly identify and
exclude every monitor, forever, and one mistake is public evidence that never
expires.

Certificate Transparency has exactly this shape. It didn't stop misissuance; it
made it discoverable. That's the claim, and it's worth having.

## Findings

A monitor publishes what it observed, carrying **both hashes and the time**, so a
third party can re-run the check and either corroborate or refute it — including
refuting ours. An accusation nobody can check is worth as little as one nobody
can corroborate.

## Tests worth reading

The adversarial ones, in `test/transparency.test.ts` and `tests/test-signer-gate.php`:

- a hijacked origin serving altered code → mismatch, blocked
- an attacker publishing a **newer** attestation signed with their own key → still mismatch
- a forged attestation attempting to shadow the genuine one → genuine wins
- a stale attestation → treated as absent, not as weak proof
- a tampered attestation → fails signature verification
- the genuine key when not pinned → rejected

Attestations in the PHP suite are signed by `nostr-tools` and verified by the
node's own implementation. A gate that only agrees with the library that
produced its inputs proves nothing.
