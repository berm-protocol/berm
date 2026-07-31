# @berm/chain

A durable anchor that makes domains, hosts and this project disposable.

```bash
npm ci
npm run compile   # solc + an audit of the compiled artefact
npm test          # 23 resolver assertions
npm run verify    # compile, then execute the contract in a real EVM (32 checks)
```

## Read this before believing the headline

**This does not fix T9.** The tier-1 signer origin is still a DNS dependency and
no contract on any chain changes that.

WebAuthn binds a passkey to an RP ID derived from a domain name, and the
**browser** enforces that binding. Whoever serves `signer.xonly.ai` still gets
`prf_out` on the user's next Face ID tap. A contract cannot instruct an
authenticator to withhold a secret from a page that satisfies the RP ID. T9 is
fixed only by giving the user a root the passkey merely *wraps* — the v2.2
mnemonic work — and this package is not that.

Promising otherwise would repeat exactly the error the custody documentation had
to be corrected for.

## What it does make disposable

| Was a dependency | Becomes |
|---|---|
| "which relays hold this identity?" | a pointer nobody can quietly rewrite |
| "which image hosts?" | same |
| "which node is theirs?" | same |
| "who claimed this handle first?" | an unforgeable timestamp |
| "is this key still good?" | a revocation no host can suppress |
| this project continuing to exist | nothing — the record outlives us |

The chain answers *where to look* and *who is current*. It never serves content
and never holds identity: **the npub is the identity**, and no record can change
that.

## The contract

Six state-changing functions, no owner, no admin, no pause, no upgrade path, no
proxy, no constructor arguments. `compile.mjs` asserts this against the compiled
artefact rather than the source, because a comment claiming immutability is worth
nothing and the source is not what gets deployed:

```
PASS  no owner, admin, upgrade, pause or rescue function
PASS  no payable function — the contract can never hold value
PASS  no SELFDESTRUCT in executable code
PASS  no DELEGATECALL in executable code
PASS  no CREATE / CREATE2 — the contract deploys nothing
PASS  no CALL / CALLCODE — it never invokes another contract
```

That audit needed a real disassembler. A naive byte scan for `0xff` and `0xf4`
fails against a contract containing neither, because those bytes appear constantly
as PUSH immediates, function selectors and inside the appended CBOR metadata.
`opcodesIn()` walks the program and skips each PUSH's immediate bytes; the
metadata is stripped first.

Immutability cuts both ways and is stated as a cost: **a bug here cannot be
patched.** So the contract is as small as it can be, and clients treat it as one
input among several rather than as an oracle.

## Behaviour, executed rather than asserted

`npm run verify` deploys it into an in-process EVM and calls it. A contract that
cannot be patched deserves better than a shape check:

- first claim wins permanently; a second claimer gets `AlreadyClaimed`
- a stranger cannot update, revoke, or start a handover
- `claimedAt` never moves — not on update, not across a handover. It is the
  ordering anchor, so it has to be the one field nothing can touch
- a handover cannot be completed early, cannot be completed by a third party,
  and cannot be completed after cancellation
- **revocation cannot be undone, even by the controller**
- sending value to it reverts, and its balance stays zero

## The handover delay, honestly

Seven days, and here is what it does **not** buy: if your controller key is
stolen, the thief can do everything you can, including cancelling your
cancellation. The delay does not prevent a takeover.

What it does is turn a **silent** takeover into a **public** one with a warning
period. The pending transfer is readable by anyone for a week before it takes
effect, so monitors and the user's own tooling can shout. Same shape as the signer
transparency log: detection, not prevention.

Completion is performed by the **incoming** controller, not the outgoing one — a
transfer to an address that cannot act would be a record nobody can ever update,
indistinguishable from a burn.

## The resolver is the part that matters

It is very easy to "fix" a DNS dependency by adding an RPC dependency and call the
result decentralised. A client that cannot resolve an identity when its RPC
endpoint is down has not removed a single point of failure — it has moved one.

So: **the chain is an optional corroborator, never a required lookup.** Every path
degrades to a usable answer with no chain access at all, and the test suite pins
that.

| State | Means |
|---|---|
| `anchored` | a record exists, is not revoked, and the identity confirms it |
| `unanchored` | no record, or no chain access. **Normal.** Not a warning |
| `contested` | a record exists but the two sides disagree → trust neither |
| `revoked` | the controller said stop. The loudest thing this can say |

**Two-way binding, for the same reason `claimed` is never rendered as
`verified`.** Anyone can write any pubkey into a public contract, so a record
alone proves nothing; the identity must also publish an event naming the chain,
contract and controller. One side without the other is `contested` — which is
worth *less* than no claim at all, and is why squatting a pubkey here gains nobody
anything.

**An anchor may add places to look, never remove them.** `mergeLocators` unions
and cannot drop a relay the signed event named — otherwise whoever holds the
controller key could steer readers away from copies they dislike, which is
censorship dressed as configuration.

**An anchor can never change the signer origin.** That field is taken from the
event and nowhere else. Letting a chain record redirect the signer would hand a
takeover route to whoever holds the controller key — inventing a second T9 while
claiming to solve the first.

## Chain choice — not yet made

The contract is written in Solidity and executes correctly, but **nothing here
commits you to an EVM chain.** The hard parts are the record shape, the two-way
binding rule and the resolution order, and those are identical on Solana. Porting
is an afternoon; the design above is the part that took the thinking.

Deliberately **not** decided yet, because each needs a real answer and none of
them is urgent while there are no users:

- which chain, and what it costs a user to claim and update
- who pays — an identity that requires gas to exist is not an on-ramp
- whether a claim should be gasless via a relayer, and what that re-centralises

## Not verified by machine

- No deployment to any live network. Addresses, gas costs and confirmation times
  are unmeasured.
- The locator document format is specified in types and has no published schema.
- Reproducible builds are claimed via pinned solc and settings and the recorded
  source hash, but nobody has reproduced this build independently.
