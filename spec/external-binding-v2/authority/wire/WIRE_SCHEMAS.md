# The public wire schemas

Five artifacts, JSON Schema draft 2020-12, in `wire/schemas/`. `common.defs.json`
carries the shared grammars so a field cannot be spelled two ways in two files.

| Schema | Signed by | Purpose |
|---|---|---|
| `ExternalBindingClaim` | subject `npub` | the subject asserts the binding is theirs |
| `BindingObservation` | validator-instance key | one validator states what its own fetch derived |
| `ValidatorAuthorization` | operator `npub` | an operator authorizes one dedicated validator key |
| `ApplicationAcceptancePolicy` | an application | the accepted methods, keys and matching rule |
| `BindingAcceptanceReceipt` | an application | an optional record of one acceptance decision |

**No public Nostr kind is allocated.** Every `kind` is a Berm-namespace string
(`berm.…/1`). Mapping any of them onto a numbered public kind is a separate
founder decision, deliberately left open.

---

## Four choices worth defending

### `additionalProperties: false` on the binding

The six-field rule of FD-BP-04 is expressed **in the schema**, not only in prose.
A seventh field fails validation rather than travelling quietly to a reader who
did not know to look for it. R8 shipped a fourteen-member envelope wrapping a
fifteen-member payload; a schema that rejects a seventh member is the cheapest
place that can never happen again.

### `captureHash` is OPTIONAL, and is not in the comparison

**Optional** — an observation that omits it is fully conforming and is accepted
on exactly the same terms. Outside `bindingHash`, so it cannot create a second
comparison court. When two validators both record one they **should** disagree
on it, and that disagreement is worth a reader's attention; but nothing in
acceptance may read it, and neither its presence, its absence, its equality nor
its inequality moves any outcome. `EVIDENCE_FOLD.md` §4.

> **Reversed in R4-R2 (GPT-R4DR-B01).** This document, the schema's `required`
> array, and three executable gates all stated the opposite — that captureHash
> was mandatory — which contradicts the controlling authoring order §4.9. A
> mandatory Stage-A member **is** an acceptance gate, whatever the sentence
> beside it claims. The gate written to prove the value was outside acceptance
> was the gate enforcing it as a condition of admission.

### `matching.rule` is a `const`, not a number

```json
"rule": { "const": "all_required_keys_identical_binding_hash" }
```

A threshold rule is a **different rule** and needs a different value here. Left as
a bare number, a policy could quietly become a quorum by someone editing `2` to
`1` — and quorum is exactly what §11 of the work order prohibits for V1
admission.

### The policy carries no self-hash

`ApplicationAcceptancePolicy` has **no `policyHash` member**. A reader computes
`artifactId(policy)`, and the projection omits **only `sig`** — so every other
field of every artifact is signed and hash-identified.

The earlier shape hashed the policy inside itself, which forced `policyHash` to be
excluded from the projection everywhere. That exclusion also removed
`BindingAcceptanceReceipt.policyHash` — a **reference** to the governing policy —
from the receipt's own signature, so the reference could be changed without
invalidating anything.

### `$ref` is absolute, not relative

Every reference into `common.defs.json` is written as the full
`https://berm.protocol/schemas/common.defs/1#/$defs/…`.

The obvious relative form — `common.defs.json#/$defs/npub` — **does not resolve**.
A `$ref` is resolved against the referring schema's own `$id` base, and every
`$id` here ends in a version segment, so `BindingObservation/1` +
`common.defs.json` gives `…/schemas/BindingObservation/common.defs.json` — a
document that does not exist.

> This shipped in the first draft and `tools/validate-schemas.mjs` caught it the
> moment a real validator was pointed at the files. It is exactly the kind of
> defect that survives review — the files look right, and every reader who does
> not run a resolver agrees.

### `endpoint` is explicitly non-authoritative

Acceptance is expressed over **method hashes and keys**. A policy that resolved
identity by hostname would put DNS inside the trust model, and every earlier round
of this work has said so; the schema says it too, so a reader of the schema alone
cannot get it wrong.
