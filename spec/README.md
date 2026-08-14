# Specification

| File | What it is |
|---|---|
| [`LAW-OWNERSHIP.md`](LAW-OWNERSHIP.md) | Which repository owns which law, which vectors pin it, and which direction imports run. One law, one owner, one frozen vector set — everything else is a cross-check. Records one live divergence. |
| [`UNIFIED.md`](UNIFIED.md) | How the protocol, xonly.ai and bermlaunch.com are one system — the problem all three solve, what a launch looks like end to end, what is trusted, and what is actually built. **Not normative.** Start here if you want the shape before the rules. |
| [`v2.0-architecture.md`](v2.0-architecture.md) | The normative spec. Threat model, identity architecture, data layer, node boundary, conformance checklist, rejected alternatives. |
| [`signer-broker.md`](signer-broker.md) | How a third-party application gets a signature from a Berm user without ever touching their key. The request protocol, what an API key does and does not buy, and why attestation is the product rather than a feature. |
| [`v2.1-amendment.md`](v2.1-amendment.md) | Thirteen changes on top of v2.0 — key wrapping for multi-device, recovery, guardians, two node bug fixes, measured X paste behaviour. |

**Read v2.0 §0 first.** It describes what v1 got catastrophically wrong and why
the whole thing was redesigned rather than patched. Everything else follows from
that section.

The v2.1 amendment does not replace v2.0. Where they conflict, the amendment
wins and says so explicitly at the top of each section.

## Relationship to the code

The spec is normative; the code is an implementation of it. Where they disagree,
that is a bug in one of them and worth an issue.

`crypto/` implements §3 (identity) and §7 (test vectors). `sdk/` implements §5.4
(the `window.berm` surface). `wordpress/` implements §5 (the node), whose
allowed operations are exhaustively listed in §5.2 — anything a node does beyond
that list is a bug by definition.
