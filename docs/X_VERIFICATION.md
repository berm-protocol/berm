# Proving an X account

Current method: **`berm.external_account_binding.x/2`**
(`sha256:a95319d8664b16ca355b3d82bc8c4d5bb6007c8aed65116a74447f79b0e5e193`).

## What the person does

1. Holds an npub (their keys stay with them).
2. Publishes a public X post containing exactly one canonical proof line:

   ```text
   Berm Protocol: @<handle in lower case> permanently binds to <npub> #bermprotocol
   ```

   Grammar (full line match):
   `^Berm Protocol: @[a-z0-9_]{1,15} permanently binds to npub1[02-9ac-hj-np-z]{58} #bermprotocol$`
3. Signs an `ExternalBindingClaim` with their npub — "this binding is mine".

## What a validator does

1. Admits only the canonical locator `https://x.com/{handle}/status/{postId}`
   under the acquisition profile `berm.acquisition.x-direct-status/1` (closed
   refusal order, zero redirects, local normalization only).
2. **Independently acquires the publicly served X publication.** No user OAuth,
   no private cookies, no developer credentials, and no privileged X credentials
   held by BermLaunch are involved.
3. Runs the public method over what it received. Every authoritative field comes
   from that read; the pasted URL and the caller decide nothing.
4. Signs a `BindingObservation` stating what its own fetch derived.

## The five-minute law

```text
0 <= observedAt - postCreatedAt < 300000 ms
```

- `postCreatedAt` is derived from the post ID itself, so anyone can recompute it.
- The lower bound is inclusive; the upper bound is **exclusive** — a delta of
  exactly 300000 ms is outside the window.
- The constant lives inside the hashed method document. Changing it changes
  `methodHash`.
- There is no mandatory second observation and no one-hour finality requirement.

**Honest limit:** `observedAt` is the validator's signed claim about when it
looked. The window defends against stale and recycled posts on the honest path;
it is not a defence against a validator willing to lie about time. That is why
who runs validators, and how many independent operators an application requires,
matters (see [VALIDATORS_AND_FEDERATION.md](VALIDATORS_AND_FEDERATION.md)).

## The result — exactly six fields

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

Nothing else: no finality flag, no campaign or cohort field, no quorum, no
Berm-issued identifier. Anything that is not exactly a valid six-field result is
a failure with a closed failure code. **The method fails closed.**

## What proving X establishes — and what it does not

It establishes that the X account with this immutable `accountId` published a
proof line naming this npub, observed by a validator inside the five-minute
window. It does **not** establish that any application accepts it; acceptance is
each application's own published policy.
