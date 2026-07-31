# NIP-XX draft — Guardian pre-commitment and social key rotation

> **Second proposal, not first.** More useful and far more contentious than the
> NIP-39 amendment. Do not open this until that one has landed and you have
> standing.
>
> Kind numbers below are marked *proposed*. Do not squat a number — let the
> maintainers assign one.

---

## Abstract

A pubkey that is lost cannot be recovered by any cryptographic means. This NIP
describes a way for a user to name, **in advance**, a set of pubkeys that may
later attest that a new key belongs to the same person, and for resolvers to
choose whether to honour that attestation.

This is **social consensus, not key recovery.** Nothing here restores a lost
key, decrypts anything, or grants any authority. It defines an attestation and
the rules for evaluating it; whether to act on it is entirely the resolver's
decision.

## Motivation

Losing a key today means losing an identity permanently. In practice people
respond by keeping keys somewhere convenient and insecure, which trades a rare
catastrophic failure for a common one.

Every existing mitigation — a backup file, a synced passkey, a hardware signer —
protects the *key material*. None help when the material is genuinely gone. The
gap is not cryptographic and cannot be closed cryptographically; the only thing
left is the fact that other people know who you are.

The design constraint is that this must be **impossible to arrange after the
loss**, or it becomes a mechanism for taking identities rather than keeping them.

## Pre-commitment

**Kind `10050` (proposed)** — replaceable, one per pubkey.

```jsonc
{
  "kind": 10050,
  "tags": [
    ["p", "<guardian-pubkey>", "<relay-hint>"],
    ["p", "<guardian-pubkey>", "<relay-hint>"],
    ["p", "<guardian-pubkey>", "<relay-hint>"],
    ["threshold", "2"],
    ["expiry", "1816531200"]          // OPTIONAL
  ],
  "content": ""
}
```

- `p` tags name the guardians. There MUST be at least one.
- `threshold` is the number of distinct guardian attestations required. It MUST
  be present, MUST be an integer ≥ 1, and MUST NOT exceed the number of `p`
  tags.
- `expiry` is OPTIONAL. After it, resolvers MUST NOT honour a rotation citing
  this pre-commitment. Its purpose is to bound the lifetime of a commitment the
  author may no longer be able to update — because if they could update it, they
  would not need it.
- `content` SHOULD be empty. It MUST NOT contain anything a resolver depends on.

Guardians are named publicly. Authors MUST be told this before signing: the
event permanently discloses a set of the author's trusted contacts.

## Rotation attestation

**Kind `1050` (proposed)** — regular event, signed by a guardian.

```jsonc
{
  "kind": 1050,
  "tags": [
    ["e", "<pre-commitment-event-id>", "<relay-hint>"],
    ["from", "<lost-pubkey>"],
    ["to", "<new-pubkey>"]
  ],
  "content": "<OPTIONAL human-readable note>"
}
```

- `e` MUST reference the specific pre-commitment being honoured, by event id.
  Referencing the author's pubkey alone would let an attestation float onto a
  later, different pre-commitment.
- `from` MUST equal the pubkey of the referenced pre-commitment's author.
- `to` is the replacement pubkey.

## Resolution

A resolver MAY treat `to` as a continuation of `from` when **all** hold:

1. A kind `10050` exists, signed by `from`, whose id matches the `e` tag of
   every attestation counted.
2. At least `threshold` kind `1050` events exist, each signed by a **distinct**
   pubkey named in that pre-commitment, each with the same `from` and the same
   `to`.
3. The pre-commitment has not expired.
4. The resolver has no newer kind `10050` from `from` that omits those
   guardians. Resolvers SHOULD query several relays before concluding this — a
   single relay withholding a newer pre-commitment is the cheapest attack here.

A resolver that honours a rotation SHOULD surface it to the user as a distinct,
weaker state than a signature from the original key, naming the guardians who
attested.

## Security considerations

**`created_at` is not evidence.** It is chosen by the signer. A resolver MUST
NOT rely on it to establish that a pre-commitment predates a loss. Authors who
need that ordering to withstand a hostile reading SHOULD anchor the
pre-commitment externally — an OpenTimestamps proof, or any timestamp the author
does not control.

**The real attack is guardian compromise.** An adversary cannot forge a
pre-commitment without the author's key — if they had it, they would not need
this. The reachable attack is compromising `threshold` guardians. Authors SHOULD
choose guardians who are independent of each other, and resolvers SHOULD weigh a
low threshold accordingly. A 1-of-1 pre-commitment is a single point of failure
with extra steps.

**This mechanism MUST NOT gate anything of value.** It MUST NOT be used to
authorise payments, transfer funds, unlock encrypted material, or grant access
to anything a compromise would be costly to reverse. Attestation is safe to
build on precisely because a false one can be reassessed; custody cannot. A
threshold that is adequate for "this is probably the same person" is
catastrophically inadequate for "give this person the money."

**Guardians learn nothing and hold nothing.** They cannot decrypt, cannot sign
on the author's behalf, and hold no share of any key. Implementations MUST NOT
describe this as key recovery, key sharing, or backup.

**Publication is permanent.** The pre-commitment is a public, replaceable event
naming real people. It cannot be meaningfully retracted from relays that have
already stored it.

## Client responsibilities

A client that signs a kind `10050` MUST show the author, before signing, that
the event names their guardians publicly and permanently, and MUST state the
threshold in the same sentence. A prompt that says "save application data" for
this event is not conformant.

Suggested wording:

> Publish your recovery guardians — 3 named publicly, 2 needed to vouch for a
> new key.

## What this does not do

- It does not recover a key. The old key stays lost.
- It does not move content. Events signed by the old key remain signed by it,
  readable forever, and unmodifiable.
- It does not compel anyone. Every resolver decides independently, and a
  resolver that ignores this NIP is fully conformant with everything else.

---

## Notes for the PR description, not the spec

**Why not NIP-26.** NIP-26 is marked unrecommended for adding burden with little
gain, and the objection will be raised here. It does not apply: NIP-26 let a key
authorise another key to sign *on its behalf while it still exists*, which
duplicated what a signer already does. This defines an attestation used *only
after a key is gone*, produces no new signing authority, and is evaluated by
resolvers rather than enforced by relays. Nothing is delegated.

**Why a pre-commitment rather than an ad-hoc vouch.** Guardians attesting
without a prior commitment would be a mechanism for taking identities: convince
two of someone's contacts, claim their npub. The commitment must exist before
the loss or the whole thing inverts.

**Why resolvers decide.** Making this binding would mean relays or clients
adjudicating identity disputes. Leaving it advisory keeps rule 3 satisfied —
implementations that ignore it keep working — and keeps the failure mode
recoverable.

## Rule 1 checklist

- [ ] NIP-39 amendment merged first
- [ ] Client A implements pre-commitment, attestation and resolution
- [ ] **Client B — different project, different author**
- [ ] One relay indexes both kinds (no special handling needed; note this)
- [ ] A worked example of the guardian-compromise attack, with the threshold that stops it
- [ ] Wording review: no sentence in the spec calls this recovery
