# Composer producer law — `berm.composer_producer_law/1`

**Standing: CANDIDATE.** Not approved, not canonical, not frozen. No deployment
is authorized.

**This document is hashed separately from the method, and that separation is
deliberate.** Everything here is a **producer** obligation: what a piece of
software must do *before* a subject signs. None of it is an acceptance input,
none of it is identity evidence, and none of it can change a verifier's result.

> **Why it is not inside `METHODSPEC_CANONICAL.md`.** The method's hash is the
> method's identity. If BermLaunch's post wording lived inside that file, editing
> a sentence of marketing copy would change `methodHash`, and every binding ever
> derived would name a different method. Composer law changes on product
> timescales; method law must not. A reader who wants to know what a verifier
> does never has to read this document at all.

---

## 1. No composer is privileged

Berm Protocol does not require BermLaunch's composer, UI, domain or
infrastructure. **Any developer may implement a conforming composer.**

A conforming composer MUST satisfy §2 through §5. It MAY choose its own template,
surrounding copy, campaign wording, localization, URL and visual presentation.

**A public verifier does not need to know which composer was used, and has no way
to find out.** That is a property of the design, not a gap in it: the public
evidence proves the signed final text and the binding over it. It does not claim
to prove which software produced the text.

---

## 2. The one shared constraint

Every conforming composer MUST produce a post carrying **exactly one canonical
npub proof line equal to the subject's `expectedNpub`**, under
`METHODSPEC_CANONICAL.md` §4.4.

That is the entire shared surface. Everything else in this document is about how
a producer guarantees it has not signed something other than what it published.

---

## 3. Two frozen states

A conforming URL-bearing composer has exactly two frozen states.

```text
logicalComposition          frozen BEFORE publication
  the complete intended copy
  the exact canonical npub proof line
  the exact intended canonical URL, in ONE declared URL slot

expectedServedComposition   constructed AFTER the platform responds,
                            BEFORE the subject signs
  logicalComposition with AT MOST the one validated
  URL-token substitution of §4 applied
```

The composer MUST then obtain the final public capture, run the public method on
it, and require **exact Unicode scalar equality**:

```text
servedText == expectedServedComposition
```

**Any difference outside the one validated URL-token substitution aborts before
the subject signs `ExternalBindingClaim`.** Copy, npub, case, whitespace, line
break, URL characters — any of them.

No trimming, case folding, whitespace folding, Unicode normalization, replacement
encoding or fuzzy comparison is permitted at this gate.

**A composer with no URL has no substitution**, and compares the frozen
composition directly.

The binding always carries the method-derived hash of the actual served text:

```text
textHash = "sha256:" + hex(SHA-256(exact UTF-8 bytes of decoded platform-served text))
```

---

## 4. The universal URL-token substitution

**This section is universal law for every conforming composer.** It is not a
BermLaunch privilege.

> **It was one, briefly, and that was the defect** (**R4C-09**). An earlier draft
> stated the abort-on-any-difference rule universally and granted the URL-token
> procedure only inside the BermLaunch profile — while separately permitting any
> conforming composer to include its own URL. A third-party composer reading that
> text strictly aborts on every URL-bearing post, because platforms rewrite URLs;
> a composer reading the adapter sentence instead compares the served text against
> something built from the served text, and the gate never fires. Two honest
> composers, opposite behaviour. The procedure below is the one that was already
> correct; it has simply been moved to where it applies.

If a platform rewrites the intended canonical URL to a served URL token, **that
token replacement is the only permitted transport substitution.**

Every conforming composer profile MUST pin an **adapter** that declares:

1. the one declared URL slot in `logicalComposition`;
2. how the served token and its boundaries are identified at that slot;
3. the exact platform field and rule mapping that token to a URL;
4. the exact comparison of the mapped URL with the intended canonical URL;
5. the multiplicity, missing-field and mismatch failure behaviour.

The adapter MUST:

- bind the served token to the **declared slot**, not to any token anywhere;
- establish **without fuzzy matching** that the token denotes the exact intended
  canonical URL;
- construct `expectedServedComposition` by replacing **only** that slot;
- compare **every scalar** of `servedText` with `expectedServedComposition`;
- **abort** if it cannot establish the mapping or the exact equality.

**Network redirect resolution, mutable destination guessing and display-string
comparison do not satisfy this gate.**

### 4.1 What this gate is, and what it is not

**This is a producer integrity requirement. It is not identity evidence.**

The URL mapping is not a public-method acceptance input and creates no public
trust in the platform's URL entity. The public method binds only the actual final
served text.

> **Stated explicitly because the shape invites a mistake.** The served URL entity
> arrives inside the same capture as `text`, so a composer trusting it is taking a
> value from the artifact it is judging as evidence about that artifact — the
> defect class this project has hit repeatedly. Here it is tolerable, and the
> reason is worth writing down rather than assuming: the check is producer-side,
> the identity binding (`npub` ↔ `accountId`) does not depend on the URL, and
> campaign presentation is outside protocol truth by §5. The exposure is bounded
> to the composer's own UX guarantee — a subject could sign a post whose link was
> rewritten — and it never reaches a verifier's result.
>
> **No later reader should mistake this token check for an identity control.**

---

## 5. OpenGraph and presentation neutrality

The proof post MAY carry a campaign URL, a platform URL entity, an OpenGraph
card, an OpenGraph image, attached media, or campaign and supporter presentation
supplied by a linked application.

**The identity method MUST ignore** OpenGraph HTML, image bytes, preview cache
state, media bytes and mutable displayed counts.

Their presence, absence, equality, inequality or later mutation MUST NOT affect
method success, `bindingHash`, account cardinality, campaign position or offline
acceptance. Only URL **characters actually present in the served text**
participate in `textHash`.

A supporter count rendered into an image is **presentation metadata, not protocol
truth.** Whether it is a render-time snapshot or stable artwork is a product
decision and requires no protocol change.

---

## 6. BermLaunch V1 — application profile

**Everything in §6 and §7 is application implementation metadata, not Berm
identity law.** Another developer's conforming composer may use entirely
different prose and layout.

### 6.1 The exact logical template

```text
I support this campaign on BermLaunch.

{npub}

{campaignUrl}
```

- line separators are **U+000A only**;
- **no trailing U+000A** after `{campaignUrl}`;
- `{npub}` is the exact canonical lowercase subject npub, occupying its complete
  line;
- `{campaignUrl}` is the exact canonical HTTPS campaign URL, occupying its
  complete line;
- **no supporter count** in post text;
- **no other substitution and no user edit.**

The campaign URL supplies the OpenGraph preview, which is why campaign name and
artwork stay outside the identity text.

### 6.2 The BermLaunch X URL adapter

Instantiating §4 for X:

| Adapter element | Value |
|---|---|
| declared URL slot | the **final complete line** |
| served token | the exact token occupying that line |
| platform field | the capture's X URL entity for that token |
| entity `url` | MUST equal the served token exactly |
| entity `expanded_url` | MUST equal the intended canonical campaign URL exactly |
| `display_url`, `unwound_url` | present or not, **non-authoritative** for this gate |
| missing, duplicate, conflicting or non-string fields | **abort** |
| redirect or network lookup | **never performed** |

---

## 7. Activation standing — the composer is NOT activated

```text
BERMLAUNCH COMPOSER ACTIVATION:
  ACTIVATION_PENDING_ONE_REAL_X_COMPOSER_SMOKE
```

**The template in §6.1 is frozen in this candidate. The adapter in §6.2 is not
activated.**

A separately authorized smoke test against one real X post MUST confirm, before
activation:

1. **blank-line preservation** — that the empty lines between the three template
   lines survive being served;
2. **line-ending fidelity** — that no U+000D is introduced and no trailing
   U+000A is added or removed;
3. **URL-token placement** — that the token occupies the final complete line;
4. **the exact entity mapping** of §6.2.

> **Items 1 and 2 are the ones that matter, and neither has been tested.** The
> proof-line law of `METHODSPEC_CANONICAL.md` §4.4 makes line structure
> load-bearing for identity, so a platform that normalizes whitespace on serve
> would abort every BermLaunch post at the §3 gate. That is the safe failure —
> nothing is wrongly bound — but it is a failure, and it would be discovered at
> integration rather than now. **No live-platform evidence was fabricated during
> this authoring round, and none is claimed.**

**A failed or absent smoke blocks composer activation. It does not block the
composer-neutral protocol pin**, because nothing in §1 through §5 depends on how
one platform serves one template.

---

## 8. Producer failures are not method failures

The abort conditions in this document are **producer** outcomes. They do **not**
enter the closed public-method failure taxonomy of `METHODSPEC_CANONICAL.md`
§12, and an implementation MUST NOT return them from `verifyXBinding`.

A composer that aborts has produced no claim. A verifier never sees the
difference between a post that was never composed and one whose composer aborted.
