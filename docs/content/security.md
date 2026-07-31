---
d: docs/security
title: Security model
summary: Who we defend against, what is out of scope, and the design we shipped broken and then killed.
t: [berm, security, threat-model]
nav: 8
x_article: adapted
---

# Security model

## Who this defends against

| # | Actor | What they can do | Defence |
|---|---|---|---|
| T1 | Curious node operator | Read all server-side data and memory | The node never receives key material |
| T2 | Malicious node operator | Serve modified JS to their visitors | Signer-origin isolation; SRI and reproducible builds |
| T3 | Public observer | Knows every user's X ID, handle and npub | No secret is derivable from public data |
| T4 | Relay operator | Sees every published event and connecting IP | NIP-44 for private payloads; relay diversity |
| T5 | X, the platform | Revoke OAuth, ban accounts, change APIs | X is on the auth path, never the correctness path |
| T6 | Impersonator | Register lookalike handles and npubs | Two-way binding; `claimed` never rendered as `verified` |
| T7 | Supply-chain attacker | Compromise a dependency, CDN or release | No CDN, pinned deps, reproducible signed releases |
| T8 | **This project** | We host the default signer origin | The signer cannot decrypt; self-hosting is first-class |
| T9 | **Whoever holds the signer domain next** | Obtain the identity key of every tier-1 user who authenticates after the transfer | **Not defended against.** Tiers 0 and 2 avoid it entirely; the fix for tier 1 is specified and unbuilt |

T8 is not decoration. A protocol that requires you to trust its authors has not
solved the problem it claims to solve, and the correct response to "why should
we trust you" is a design where you do not have to.

**T9 is the one we got wrong for a long time.** WebAuthn binds every credential
to an RP ID derived from the signer origin, and the authenticator will release
the secret to any page served under that name — it has no way to tell one
operator from another. Domain lapse, sale, registrar action or a court order all
hand that ability over, with no compromise of any system. Everything under
*Practices* below defends the **bytes served under a name**; this is an attack on
the **name**, and none of it applies.

Two things bound the damage, and neither removes it. A future name-holder can
sign as the user going forward but cannot alter, delete or claim what the user
already published — signed events on relays are not theirs to touch. And nodes
running the [signer gate](docs/node) refuse an origin whose bytes do not match an
attestation signed by a pinned, offline key, which a new name-holder cannot
produce — protecting users who arrive through a gated node, not users who go to
the signer origin directly.

The documentation used to present the three tiers as differing only in friction.
That was false. [Custody tiers](docs/custody#what-tier-1-costs) now ranks them
correctly and states the resolution path.

## Out of scope, stated rather than hand-waved

- Malware on the user's device with DOM access at the signer origin
- A compromised authenticator
- A global passive adversary correlating traffic across relays

These are real. They are not defended against here, and pretending otherwise
would be worse than admitting it.

## The design we killed

The first version derived the identity key from a **public** value:

```
nsec = HKDF(x_user_id, public_salt)          ← every input is public
```

X user IDs are public. The salt was in the source. So anyone could compute
anyone's private key from information printed on their profile. Zero bits of
security — not weak, not "sufficient for now": **none**.

Adding a PIN would not have saved it. A six-digit PIN falls to exhaustive
offline search in about nine seconds on one CPU core, and the test suite proves
that by *doing it*, rather than asserting it.

The broken derivation is kept in the repository under `src/quarantine/`,
excluded from the build, imported by exactly one test file, with CI asserting
all three conditions. `attackerRecoversV1Key('12345678')` takes nothing but a
public integer and returns the victim's private key. It is the slowest test in
the suite and worth every second, because a design failure that is merely
described gets rediscovered, while one that is executed cannot be.

The fix was not a patch. It was replacing the entropy source with the WebAuthn
PRF extension: 32 bytes computed inside the authenticator, not derivable from
anything public.

## Guarantees, and where they stop

**Proven by tests you can run.** Derivation stability and purity; scalar
boundary handling; NIP-01 canonical serialization; NIP-44 v2 against official
cross-implementation vectors; multi-device wrapping including tampered, swapped
and wrong-credential blobs; that the v1 derivation is attacker-reproducible;
that a forged event from a hostile relay is dropped; that one relay accepting is
not reported as published.

**Enforced by the browser, not by us.** That a passkey cannot be used from a
second origin. This is the WebAuthn RP-ID guarantee and it cannot be unit-tested
in Node. What *is* tested is our half — that the derivation refuses to run
anywhere but the configured signer origin. The browser half is a manual
checklist, run per platform, before release. We would rather say "partial" than
imply coverage we do not have.

**Not a cryptographic guarantee at all.** Guardian rotation. It is social
consensus and should never be described as key recovery.

## Practices

- **No CDN.** Every artifact is served from origins the project controls, with
  published SHA-256 and SRI hashes. A supply-chain attack on a CDN is a
  supply-chain attack on every user at once.
- **NIP-04 is prohibited repo-wide**, including in tests. NIP-44 v2 only.
- **Dependencies are pinned.** A major bump to `nostr-tools`, `@noble/hashes` or
  `@noble/curves` invalidates the test vectors and must re-run them before merge.
- **The test vectors are frozen.** A changed value means every existing user's
  identity just changed. Regeneration is a deliberate, versioned migration, never
  a fix for a red test.

Every claim above has a command that checks it — see
[Verify it yourself](docs/verify). The boundaries this model does not cover are
listed in [Limits](docs/limits).

## Reporting

Security issues: open a GitHub issue for anything already public; for anything
that is not, use the contact address in `SECURITY.md` rather than a public
tracker. We will publish the finding and the fix — including, as above, our own.
