# The generic external-account binding — how the next namespace arrives

**Standing: CANDIDATE, and deliberately not implemented.** FD-BP-02 makes `npub`
the sovereign root and X the first external-account method. This document fixes
the **shape** the next namespace must fit, so that adding Reddit later is an
addition rather than a redesign — **without** widening X V1's implementation
scope by a single line.

---

## 1. The invariant shape

Every external-account binding, in any namespace, is:

```text
npub · accountId · handle · postId · textHash · methodHash
```

Six fields. The **names** stay; the **meanings** are namespace-local:

| field | X | what it means generally |
|---|---|---|
| `accountId` | `user.id_str` | the platform's **immutable** account identifier |
| `handle` | `screen_name` | the **mutable** display name at observation time |
| `postId` | tweet id | the identifier of the public artifact carrying the proof |
| `textHash` | SHA-256 of exact text bytes | the exact bytes of the proof content |

**Normative.** A namespace that cannot supply an immutable `accountId` distinct
from a mutable `handle` **MUST NOT** use this shape. The whole non-rebinding law
of FD-BP-03 rests on that distinction, and a platform where the only identifier
is renameable cannot carry it.

> Domains are the obvious case to think about early: a domain has no immutable id
> separate from its name, and a domain that changes hands changes hands
> completely. It needs a different binding shape, not a forced fit.

---

## 2. A namespace is a new METHOD, never a widened one

**Normative.**

- Each namespace gets its own method identity —
  `berm.external_account_binding.<namespace>/<n>` — with its own hashed
  specification and its own vector corpus.
- The `namespace` enum in `wire/schemas/common.defs.json` is **closed at `x`** in
  V1, and a new namespace is added by publishing a new method and **extending the
  enum in a new schema version**, never by editing the published one in place.
- The five-minute window is **X's** rule, derived from how X posts behave. Another
  platform's method **MUST** state its own temporal law and justify it; copying
  `300000` because it is familiar would be cargo cult.

---

## 3. The cardinality law is global, and it is the reason for all of this

```text
(namespace, accountId) -> at most one npub, PERMANENTLY
npub                   -> zero, one, or many external accounts
```

The tuple is `(namespace, accountId)`. The same numeric account id on two
platforms is two different external accounts, and nothing in the protocol needs
to compare them.

**One npub attaching a Reddit account tomorrow requires no change to X V1** — not
to its method, not to its hash, not to its vectors. That is the entire purpose of
writing this document now and implementing none of it.
