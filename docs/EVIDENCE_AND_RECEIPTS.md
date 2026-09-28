# Evidence and receipts

Five public artifact types. Each has one signer and says one thing.

| Artifact | Signed by | Says |
|---|---|---|
| `ExternalBindingClaim` | the **subject** npub | *this binding is mine* |
| `BindingObservation` | a **validator-instance key** | *I fetched, I ran the method, this is what I derived* |
| `ValidatorAuthorization` | an **operator** npub | *this key observes on my behalf, under this method* |
| `ApplicationAcceptancePolicy` | an **application** | *these methods, these keys, this matching rule* |
| `BindingAcceptanceReceipt` (optional) | an **application** | *I accepted this bindingHash under this policy* |

## Domain separation — two signatures, never merged

- The **subject** signs the claim. It establishes attribution and intent, and
  nothing about whether the post exists.
- The **validator** signs only its own observation. It establishes what one
  party's fetch returned.
- An implementation must never sign a binding on a user's behalf, and a
  validator must never sign a claim.

In BermLaunch, the identity claim and the campaign enrollment are also two
distinct, domain-separated signed acts.

## Hashes inside the evidence

- `bindingHash` — hash of the canonical six-field binding. Recomputable by anyone.
- `captureHash` — hash of the exact response bytes a validator received. Audit
  evidence only; it is **outside** acceptance.
- `methodHash` and `acquisitionHash` — which method and intake profile were run.

## Receipts are application decisions

A `BindingAcceptanceReceipt` records that one application accepted one binding
under one policy version. Delete every receipt and the observations still prove
exactly what they proved before.

## No public Nostr kind is allocated

Every artifact `kind` is a Berm-namespace string (for example
`berm.binding_observation/1`). These documents do not claim any public Nostr
event kind number.

## Where evidence lives

The artifacts form an append-only public evidence graph. It can be mirrored by
Nostr relays, Git, static archives, content-addressed storage or indexers, and
**no mirror is authoritative over another**. This repository and the BermLaunch
website are evidence carriers and explanations — not issuers, and not final
authority.
