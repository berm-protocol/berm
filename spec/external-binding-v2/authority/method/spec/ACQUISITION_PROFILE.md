# `berm.acquisition.x-direct-status/1` — the intake and transport profile

**Separately identified and separately hashed.** Its SHA-256 is
`acquisitionHash`, and an application's acceptance policy names it alongside
`methodHash`.

**Standing: CANDIDATE.** Not approved, not frozen.

---

## 1. Why this is not inside the method hash

Given a capture, the URL decides **nothing** about the binding — every
authoritative field comes from the fetched response, and FD-BP-07 excludes the
pasted URL from the binding and from `bindingHash`.

So a change to the intake rule **MUST NOT** silently change the method identity.
A validator that widened its URL admission while advertising the same
`methodHash` would still derive the same binding from the same capture; what it
would have changed is **which post gets fetched**.

That is why this profile is hashed at all, and why it is hashed **separately**.

---

## 2. The canonical form

```text
https://x.com/{handle}/status/{postId}
```

Exact scheme, exact host, no userinfo, no explicitly written port, no query, no
fragment, exactly three path segments with the literal `status` in the middle.

The handle grammar is `^[A-Za-z0-9_]{1,15}$`; the post-id grammar is
`^[1-9][0-9]{0,19}$` with the value inside uint64 — **the same post-id domain
the method uses**, shared rather than restated.

> **The handle in the URL is not authoritative** (MethodSpec §4.1). It is present
> because X's canonical URL carries it. The verified handle comes from the
> response, and the two may differ if the account was renamed between the post
> and the fetch.

---

## 3. The refusal order is declared and total

| # | Rule | Refusal |
|---|---|---|
| 1 | is a string, non-empty, ≤ 2048 bytes, no leading or trailing space | `not_a_url` |
| 2 | parses as a URL | `not_a_url` |
| 3 | scheme is exactly `https` | `scheme_not_https` |
| 4 | host is exactly `x.com` | `host_not_x_com` |
| 5 | no userinfo | `userinfo_present` |
| 6 | **no explicitly written port, including `:443` and an empty `:`** | `explicit_port_present` |
| 7 | no query | `query_present` |
| 8 | no fragment | `fragment_present` |
| 9 | exactly three path segments, middle segment `status` | `path_shape_invalid` |
| 10 | handle matches the grammar | `handle_invalid` |
| 11 | post id matches the grammar and is inside uint64 | `post_id_invalid` |

Ten closed refusals in a declared total order. Two implementations must agree on
the **reason**, not merely the rejection.

### 3.1 The port rule is checked on the RAW authority

**Normative.** The explicit-port check **MUST** inspect the authority **before**
URL normalization.

> WHATWG `URL` **erases** a default `:443`, so a check on the parsed port never
> sees it and admits a URL the table above refuses. R10 shipped exactly that, and
> also admitted `https://x.com:/…` — an empty port. Both are refused here, and
> both have counterexample vectors.

### 3.2 The host is matched exactly, never as a suffix

An implementation testing *"ends with `x.com`"* passes the canonical case and
admits any attacker-controlled `*.x.com` it did not anticipate. `www.x.com`,
`mobile.x.com`, `twitter.com` and `t.co` are all refused.

---

## 4. Normalization is local, and makes no network request

**Normative.** A narrow intake layer **MAY** accept a wider set of pasted direct
X or Twitter status forms — a `twitter.com` host, a tracking query, a mobile
subdomain — and **locally** reconstruct one canonical `x.com` status locator by
extracting the post id and discarding the rest.

It **MUST NOT** make a network request while normalizing, and it **MUST NOT**
resolve a shortener or any mutable redirector. A URL whose destination is only
knowable by asking a third party is a URL the user cannot see the meaning of.

**What the verifier receives is the canonical form, always.** Normalization is a
convenience at the edge, not a second admission law.

---

## 5. The transport follows zero redirects

**Normative.** The client **MUST** be configured not to follow redirects, and any
3xx observed is a refusal. The method's own `redirect_present` (MethodSpec §3
rule 4) is the post-fetch backstop; this is the pre-fetch configuration. **They
are not substitutes**: the first constrains which fetch may be made, the second
catches a fetch that moved.

There is no `shouldFollow()` function here, because exposing one would imply a
case where the answer is yes.

---

## 6. Composer and verifier share this function — FD-ID-R12-03

**Normative.** The proof-post composer and the verifier **MUST** call the same
admission function, and they ship together as one work item.

> A verifier holding a stricter rule than its composer produces users who did
> everything right and are refused. A composer that emits a convenient but
> non-admitted link is a broken composer.
