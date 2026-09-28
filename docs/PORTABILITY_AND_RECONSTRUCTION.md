# Portability and reconstruction

The goal: a stranger can rebuild a verdict **without asking us**.

## What is portable

- the npub (held by the person);
- the six-field binding and its `bindingHash`;
- every signed artifact — claim, observations, authorizations, policies, receipts.

## What a stranger checks

1. The subject claim's signature verifies against the npub in the binding.
2. Each observation's signature verifies against its validator key.
3. Each validator key is authorized, at signing time, by an operator whose own
   binding verifies by the same method.
4. `methodHash` and `acquisitionHash` match what the stranger's chosen policy accepts.
5. The binding's `bindingHash` recomputes from its six fields.
6. `postCreatedAt` recomputes from `postId`, and the stated `observedAt` sits
   inside the half-open five-minute window
   `0 <= observedAt - postCreatedAt < 300000 ms`.
7. The required number of distinct operators returned the same `bindingHash`.

## What holds with no trust at all

- The post's age — recomputable from `postId`.
- `bindingHash` — recomputable from the binding.
- The method — public; run it over any capture you obtain yourself.
- The `(namespace, accountId) → npub` lock — permanent once recorded.

## What late verification means

Posts can be edited inside X's edit window, so a stranger arriving much later
usually cannot re-fetch the post and get the same text. **Late verification means
verifying signed observations**, not repeating the link check. This is stated
openly because it is a real change in what a stranger trusts.
