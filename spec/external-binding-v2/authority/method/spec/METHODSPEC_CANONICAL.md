# `berm.external_account_binding.x/2` — canonical method specification

**This document is the method.** Its SHA-256 is `methodHash`, and `methodHash` is
a member of every binding this method produces. Change one byte of this file and
every binding derived under it names a different method.

**Standing: CANDIDATE.** Not approved, not canonical, not frozen. No deployment
is authorized.

**R4 — deterministic public language.** This reissue exists to remove every case
in which two honest implementations reading the same declared public bytes could
derive different protocol results. Four changes carry that intent, and each was
produced by executing both readings rather than by reading the text:

| # | Change | Origin |
|---|---|---|
| 1 | every grammar is a **full-string** match, with host anchor behaviour excluded — §3.1 | R4C-01 |
| 2 | `accountId` carries the **uint64** bound `postId` always carried — §3.1 | R13-A R3 boundary sweep |
| 3 | `observedAt` decodes to **binary64 first**, integer-shaped literals included — §2.3 | R4C-03, R4C-07 |
| 4 | the account-key proof is **one complete line**, not a delimited substring — §4.4 | founder composer decision, R4C-08 |

---

## 0. What this method is, and what it replaced

### 0.1 Identity, and the standing of `/7`

| Identity | Standing | Why |
|---|---|---|
| **`berm.handle_verifier/5`** | **FROZEN historical authority.** Its anchors are preserved and must remain resolvable. | superseded by `/6` when two approved decisions altered an observable outcome |
| **`berm.handle_verifier/6`** | **An unapproved candidate.** Never approved, never frozen, and **no observation was ever made under it.** | the hashed object's scope changed and the identity moved to `/7` |
| **`berm.handle_verifier/7`** | **An unapproved candidate.** Never approved, never frozen. Its last bytes are Opus R12, SHA-256 `1ba5c54bd5a0eec8b235a8ff92193e26b18fb5df8db0f8ae0e9d38bfc33bc5af`. | **superseded by founder direction**, not by approval — FD-BP-04 and FD-BP-05 changed the admitted success law |
| **`berm.external_account_binding.x/2`** | **THE CURRENT CANDIDATE.** Also unapproved. | — |

> **`/7` is not being retired because it was wrong about the world.** Its
> derivation core — authoritative fields from the read, fail-closed capture,
> exact-byte hashing, the six-field projection — is carried forward here almost
> unchanged. What ended is its **temporal law** and its **success type**.

### 0.2 Why a new name and not `/8`

The work order permitted either. This is a decision with reasons, recorded so a
later round does not relitigate it:

1. **The admitted success law changed.** `/7` returned a `Normalized` record
   carrying `finality`, `finalityReason` and a cluster classification. This
   method returns exactly six fields or a failure. An implementation written
   against `/7` would compile against a `/8` and be **wrong in a way the type
   system would not catch**.
2. **`npub` is the sovereign root, and X is the first external-account method,
   not the container** (FD-BP-02). `handle_verifier` names an X concept.
   `external_account_binding.x` names the position X occupies in a family that
   will hold Reddit, Telegram, Farcaster, GitHub and domains.
3. **FD-BP-03's non-rebinding law is stated over `(namespace, accountId)`.** The
   namespace has to live somewhere, and the method identity is where a reader
   can see it without a lookup.

### 0.3 What this method does NOT do

It does not decide **who else looks**, **how many look**, whether an application
**counts** a binding, whether a post was later **edited**, or whether any
validator is **trustworthy**. Each of those is somewhere else in this pack, and
§13 says exactly where.

---

## 1. The one public form

```text
verifyXBinding(capture, expectedNpub, observedAt) -> VerifiedXBinding | Failure
```

**Normative.**

- A conforming implementation **MUST** expose exactly this one public semantic
  entry point for the method. Internal helpers are permitted and unconstrained.
- There is **no profile, mode or variant argument**, and an implementation
  **MUST NOT** add one.

> **This is the correction that matters most.** `/7` took a `profile` argument,
> and the second Codex stop followed directly: vectors `BHV-072`, `BHV-073` and
> `BHV-074` expected pair-comparison metadata the declared public function could
> not return, because those vectors were exercising a **test runner** that the
> spec had allowed to look like part of the method. A public method with a mode
> selector invites its own harness onto its published surface.

---

## 2. Inputs

### 2.1 `capture`

**Exactly three members, and the key set is closed.** A capture carrying more,
fewer, or differently typed members is `capture_malformed`.

> **Normative, and stated as a rule rather than a description.** An
> implementation **MUST** compare the capture's key set to exactly
> `{status, redirects, body}`. R13-A's reference checked that the three were
> present and correctly typed and never checked for a fourth, so a capture
> carrying `extra: "undeclared"` produced a positive binding and this sentence
> was decorative (**R13R-B03**). Unspecified data must not cross the boundary the
> method exists to police.

| Member | Type | Meaning |
|---|---|---|
| `status` | safe integer | the HTTP status of the response |
| `redirects` | safe integer ≥ 0 | how many redirects the transport followed |
| `body` | byte sequence | the **exact** response bytes, undecoded |

`body` is bytes, not a string. `body_not_utf8` cannot be expressed in a string,
and `textHash` is over exact bytes.

### 2.2 `expectedNpub` — validated, not shape-tested

The subject key the claim asserts, as Bech32 text.

**Normative.** An implementation **MUST** perform a full Bech32 decode. All five
of the following are required, and any one failing is `bad_expected_npub`:

| | Rule |
|---|---|
| 1 | the string is **lowercase**; a mixed- or upper-case encoding is **refused, not folded** |
| 2 | the human-readable part is exactly `npub`, followed by the separator `1` |
| 3 | every data character is in the Bech32 charset `qpzry9x8gf2tvdw0s3jn54khce6mua7l` |
| 4 | the six-character **checksum verifies** — the polymod over the hrp expansion and data equals exactly `1` |
| 5 | the payload converts 5-to-8 bits with **at most 4 leftover bits and zero leftover value**, yielding **exactly 32 bytes** |
| 6 | the encoding is **original Bech32**, whose checksum constant is `1`, and **not Bech32m**, whose constant is `0x2bc830a3` |

> **R13-A admitted an npub by regular expression alone** — charset and length —
> and its own canonical positive fixture was **not a key**: polymod `0x3cfa17cd`
> where a valid checksum requires `0x00000001`, and 4 leftover bits under the
> conversion (**R13R-B01**). Every positive vector in that corpus asserted a
> binding to something that cannot exist.
>
> **The whole method is a statement about one public key.** A method that cannot
> tell whether the string it was handed *is* a key has no subject.

**On rule 1.** BIP-173 permits an uppercase encoding of the same key. This method
does not: a key that hashes differently by case is a second spelling of one
identity, and the `textHash` of a post containing it would differ between
validators who normalized differently.

### 2.3 `observedAt`

Milliseconds since the Unix epoch, supplied **by the caller**, as a **number**.
An implementation **MUST NOT** read a clock, and **MUST NOT** coerce a value of
any other type.

#### 2.3.1 binary64 first — and that includes integer-shaped literals

**Normative.** Where `observedAt` arrives as a JSON number, it **MUST** first be
decoded to an IEEE-754 **binary64** value under RFC 8785's ECMAScript numeric
model. Every subsequent test is a test **on that decoded value**, never on the
lexical form:

```text
finite
mathematical integer
0 <= value <= 9007199254740991
not negative zero
```

**The binary64 decode applies to every JSON number literal, integer-shaped
literals included.** An implementation **MUST NOT** use a parser path that yields
a native integer type for `observedAt`.

> **This sentence exists because a specification that omitted it shipped a vector
> its own rule could not satisfy** (**R4C-07**). The five tests above were already
> correct; the divergence was one step earlier. `JSON.parse('{"observedAt":-0}')`
> in ECMAScript yields `-0` and the negative-zero test fires. Python's
> `json.loads` decodes the same literal to the **integer** `0` — the sign dies at
> decode — so `not negative zero` can never fire and an implementation obeying
> every other sentence **admits** what ECMAScript refuses. Acceptance against
> refusal, on identical bytes.
>
> The portable spelling in Python is `json.loads(src, parse_int=float)`, which
> yields `-0.0` and restores the test. Any language whose default parser produces
> an integer type needs the equivalent.

**Decimal lexical pretesting and arbitrary-precision admission before the
binary64 decode are forbidden.** `1`, `1.0` and `1e0` denote one admitted value.
A literal such as `1741830275949.0000000001` decodes to an admitted integer under
binary64 and **MUST** be admitted; an exact-decimal decode would refuse it, and
that is the divergence this clause closes (**R4C-03**).

> **No coercion, anywhere on the path.** R13-A's vectors declared `observedAt` as
> a decimal string and its runner called `Number(...)` before invoking the method
> (**R13R-B02**). Executed literally, the canonical positive returned
> `bad_observed_at`; executed through the runner it returned a binding. The corpus
> and the method disagreed about every vector and a green transcript concealed it.
> A conformance runner that adapts its inputs is testing the runner.

> **`observedAt` is a CLAIM, and §11 says what it does and does not establish.**
> A method that read its own clock would be non-deterministic, and determinism is
> the whole reason two implementations can be compared at all.

---

## 3. The refusal order is declared and total

The first violated rule below is the one reported. Two conforming
implementations **MUST** agree on the **code**, not merely on the rejection —
otherwise one input produces two different user-facing explanations and neither
operator can debug the other's.

| # | Rule | Code |
|---|---|---|
| 1 | `expectedNpub` matches §2.2 | `bad_expected_npub` |
| 2 | `observedAt` is a safe integer ≥ 0, and not negative zero | `bad_observed_at` |
| 3 | `capture` has exactly the three members of §2.1, correctly typed | `capture_malformed` |
| 4 | `capture.redirects` is exactly `0` | `redirect_present` |
| 5 | `capture.status` is exactly `200` | `status_not_success` |
| 6 | `capture.body` is at most 1 048 576 bytes | `response_too_large` |
| 7 | `capture.body` decodes as strict UTF-8 | `body_not_utf8` |
| 8 | the body is one complete JSON object with no trailing content | `json_parse_failed` |
| 9 | no member name repeats at any depth, compared **after** unescaping | `duplicate_member` |
| 9a | every decoded string is a valid **Unicode scalar sequence** — §4.3 | `lone_surrogate` |
| 9b | no member is named `__proto__`, at any depth — §4.5 | `prototype_member` |
| 10 | no truncation marker is present (§4.2) | `text_incomplete` |
| 11 | `text` is present and is a string | `no_text` |
| 12 | `user.id_str` is present | `no_account_id` |
| 13 | `user.id_str` matches the account-id grammar **and is inside uint64** — §3.1 | `bad_account_id` |
| 14 | `user.screen_name` is present | `no_handle` |
| 15 | `user.screen_name` matches the handle grammar | `bad_handle` |
| 16 | `id_str` is present | `no_post_id` |
| 17 | `id_str` matches the post-id grammar and is inside uint64 — §3.1 | `bad_post_id` |
| 18 | if `user_id_str` is present it equals `user.id_str` | `author_account_mismatch` |
| 19 | some **line** of `text` equals the expected handle-bound proof line — §4.4 | `npub_absent` / `npub_undelimited` |
| 20 | `text` carries exactly **one** canonical handle-bound proof line — §4.4 | `npub_multiple` |
| 21 | the post id is at or above the first snowflake id | `no_creation_time` |
| 22 | `observedAt − postCreatedAt ≥ 0` | `observation_predates_post` |
| 23 | `observedAt − postCreatedAt < 300000` | `observation_outside_window` |

**The list of codes is CLOSED.** An implementation returning a code outside §12
is non-conforming.

> **Rules 1 and 2 come first on purpose.** A caller who passed a malformed key
> should be told that, not told the response was oversized. The cheapest check
> that is also the most likely caller error belongs at the top.

### 3.1 Every grammar is a FULL-STRING match, and every grammar is written here

**Normative.** A grammar in this specification is satisfied only when it matches
the **entire** decoded scalar sequence: matching begins at the first decoded
character, ends immediately after the last, and leaves no character unconsumed.

**An implementation MUST NOT let a host's anchor semantics decide admission.** In
particular, `$` in Python, Ruby and PCRE's default mode matches at the end of the
string **or immediately before a trailing line feed**; ECMAScript's `$` without
`m` does not. Portable spellings:

| Language | Required equivalent operation |
|---|---|
| ECMAScript | `/^…$/.test(s)` — `$` has no trailing-newline exemption |
| Python | `re.fullmatch(…, s)` — **not** `re.match` with `$` |
| Ruby | `/\A…\z/` — **not** `\Z`, which exempts a trailing newline |
| Go | `regexp.MustCompile("^…$").MatchString(s)` with no `(?m)` |
| Java | `Pattern.matches(…, s)` |

> **Executed, not supposed** (**R4C-01**). `user.id_str` carrying the JSON string
> `"44196397\n"` — legal JSON — matched `^[1-9][0-9]{0,19}$` in Python and failed
> it in ECMAScript. One implementation returns a positive binding with an
> `accountId` ending in a line feed; the other returns `bad_account_id`. The two
> derive no matching `bindingHash`, so an honest subject is bound in one
> repository and refused in another.

**The three response grammars, stated here because R13-A R3 stated none of
them.** Two independently written implementations reconstructed the account-id
grammar from context and diverged at the one point no vector pinned.

```text
CanonicalPositiveUint64Decimal   FULLMATCH [1-9][0-9]{0,19}
                                 AND 1 <= value <= 18446744073709551615

accountId   user.id_str        CanonicalPositiveUint64Decimal   bad_account_id
postId      id_str             CanonicalPositiveUint64Decimal   bad_post_id
handle      user.screen_name   FULLMATCH [A-Za-z0-9_]{1,15}     bad_handle
```

**`accountId` and `postId` share one scalar and differ only in the code they
report.** The grammar admits no leading zero, no sign, no separator, no
whitespace and no empty string; the numeric bound is checked in addition to the
lexical form, because `99999999999999999999` is twenty digits of correct shape
and is not a uint64.

> **The uint64 bound on `accountId` is new in R4, and it is a real change.** R3
> rule 17 named the bound for `postId` and rule 13 did not name it for
> `accountId`. The reference implementation imposed it anyway; an independently
> written implementation did not, and the boundary sweep found exactly that
> disagreement on `18446744073709551616`. **On R3's text the other implementation
> was right and the reference was wrong.** R4 resolves it in the direction the
> reference already behaved, because an account id outside uint64 cannot be an X
> account id, and both implementations now have a rule to agree on rather than a
> gap to guess at.

**The protocol identifier grammar**, used wherever a `methodId`, acquisition id
or generic-shape id appears in `wire/`:

```text
berm\.[a-z](?:[a-z0-9_-]*[a-z0-9])?(?:\.[a-z](?:[a-z0-9_-]*[a-z0-9])?)*/[1-9][0-9]*
```

It admits `berm.acquisition.x-direct-status/1`, and **no compatibility exception
for hyphenated identifiers survives R4.** `tools/verify-identifier-inventory.mjs`
checks every identifier this pack declares against this exact predicate, and the
build fails if one does not match.

---

## 4. The authoritative fields all come from the read

### 4.1 Nothing is taken from the caller

**Normative.** `accountId`, `handle` and `postId` **MUST** be read from the
fetched response. An implementation **MUST NOT** accept any of them from caller
input, from the pasted URL, or from a form field, **even as a fallback when the
response omits them.** An absent authoritative field is a failure (§3, rules
12–17), never an invitation to use a supplied one.

> A user-entered account id is a claim about identity submitted by the party
> whose identity is in question.

### 4.2 Truncation is refused, never reconstructed

A response is **truncated** when any of these is present:

```text
truncated: true      note_tweet      extended_tweet
```

The list is **closed**. Such a response yields `text_incomplete`.

> **Why refuse rather than reassemble.** Two implementations rebuilding "the full
> text" from different side objects hash different bytes while both believe they
> hold the text — and `textHash` is the field the entire comparison rests on.
> There is no partial credit available here: either the served `text` is the post
> or the capture is unusable.

### 4.3 Unicode scalar law — no replacement decoding, ever

**Normative.** Every string decoded from the response **MUST** be a valid Unicode
scalar sequence. A `\uXXXX` escape naming a **high surrogate** **MUST** be
immediately followed by an escape naming a **low surrogate**, and a low surrogate
**MUST NOT** appear alone. An unpaired surrogate is `lone_surrogate`.

Correctly **paired** surrogate escapes are admitted and hash exactly — a proof
post containing an emoji binds normally.

> **R13-A returned a positive binding for an escaped lone high surrogate**, and
> its `textHash` was computed over **U+FFFD replacement characters**, because the
> UTF-8 encoder substitutes silently (**R13R-B05**). §6.1 forbade replacement
> decoding in so many words while the reference implementation performed it.
>
> Two implementations would also disagree here: another runtime might refuse,
> throw, or substitute differently — and `textHash` is the field the entire
> comparison rests on.

### 4.4 The account-key proof is ONE COMPLETE LINE

This section replaces R13-A R3's free-text delimiter extraction. The identity
proof is no longer a subject-key substring with a boundary rule around it; the
account handle and subject key form one complete, handle-bound line.

> **Why the change is a simplification and not a preference.** R3 searched prose
> for a delimited substring, which required a delimiter law, which required
> importing one from an older authority — and that authority carried a
> multiplicity rule contradicting R3's own (**R4C-06**). A line has a start and an
> end already. Nothing needs importing, no set-versus-occurrence question can be
> asked, and one founder decision disappeared instead of being made.

#### 4.4.1 Line production — U+000A and nothing else

**Normative.** Lines are produced by splitting the decoded Unicode scalar
sequence **only** at U+000A LINE FEED.

1. U+000A is the **sole** separator.
2. Empty fields are **preserved**, including a trailing empty field.
3. **Every scalar other than U+000A is an ordinary character** and never
   terminates a line. This rule is exhaustive; U+000B, U+000C, U+001C, U+001D,
   U+001E, U+0085, U+2028 and U+2029 are **illustrations of it, not a competing
   list**.
4. **U+000D is not removed**, including immediately before U+000A.
5. A generic line-splitting primitive is **forbidden** unless proven exactly
   equivalent to this law.

| Language | Required equivalent operation | Forbidden default |
|---|---|---|
| ECMAScript | `text.split("\n")` | — (no built-in line splitter exists) |
| Python | `text.split("\n")` | `str.splitlines()` |
| Go | `strings.Split(text, "\n")` | `bufio.Scanner` with `ScanLines` |
| Java | `text.split("\n", -1)` | `String.lines()`, `BufferedReader.readLine()` |
| Ruby | `text.split("\n", -1)` | `#lines` / `#each_line` with `chomp` |

The `-1` in Java and Ruby is **required**: without it the trailing empty field is
dropped, violating item 2.

> **Executed in four languages** (**R4C-08**). A post whose handle-bound proof
> line is terminated by CRLF retains a trailing U+000D under the law above —
> refused — while `str.splitlines()`, `String.lines()`, `bufio.Scanner`
> and Ruby's `#lines` with `chomp` — **accepted**. Python's splitter widens
> further, also terminating on U+2028, U+0085, U+000C and U+000B. Acceptance
> against refusal, on identical bytes, in every non-JavaScript language tested.
>
> **ECMAScript is the only language in that table that cannot reach the wrong
> answer**, because it has no built-in line splitter to reach for. Both
> implementations that agreed across 8,000 differential cases and 1,416 positives
> under R13-A R3 were JavaScript, so **none of that evidence bears on this rule**.
> `method/VECTORS/` therefore pins the whole matrix (§4.4.4), and
> `IMPLEMENTATION_TEST_PLAN.md` records why a non-JavaScript conformance path is
> required before this method is pinned rather than merely desirable.

#### 4.4.2 The canonical handle-bound proof line

A **canonical handle-bound proof line** is a complete line whose **entire**
scalar sequence matches this exact ASCII grammar:

```text
^Berm Protocol: @[a-z0-9_]{1,15} permanently binds to npub1[02-9ac-hj-np-z]{58} #bermprotocol$
```

For the authoritative `user.screen_name`, `asciiLower` maps `A`–`Z` to `a`–`z`
and nothing else. The verifier constructs:

```text
expectedLine = "Berm Protocol: @" + asciiLower(user.screen_name)
             + " permanently binds to " + expectedNpub + " #bermprotocol"
```

`expectedNpub` remains subject to the full canonical admission law in §2.2.

**The post MUST carry exactly one canonical handle-bound proof line, and it MUST
equal `expectedLine`.**

`proofLines` is an **occurrence-preserving ordered list of lines**, never a set.
Two lines matching the grammar are **two** proof lines, whichever account or key
each line names.

#### 4.4.3 The exact refusal order

```text
lines      := split decoded text at U+000A only, preserving empty fields
expectedLine := the exact handle-bound line constructed from asciiLower(user.screen_name)
                and expectedNpub
proofLines := ordered list of every line matching the handle-bound grammar

if no line equals expectedLine:
    if decoded text contains expectedLine as an exact substring:
        return npub_undelimited
    else:
        return npub_absent

if proofLines contains more than one proof line:
    return npub_multiple

otherwise:
    the sole proof line equals expectedLine
    continue
```

**Absence precedence runs first, and that is normative, not incidental.**

| Text | Result |
|---|---|
| one exact `expectedLine` | **continue** |
| the same exact `expectedLine` twice | `npub_multiple` |
| one exact `expectedLine` plus a different grammar-matching proof line | `npub_multiple` |
| `expectedLine` only inside prose, never a whole line | `npub_undelimited` |
| `expectedLine` nowhere in the text, even if `expectedNpub` appears in another account's line | `npub_absent` |
| one exact `expectedLine` **plus** the same line embedded in prose elsewhere | **continue** — only a full line is identity-bearing |
| `expectedLine` absent while two **other** grammar-matching proof lines exist | `npub_absent` — absence is decided before multiplicity |

#### 4.4.4 Two consequences worth stating plainly

**Line structure is now load-bearing for identity.** R3's substring search was
robust to a platform that normalized whitespace; this rule is not. That is the
price of the determinism gained, it is paid knowingly, and it is why the
BermLaunch composer profile in `COMPOSER_PRODUCER_LAW.md` §7 cannot be activated
until one real capture confirms the platform preserves blank lines and line
endings exactly.

**No delimiter law is imported.** The R5.1 DR-22 delimiter and set-multiplicity
language is **not** part of this method. It remains historical evidence, in a
pack this one does not ship, and it is deliberately named without a section
number: a reference a reader cannot resolve from the bytes in front of them is
not a reference. No set-versus-occurrence founder decision is outstanding.

---

### 4.5 Every field is an OWN property — no inherited data

**Normative.** A conforming implementation **MUST NOT** accept an inherited
property as a response field, and **MUST** refuse a member named `__proto__` at
any depth with `prototype_member`.

Two independent requirements, and both are required:

1. **parsed containers inherit nothing** — an implementation builds them with a
   null prototype, or an equivalent construct in its language;
2. **every field read is an own-property read** — `Object.hasOwn` and not `in`,
   or the language's equivalent.

> **R13-A REISSUE R1 returned a POSITIVE BINDING for a response with no own
> `text` member at all** (**F-1**). The body carried
> `"__proto__": {"text": "npub1…"}`, which installed an inherited `text` on the
> parsed object, and the method's `'text' in doc` test consults the prototype
> chain. The attacker supplied the text that was hashed.
>
> Two defences because one is a single edit away from being undone, and they fail
> independently. This is a JavaScript-shaped hazard with equivalents in other
> languages — a Python `__class__` key, a Ruby method-name collision — so it is
> stated as a rule about **own properties**, not about one language's syntax.

## 5. The result

### 5.1 The positive result is exactly six fields

```json
{
  "npub":       "npub1…",
  "accountId":  "44196397",
  "handle":     "alice",
  "postId":     "1900000000000000000",
  "textHash":   "sha256:…",
  "methodHash": "sha256:…"
}
```

**Normative.**

- A positive result **MUST** carry exactly these six members and **no others**.
- It **MUST NOT** carry `finality`, `finalityReason`, `cluster`, `editableUntil`,
  `countsTowardEnrollment`, `quorum` or `peerSelection` (FD-BP-04).
- It **MUST NOT** carry a slot, a cohort, a launchpad field or **any Berm-issued
  identifier**. **The identity is the `npub`.**
- An API wrapper may transport the binding inside an envelope. The **canonical
  projection** is the six fields, and it **MUST NOT** silently gain a seventh.

### 5.2 The failure result

```json
{"ok": false, "code": "npub_absent"}
```

Every failure has exactly one protocol consequence: **NOT ACCEPTED**. Codes exist
for diagnosis and honest UX, not to create degrees of acceptance.

### 5.3 Discriminating the two — normative, because it is a footgun

A positive result **has no `ok` member**, because §5.1 fixes it at six fields.

```text
result.ok === false   ->  failure; result.code says why
otherwise             ->  the result IS the binding
```

> A caller writing `if (result.ok)` reads `undefined` on success and takes the
> failure branch. It is stated normatively here rather than left to taste, so two
> implementations' callers fail the same way or not at all.

---

## 6. The two hashes

### 6.1 `textHash`

```text
textHash = "sha256:" + hex(SHA-256(exact UTF-8 bytes of the extracted text))
```

The **extracted text** is the value of `text` after JSON unescaping, encoded as
UTF-8.

**Normative — no trimming, no case folding, no whitespace folding, no Unicode
normalization, no replacement-character decoding, no reconstruction.** A leading
space is part of the post.

### 6.2 `bindingHash` — and the ordering trap

```text
bindingHash = "sha256:" + hex(SHA-256(JCS({npub, accountId, handle, postId, textHash, methodHash})))
```

JCS is RFC 8785. **JCS serializes member names in lexicographic order**, which is
**not** the order this document lists the fields in:

| | order |
|---|---|
| presentation, everywhere in this pack | `npub` `accountId` `handle` `postId` `textHash` `methodHash` |
| **JCS serialization** | `accountId` `handle` `methodHash` `npub` `postId` `textHash` |

**Normative.** An implementation **MUST** serialize in JCS order. An
implementation that hashed "in the order the specification lists the fields"
would produce a different `bindingHash` and would not be obviously wrong about
anything — which is exactly why it is written down twice.

`bindingHash` is **not** a member of the binding. It is a function of it.

### 6.3 `methodHash` is bound once, for the life of the process

**Normative.** An implementation **MUST** bind its `methodHash` **exactly once**,
before any verification, and **MUST NOT** permit it to change afterwards. A second
attempt to bind a different value **MUST** fail loudly.

> R13-A exposed a mutable module global. Two calls to its setter made the **same**
> capture, npub and timestamp produce two different bindings with two different
> `bindingHash` values (**R13R-B04**) — and `bindingHash` equality **is** the V1
> acceptance law. A validator whose method identity can change between calls can
> be made to agree with anything.
>
> Failing loudly is the point: silently keeping the first value, or silently
> taking the second, both leave a process running under an identity nobody chose.

### 6.4 What is deliberately outside `bindingHash`

The original pasted URL, the raw response formatting, the validator's timestamp,
its signature, its key, and its operator identity. **None of them.**

> FD-BP-07: the URL is acquisition input, not identity truth. Two validators
> reaching the same post by different admitted URLs must produce byte-identical
> bindings, or the comparison measures their intake rather than the post.

---

## 7. Time

### 7.1 The post's creation time comes from the post id

```text
postCreatedAt = (postId >> 22) + 1288834974657
```

**Normative.** An implementation **MUST** derive the creation time from the post
id and **MUST NOT** read a served `created_at`.

Two reasons, both about independent agreement:

- a reader holding only the six-field binding recomputes it, with **no second
  fetch and no trust in the validator**;
- a served timestamp is a second source for one fact, and a method with two
  sources has to rank them. This one has one source.

A post id below **29 700 859 247** predates the scheme and yields
`no_creation_time`. Computing a time for it anyway would be inventing one.

### 7.2 The five-minute window — FD-BP-05, half-open

```text
0 <= observedAt - postCreatedAt < 300000
```

**Normative.** The lower bound is **inclusive**; a delta of exactly `0` is
admitted. The upper bound is **exclusive**; a delta of exactly `300000` is
**outside** the window and yields `observation_outside_window`.

**This constant lives inside this hashed document, and that is the point.** A
five-minute bound sitting in a configuration file can be relaxed to an hour by an
operator still advertising the same `methodHash`. Changing it here changes
`methodHash`, so every binding derived under the changed rule names a different
method.

### 7.3 There is no second observation

**Normative.** This method defines **no** mandatory refetch, **no** post-edit
settled pass, **no** provisional or final state, and **no** cross-cluster
verdict. An implementation **MUST NOT** make a binding's validity depend on any
observation other than the one it is given.

> `/7` defined two observation clusters and a verdict between them, and the pair
> decided one bit: edited or not. FD-BP-05 moves that bit out of validity
> entirely. §11.3 records what is lost with it, because something is.

---

## 8. Acquisition is a different, separately hashed thing

The intake rule — which URLs may be turned into a fetch, and the transport's
refusal to follow redirects — is `berm.acquisition.x-direct-status/1`, specified
in `ACQUISITION_PROFILE.md` and hashed separately.

**Normative.**

- Given a capture, the URL decides **nothing** about the binding: every
  authoritative field comes from the response. So the intake rule is **not**
  inside `methodHash`, and changing it **MUST NOT** silently change the method
  identity.
- The acquisition profile is **not thereby optional**. It decides **which**
  capture is taken, which is why it is hashed at all, and an application's
  acceptance policy names both hashes.
- The composer and the verifier **MUST** use the **same** admission function. A
  verifier stricter than its composer produces users who did everything right and
  are refused.

---

## 9. The method is decidable alone

**Normative.** An implementation conforming to this `methodHash` **MUST** reach
the same result with **no knowledge of any other operator**, no peer count, no
operator set, and no network access beyond the single admitted fetch.

This method **MUST NOT** define, default or accept `K`, an operator set, a
corroborator-selection rule, a quorum, or a refutation court. Comparison across
validators is **application policy** and lives in
`ApplicationAcceptancePolicy` (`wire/`), never here.

---

## 10. Cardinality — FD-BP-03

```text
(namespace, accountId) -> at most one npub, PERMANENTLY
npub                   -> zero, one, or many external accounts
```

**Normative, for any application consuming this method.**

- An accepted external account **MUST NOT** later bind to a different `npub`.
- One `npub` **MAY** attach a replacement X account after a prior account is
  locked, and **MAY** attach accounts in other namespaces.
- A handle change does **not** create a new external account when `accountId` is
  unchanged. **This is why `accountId` and not `handle` carries the lock.**
- Multiple accounts **MUST NOT** multiply application identity or weight.

> `handle` is in the binding because it is what a human reads and what the post
> displayed at the moment of observation. It is **not** the key. A handle sold,
> renamed or recycled does not move a binding.

---

## 11. What a result establishes, and what it does not

### 11.1 Three different things, three different believers

| | Established by | Believable to |
|---|---|---|
| the fetch happened | the executing node, at its own fetch | that node |
| the published `observedAt` | a validator, in a signed record | **nobody, as objective time** |
| the binding itself | any reader who repeats the derivation over the same capture | anyone holding the capture |

### 11.2 `observedAt` is a claim, and the window is arithmetic over it

An honest `observedAt` and a backdated one are **indistinguishable** to this
method. It cannot be otherwise: the method reads no clock, by §2.3.

**So the five-minute window binds the honest path.** It is a defence against
stale and recycled posts, **not** against a validator willing to lie about when
it looked. What *is* checkable by any reader, from the binding alone, is the
post's own age — §7.1 makes `postCreatedAt` recomputable from `postId`.

> At launch both validator instances are operated by one party (FD-BP-09,
> `wire/EVIDENCE_FOLD.md` §4). The window therefore rests on that party's
> honesty until an outside operator joins. Stating it is not a weakness of the
> design; concealing it would be.

### 11.3 What the five-minute-only law costs — stated, not implied

Under `/7`, a stranger arriving a day later could **re-fetch the post and
re-derive the binding themselves**. Under this method they usually cannot: if the
post was edited inside X's edit window, a later fetch yields different text, a
different `textHash`, and a different `bindingHash`.

**Late verification therefore means verifying signed observations, not repeating
the link check.** That is a real change in what a stranger is trusting, and
`wire/EVIDENCE_FOLD.md` §5 is where it is worked through rather than left
implicit.

The optional one-hour badge (FD-BP-11) is what restores stranger
re-derivability, and it is described there as that rather than as social proof.

---

## 12. The closed failure code list

```text
capture_malformed          redirect_present           status_not_success
response_too_large         body_not_utf8              json_parse_failed
duplicate_member           lone_surrogate             prototype_member
no_text                    text_incomplete
no_account_id              bad_account_id             no_handle
bad_handle                 no_post_id                 bad_post_id
author_account_mismatch    bad_expected_npub          npub_absent
npub_multiple              npub_undelimited           bad_observed_at
no_creation_time           observation_predates_post  observation_outside_window
```

Twenty-six codes. Each is reachable, and `method/VECTORS/` carries at least one
normative vector for every one of them; the build fails if a code is uncovered.

---

## 13. Where everything else went

| Concern | Where it lives now |
|---|---|
| which URLs may be fetched | `ACQUISITION_PROFILE.md` — separately hashed (§8) |
| how a composer builds and freezes a post | `method/spec/COMPOSER_PRODUCER_LAW.md` — separately hashed, producer-side, **not** an acceptance input |
| the BermLaunch post template and URL adapter | the same document, §6–§7 — application profile, **not** Berm identity law |
| who else observes, and how many | nowhere in the protocol; an application's `ApplicationAcceptancePolicy` names its own required set |
| comparing two validators' results | `wire/EVIDENCE_FOLD.md` — application policy over `bindingHash` |
| whether a post was later edited | the optional one-hour badge, FD-BP-11, outside validity |
| whether a binding counts for a slot | the application, always; v2.2 §7 |
| operator → validator-key authorization | `wire/schemas/ValidatorAuthorization.schema.json` |
| fuzz, property, metamorphic, mutation tests | `IMPLEMENTATION_TEST_PLAN.md` — non-normative, and may number in the thousands without touching this hash |
| future namespaces (Reddit, Telegram, …) | `EXTERNAL_ACCOUNT_BINDING_GENERIC.md` |

---

## 14. Conformance

An implementation conforms to this `methodHash` when:

1. it exposes exactly the one public form of §1;
2. every vector in `method/VECTORS/` invokes **that** form and produces the
   expected result;
3. every positive result is exactly the six members of §5.1;
4. every non-positive result is exactly `{ok: false, code}` with a code from §12;
5. it derives `postCreatedAt` from the post id per §7.1;
6. it enforces the half-open window of §7.2;
7. it hashes exact text bytes per §6.1 and serializes `bindingHash` in JCS order
   per §6.2;
8. it reads no clock and consults no peer;
9. it matches every grammar as a **full string**, with no host anchor exemption
   — §3.1;
10. it splits lines at **U+000A only**, preserving empty fields and retaining
    U+000D — §4.4.1;
11. it decodes `observedAt` to **binary64 before** any numeric test, including
    for integer-shaped literals — §2.3.1.

**Items 9, 10 and 11 are the R4 additions, and all three are portability rules
rather than semantic ones.** Each names a place where a competent implementer
using their language's ordinary facility reaches a different answer than the
specification intends. An implementation can satisfy items 1–8 completely and
still fail to interoperate if it fails any of these three.

**Independent implementations may differ in source, runtime and artifact hashes.**
They agree on the method and on the canonical result, and that is the only
agreement this specification requires.
