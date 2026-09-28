# Identity model

## The root is the npub

An **npub** is the public half of a Nostr key pair, written in bech32 form
(`npub1…`). In Berm Protocol it is the **portable root of identity**. The private
key stays with the person. Berm Protocol never holds it, never asks for it, and
never signs on a person's behalf.

The protocol issues **no identifier of its own**. There is no Berm user ID, no
account number and no Berm-issued handle. The identity *is* the npub.

## External accounts are relationships

An X account is not the identity. It is an **external account** that an npub
proves a relationship with. X is the first namespace; the generic binding shape
(`berm.external_account_binding/1`) exists so later namespaces can fit the same
pattern without widening X.

```text
npub  ──binds──▶  x:accountId 44196397   (handle shown at observation: @alice)
      ──binds──▶  (future namespaces)
```

## Handle is not identity

- `accountId` is X's **immutable** numeric account identifier. It is the key.
- `handle` is what a human reads — the screen name displayed when the post was
  observed. It is descriptive presentation, not the key.
- A renamed, sold or recycled handle does **not** move a binding. The same
  `accountId` stays bound to the same npub.

## Cardinality

```text
(namespace, accountId) -> at most one npub, permanently
npub                   -> zero, one, or many external accounts
```

- An accepted external account can never later bind to a different npub.
- One npub may attach a replacement X account after a prior one is locked, and
  may attach accounts in other namespaces.
- Several external accounts do **not** multiply an npub's identity or weight in
  any application.

## Identity is not campaign membership

The portable X binding carries **no** campaign, cohort, slot, destination,
allocation, provider or token field. Those belong to applications.

BermLaunch, for example, runs its own separate step:

```text
portable identity evidence → campaign enrollment → unique (campaignId, npub) position
```

and enforces `(campaignId, npub) -> at most one campaign position`. Enrollment is
a separate, separately signed act. Deleting a campaign position changes nothing
about the portable binding.
