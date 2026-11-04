# The evidence fold — how a stranger rebuilds this without asking us

**Standing: CANDIDATE.** No public Nostr kind is allocated here. The five wire
artifacts have `kind` strings in Berm's own namespace (`berm.…/1`); mapping any
of them onto a numbered public Nostr kind is a **separate founder decision** and
is not made in this pack.

---

## 1. The five artifacts, and who signs what

| Artifact | Signed by | Says |
|---|---|---|
| `ExternalBindingClaim` | the **subject** `npub` | *this binding is mine* |
| `BindingObservation` | a **validator-instance key** | *I fetched, I ran the method, this is what I derived* |
| `ValidatorAuthorization` | an **operator** `npub` | *this key observes on my behalf, under this method* |
| `ApplicationAcceptancePolicy` | an **application** | *these methods, these keys, this matching rule* |
| `BindingAcceptanceReceipt` | an **application** | *I accepted this bindingHash under this policy* |

**Two signatures, never merged.** The subject signs the claim; the validator
signs only its own observation. An implementation **MUST NOT** sign a binding on
a user's behalf, and a validator **MUST NOT** sign a claim.

> The claim establishes **attribution and intent** and nothing about the world.
> The observation establishes **what one party's own fetch returned**. Merging
> them would produce one artifact that appears to establish both while
> establishing neither.

---

## 2. The fold — what a stranger checks, in order

Given the public artifacts and an independent implementation of
`berm.external_account_binding.x/1`, a stranger checks:

1. **the claim's signature** verifies under `binding.npub`;
2. **`bindingHash`** recomputes from `binding` under JCS — MethodSpec §6.2;
2a. **every observation's `bindingHash` is RECOMPUTED** from its own `binding` —
   `sha256(JCS(binding))` — and an observation whose declared hash does not
   reproduce **cannot count** (**F-2**);
3. for each observation, its **`authorizationRef`** resolves to a
   `ValidatorAuthorization`, that authorization's signature verifies under its
   `operatorNpub`, and its `validatorKey` is the observation's signer;
4. the operator's **own** binding is **witnessed** — it resolves to a claim and
   to observations that pass this same fold, **one level, not recursion** (§3) —
   **or** the operator is named in the policy's `genesisOperators` (§3.1);
5. each observation's **signature** verifies under its `validatorKey`;
6. every observation carries the **same `methodHash` and `acquisitionHash`** the
   policy accepts;
7. every observation's **`bindingHash` is byte-identical**;
8. `captureHash` is **optional** provenance — recorded as audit evidence where
   present, absent without consequence, and **never an acceptance condition**;
   §4;
9. the **policy's matching rule** is satisfied by **eligible** observations only
   — §3.2 — and the required number of **distinct operators** is met;
10. the **receipt**, if present, names that policy and those observations.

Nothing in this list requires `xonly.ai`, `bermlaunch.com`, or any Berm-operated
service to be reachable. **That is the test.**

**And it is executable.** `tools/verify-fold.mjs` runs all eleven steps against
the worked evidence set in `wire/example/` — eight signed artifacts, real BIP-340
Schnorr verification — and then proves the fold can FAIL by tampering with each
artifact in turn.

> R13-A described this fold and shipped nothing that ran it (**R13R-B07**). Its
> schemas established that a document had the right **shape** and nothing about
> whether the graph **held**: no signature verified, no reference resolved, no
> cross-artifact equality checked. Its policy and receipt carried no signing key
> and no signature at all, and `authorizationRef`, `operatorBindingHash` and
> `observationRefs` were sha256-shaped strings with **no stated byte projection**
> — two implementations could not have computed the same reference even in
> principle.

### 2.1 The falsifiable version

> Can a stranger validate the BermLaunch identity evidence with `xonly.ai`
> **permanently offline**, using public artifacts and their own implementation?

**Yes for steps 1–10, and that is the whole fold.** What they cannot do offline is
re-fetch the post — §5 is about exactly that.

---

### 2.2 The one projection — `sig` is its only omission

```text
unsigned          = the artifact with `sig` omitted, AND NOTHING ELSE
artifactId        = sha256( JCS(unsigned) )
signatureMessage  = sha256( JCS(unsigned) )        — the same bytes
policyHash        = artifactId(policy)             — COMPUTED, never carried
```

**Normative.** Exactly one member is omitted, from every artifact, with no
per-type exception. **Every other field of every artifact is therefore signed and
hash-identified**, and a signature covers precisely the bytes its artifact's id
covers.

**`ApplicationAcceptancePolicy` carries no `policyHash` member.** A policy that
hashed itself would need a self-referential projection; a reader computes
`artifactId(policy)` instead.

> **Two rounds of this rule were wrong, in opposite directions.**
>
> R13-A REISSUE R1 used **two** projections — `artifactId` stripped `sig` and
> `policyHash`, the signer stripped `sig` only — so a policy's signature covered
> different bytes from its own id.
>
> REISSUE R2 unified them by omitting **both** members everywhere. That closed the
> disagreement and opened a hole: `BindingAcceptanceReceipt.policyHash` is a
> **reference**, not a self-hash, and the universal exclusion took it out of the
> receipt's own signature. Executed against R2's shipped receipt, **replacing
> `policyHash` with any value left the signature still verifying** — an
> application's receipt could be re-pointed at a different policy with no
> cryptographic trace.
>
> **The self-reference is what had to go, not the coverage.** One counterexample
> in `tools/verify-relay-counterexamples.mjs` executes exactly that substitution
> and requires it to break both the signature and the receipt's artifact id.

### 2.3 V1 acceptance, in full

```text
required eligible validators independently return the same canonical
six-field bindingHash inside the method's five-minute law   ->  accepted
anything else                                               ->  not accepted
```

**Nothing else is an acceptance condition.** Not the capture hashes, not the
timestamps, not the operator count, not a badge.

## 3. Operator authorization is a chain, not a recursion

FD-BP-09: an operator first proves its **own** external-account binding by the
same public method, then authorizes a dedicated validator key naming the method
that key runs.

**Normative.** The operator's own binding is checked by the same fold, **once**.
It does **not** require its own witnesses to have witnesses. A reader who wants
more can follow the operator's observations outward, but the protocol demands one
level, because the alternative terminates nowhere.

**Multiple validator instances under one operator `npub` are ONE operator**, and
`distinctOperatorsRequired` in the policy is where that is counted.

### 3.1 The genesis exception — narrow, public, per-npub — F-3

**A self-signed operator claim proves control of the operator `npub` and nothing
about its X account.** R13-A REISSUE R1 verified that signature and treated the
chain as closed, which is implicit self-certification: any npub could assert any
handle and then authorize itself.

**Normative.**

- An operator's own external-account binding **MUST** satisfy the same witnessed
  evidence law as any other binding before its validator keys are eligible;
- **except** for an operator named in the accepting policy's `genesisOperators`
  list, which is exempted **for its own operator binding only**.

The exception exists because the **first** operator has nobody eligible to witness
it. It is written into the published policy, by `npub`, so a reader sees exactly
which operator was taken on trust and by which application. An empty or absent
list means no exception. It exempts nothing else: the claim must still verify
under the key its npub encodes, and every other rule still applies.

> **Once a second operator exists, the first is witnessable** and the exception
> can be removed from the policy. That is a policy edit, not a protocol change.

### 3.2 Eligibility — what it takes for an observation to COUNT — F-4

**Normative.** An observation counts toward a policy's matching rule only when
**all** of the following hold:

| | |
|---|---|
| 1 | its `bindingHash` recomputes from its own `binding` (§2 step 2a) |
| 2 | its signature verifies under its declared `validatorKey` |
| 3 | the `(validatorKey, authorizationRef)` pair is present in `policy.acceptedValidators` |
| 4 | that policy entry and the resolved authorization name the **same** operator |
| 5 | the authorization is for the **same** `methodId`, `methodHash` and `acquisitionHash` the observation names |
| 6 | `observedAt >= authorization.activatedAt` |
| 7 | the authorization is **not** revoked at or before `observedAt`, and **not** superseded |
| 8 | the observation has not already been counted — identity is its `artifactId` |

And: **duplicate `requiredKeys` MUST NOT inflate the threshold.** The required set
is a **set**; a policy listing one key twice is not satisfiable by one validator
observing twice.

> R13-A REISSUE R1 checked that the required keys appeared *somewhere* in the
> observation set and never consulted `acceptedValidators`, `activatedAt` or any
> revocation. A revoked key, an unlisted key, or an authorization issued for a
> different method would all have counted.
>
> `tools/verify-fold.mjs` carries a probe for each of these, and two of them use
> **properly signed adversarial fixtures** in `wire/example/probes/` — because
> mutating a signed observation changes its projection, so the signature rule
> would reject it before the lifetime rule was reached, and the probe would pass
> while proving nothing about revocation.

---

## 4. `captureHash` — audit evidence, and OUTSIDE acceptance

**Required in every `BindingObservation`. Not part of `bindingHash`. Not part of
the acceptance rule.**

### 4.1 The problem it is recorded for

Every member of the six-field binding is **public**. Anyone who reads the post
once — or reads validator A's published observation — can compute the identical
`bindingHash` **without ever fetching anything**.

So *"both validators independently fetched"* is not established by `bindingHash`
matching: a match is exactly what you get whether B fetched or copied. FD-BP-08
says copying is not witnessing; the record needs something else in it before a
reader can even ask the question.

`captureHash` is SHA-256 of the exact response bytes that validator received. Two
honest validators fetching the same post generally produce **different** capture
hashes, because X serializes member order and edge metadata differently per
response. The worked example in `wire/example/` shows exactly that: one
`bindingHash`, two capture hashes.

### 4.2 What it does NOT do — corrected from R13-A

**R13-A made capture-hash INEQUALITY a step of the fold.** That was wrong twice
over, and `R13R-B06` is right about both:

- it added **a second comparison law to the acceptance path**, when V1 acceptance
  is `bindingHash` equality and nothing else;
- the same document said honest validators merely **should** differ, so the fold
  required something the prose called a tendency. Two honest validators served
  byte-identical responses would have been **refused**.

**Normative.** An acceptance decision **MUST NOT** depend on `captureHash`
equality or inequality. A reader **MAY** compare capture hashes and draw
conclusions — identical hashes across validators are worth attention — and that
is a reader's judgement, never an admission rule.

### 4.3 And it does not prove a fetch happened

A determined copier can perturb bytes to manufacture a different `captureHash`.
What the field changes is the **cost and shape** of dishonesty: a validator that
re-signs a peer's output is visible immediately, and a deliberate one must
fabricate a response body and sign a statement about it — a lie a reader can point
at afterwards.

**Neither hash makes a same-operator pair independent** (§7).

## 5. What late verification means now — the honest version

### 5.1 The change

Under `berm.handle_verifier/7`, a stranger arriving a day later could **fetch the
post themselves and re-derive the binding**. Under FD-BP-05 they usually cannot:
if the post was edited inside X's edit window, a later fetch yields different
text, a different `textHash`, and a different `bindingHash`.

**So late verification is verifying signed observations, not repeating the link
check.** A stranger checks that authorized keys, under a named method, published
identical bindings — and trusts the signatures rather than their own eyes.

That is a real shift in what is being trusted, and it is written here because a
reader deserves to find it stated rather than discover it.

### 5.2 What still holds without any trust

- `postCreatedAt` is **recomputable from `postId`** by anyone — MethodSpec §7.1.
  The post's age needs no validator.
- `bindingHash` is **recomputable from the binding** by anyone.
- The **method** is public, so a stranger can run it over any capture they obtain
  themselves and compare.
- The `(namespace, accountId) → npub` lock, once recorded, is **permanent** and
  does not depend on re-derivation.

### 5.3 The one-hour badge — narrowly, what it is

FD-BP-11 keeps `OBSERVED_UNCHANGED_AFTER_ONE_HOUR` **outside core validity**, and
this pack respects that.

**What it reports, exactly:** one named validator re-fetched at a stated later
time and derived the same `bindingHash` it derived inside the window.

**What that means for a stranger, exactly:** if the post is *still* unchanged when
**they** fetch it, they can re-derive `textHash` and `bindingHash` themselves. The
badge does not confer that ability — it is one validator's report about one
earlier moment, and the post may have changed since.

> **R13-A said the badge "restores stranger re-derivability" (R13R-M02).** It does
> not. A stranger's ability to re-derive depends on the post's state **when they
> look**, which no earlier observation can establish. The badge is evidence that
> the post survived its edit window once, and it raises the probability that a
> later fetch will still match. That is a real thing and a smaller one.

**Normative, and narrow.** The badge **MUST NOT** create, revoke, replace or
rebind identity; **MUST NOT** gate acceptance or appear in any acceptance rule;
**MUST NOT** appear in a binding; and **MUST NOT** add a vector to the
founder-bound corpus. It is an optional later observation, published as an
ordinary `BindingObservation` under the same method, and its only protocol effect
is none.

---

## 6. The repository is evidence, not an issuer — FD-BP-10

The artifacts form an **append-only public evidence graph**. It may be mirrored
by Nostr relays, Git, static archives, content-addressed storage or indexers, and
**no mirror is authoritative over another**.

**Normative.**

- **No Berm-maintained list is universal identity authority.** Each application
  publishes its own accepted methods, operators, keys and matching rule.
- Protocol evidence and an application's accepted state are **distinct**, and a
  receipt says so in a `const` string that cannot be dropped while the artifact
  still validates.
- Rotation and supersession are **append-only**: an authorization is never
  deleted, so an observation signed while it was live stays checkable forever.
- **No operator owns a public method because it runs one** (FD-BP-01). Operators
  may be paid for fetching, computation, signature, indexing, storage, anchoring
  or availability — for the **service**, never for the method.

---

## 7. The current launch, disclosed exactly

```text
2 matching validator instances        xonly.ai validator A · bermlaunch.com validator B
1 controlling operator                us
```

**Normative.** Published results **MUST** describe this as **same-operator
witnessed evidence** and a mechanism demonstration. They **MUST NOT** describe it
as independent-operator corroboration, organizational independence, or
infrastructure independence.

What two same-operator deployments **do** demonstrate: the wire format works, two
deployments of the method agree — which catches build drift, configuration
divergence and clock skew — and the accountability chain is satisfiable in
practice.

What they demonstrate about collusion resistance or Sybil cost: **nothing**.

**One outside operator changes the claim**, and only that. Not several — one,
because it takes the operator count from one to two. Verified founding supporters
are the natural pool: they already hold the binding §3 requires.
