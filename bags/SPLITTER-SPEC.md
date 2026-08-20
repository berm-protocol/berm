# BermResidualSplitter — specification

**Status: FOUNDER-APPROVED. `maxAllocatedBps = 5000`. Not in the frozen 209 — a non-gating
engineering task with a hard deployment deadline.**

Adding it requires a `BERMLAUNCH-SCOPE.md` revision under §18.

---

## §1 · What it is for, and why the timing is forced

The Distributor pays the creator's share to **one immutable address**:

```
BermRobinhoodDistributorV01.sol:378   _safeTransfer(weth, residualRecipient, amount)
```

`claimResidual()` sends **100% of the residual** there. There is no sub-split, no
second recipient, and no on-chain way to allocate part of the creator's share to
anyone else. `partnerRecipient` does **not** receive value — it appears only in
`_isControlledRole` (`:494`) as an authority-collision check.

Because `residualRecipient` is immutable at construction, **whatever the creator's
share is capable of, it is capable of from the first block.** A creator who deploys
with a plain address can still pay people later — but only as a promise, revocable
and off-protocol, which is the thing this product exists to replace.

This contract is the alternative: a destination that lets the creator make **later
commitments that are as unrevocable as a sealed root.**

### The blast radius, stated up front

The splitter sits **entirely downstream of the community share**. Supporter pockets
are paid by `claimBuyback` directly from the Distributor and never touch this
contract. **A defect here can strand the creator's own money and cannot reach a
single supporter.** That is the reason this is a different risk category from
modifying the claim path.

---

## §2 · Model

Not a range model. Each commitment carries its own **baseline** — the value of
`totalReceived` at the moment it was made — so a commitment pays **only on value
that arrives after it exists**. Retroactive grants are impossible, and a creator who
has already withdrawn can never be made insolvent by a later commitment.

```
entitlement(i)      = mulDiv(totalReceived - baseline(i), bps(i), 10_000)
claimable(i)        = entitlement(i) - withdrawn(i)
creatorEntitlement  = totalReceived - Σ entitlement(i)
creatorClaimable    = creatorEntitlement - creatorWithdrawn
```

**Solvency is structural.** `Σ entitlement(i) + creatorEntitlement == totalReceived`
by definition, and no party can withdraw beyond its entitlement. Because each
`entitlement(i)` floors, the rounding remainder always lands with the creator — a
payee is never short, and the creator absorbs the dust. Verified at every step of §6.

---

## §3 · State and immutables

```solidity
address public immutable weth;
address public immutable creatorRecipient;   // where the unallocated remainder goes
address public immutable committer;          // the only address that may commit
uint16  public immutable maxAllocatedBps;    // ceiling on total commitments

uint256 public totalReceived;
uint16  public allocatedBps;                 // monotonic, never decreases
uint256 public creatorWithdrawn;

struct Commitment { address recipient; uint16 bps; uint256 baseline; uint256 withdrawn; }
Commitment[] public commitments;
```

`maxAllocatedBps` bounds the damage of a compromised `committer` key. At 10000 a
stolen key can zero the creator's stream permanently; at 5000 it cannot take more
than half.

**FOUNDER RULING: `maxAllocatedBps = 5000`, immutable.** It bounds a compromised
committer key to at most half the residual, while leaving room for the stated
1000–2000 bps of total fees (2500–5000 bps of residual) to be committed more than
once. It cannot be raised later.

---

## §4 · Interface

```solidity
function sync() external returns (uint256 amount);
function commit(address recipient, uint16 bps) external returns (uint256 index);
function withdraw(uint256 index) external returns (uint256 amount);
function withdrawCreator() external returns (uint256 amount);

function entitlementOf(uint256 index) external view returns (uint256);
function claimableOf(uint256 index) external view returns (uint256);
function creatorEntitlement() external view returns (uint256);
function creatorClaimable() external view returns (uint256);
function commitmentCount() external view returns (uint256);
function unallocatedBps() external view returns (uint16);
```

**`sync()` is required and permissionless.** The Distributor *pushes* WETH here, so
arrival emits no callback. `sync()` measures `balanceOf(this)` against
`totalReceived - Σ withdrawn` and books the delta — the same shape as
`syncExternalDeposit()`. Anyone may call it.

**`withdraw` and `withdrawCreator` are permissionless.** Destinations are immutable
and no price is involved, so the caller chooses nothing — the same reasoning that
makes `harvest()` and `claimResidual()` permissionless. **Nobody needs gas to be
paid; only to pay.**

**`commit` is the only privileged function.** It can only reduce the committer's own
future share and can never touch an existing commitment.

---

## §5 · Invariants and must-fail

### Invariants — each needs its own test

| # | Invariant |
|---|---|
| I-1 | `allocatedBps` never decreases |
| I-2 | No function modifies or removes an existing `Commitment` except its `withdrawn` field |
| I-3 | A commitment pays **zero** on value received before its `baseline` |
| I-4 | Committing does not change any existing commitment's entitlement |
| I-5 | Committing does not reduce `creatorEntitlement` **at the moment of commit** |
| I-6 | `Σ entitlement(i) + creatorEntitlement == totalReceived`, exactly, always |
| I-7 | `withdrawn(i) <= entitlement(i)` and `creatorWithdrawn <= creatorEntitlement` |
| I-8 | Rounding remainder always accrues to the creator, never against a payee |
| I-9 | There is **no** function that revokes, reduces, reassigns, pauses or sweeps |

**I-9 is the product claim.** It is proven by absence: a test that enumerates the
ABI and asserts no such selector exists, in the shape of the existing `bindLaunch`
one-shot proof.

### Must fail

```
commit from any address other than committer         Unauthorized
commit with bps == 0                                 InvalidCommitment
commit with recipient == address(0)                  ZeroAddress
commit where allocatedBps + bps > maxAllocatedBps    ExceedsUnallocated
constructor with any zero address                    ZeroAddress
constructor with maxAllocatedBps == 0 or > 10000     InvalidConfiguration
withdraw(index) where index >= commitmentCount        InvalidCommitment
any reentrant path                                   ReentrantCall
native ETH sent to the contract                      NativeEthRejected
```

**Deliberately NOT failures:** two commitments to the same recipient (they simply
both pay); a commitment to the committer itself; `withdraw` when claimable is zero
(returns 0 rather than reverting, so a batch relayer is not griefed by one empty
payee); `sync()` when the delta is zero.

---

## §6 · Test vectors — ground truth

Generated from a reference model and machine-checked for solvency at every step.
Full integers in `bags/vectors/residual-splitter.json`. Reproduce **exactly**.

The sequence deliberately puts the dangerous cases early.

| Step | Event | The property it pins |
|---|---|---|
| V1 | deployed, nothing committed | zero state is coherent |
| V2 | 1e18 arrives | with no commitments, **all** to creator |
| V3 | creator withdraws all of it | creator can take their share before any commitment |
| **V4** | **commit A at 1500 bps, after 1e18 already arrived and was withdrawn** | **A's entitlement is 0. No retroactive grant. No insolvency.** |
| V5 | second 1e18 arrives | A gets 0.15e18; creator claimable 0.85e18 |
| **V6** | **commit B at 500 bps** | **A's entitlement is byte-identically unchanged (I-4)** |
| V7 | 3333333333333333333 wei arrives | floors correctly; creator absorbs remainder |
| V8 | all three withdraw | claimable returns to zero for all |
| V9 | 7 wei arrives | dust does not corrupt state |
| V10 | all three withdraw again | payees get 0, creator takes the 7 wei |

The V7 numbers, exactly:

```
totalReceived        5333333333333333333
A  1500bps base 1e18  entitlement  649999999999999999
B   500bps base 2e18  entitlement  166666666666666666
creatorEntitlement                4516666666666666668
sum                               5333333333333333333   == totalReceived
```

**Every step asserts I-6.** A vector that does not sum exactly is a failed run, not a
rounding note.

---

## §7 · Deployment ordering — the part that is time-boxed

`residualRecipient` is a Distributor constructor argument and immutable.

1. Deploy `BermResidualSplitter` with `creatorRecipient`, `committer`, `maxAllocatedBps`
2. Deploy the Distributor with `residualRecipient = <splitter address>`
3. Commit nothing

At step 3 the splitter is a **pass-through**: with `allocatedBps == 0` the creator
receives 100%, identical to deploying with a plain address. The option costs one
small contract and changes nothing unless used.

**The CREATE2 variant, and its limit.** The splitter's address can be computed in
advance from `keccak(initCode)` and named as `residualRecipient` before deployment.
Publishing the init code and salt makes this a cryptographic commitment rather than a
trust assumption — anyone can verify what will land there.

**But it defers the deploy transaction, not the design.** The init code must be final
to publish its hash. Naming a CREATE2 address *without* publishing the init code is
the version that must not ship: for that window nobody can verify what governs the
money, in the one place the product cannot afford a promise.

---

## §8 · Out of scope

```
revoking, reducing or reassigning a commitment    I-9; the entire point
pausing, sweeping or expiring                     invariant 3
an upgrade path or proxy                          a mutable splitter is a promise
committing against the community's 6000 bps       structurally impossible; this
                                                  contract only ever sees residual
transferable or tradeable commitments             UC-12 governs; legal advice first
scheduling or vesting a commitment                baseline is the only time dimension
a fourth cohort                                   COHORT_COUNT is 3 and hardcoded
```

**Last line matters.** This does not create new cohorts. GRADUATION and FOMO already
provide post-launch cohorts from the **community** share, with roots finalized after
deployment. This contract is only for slices of the **creator's own** share.

---

## §9 · Disclosure owed if it ships

`committer` is a **named authority** and belongs in `SOVEREIGNTY.md` with its powers
stated exactly: it may permanently reduce the creator's own future share up to
`maxAllocatedBps`, and it may do nothing else — it cannot revoke, cannot reach
committed value, and cannot touch any supporter pocket.

The public page must also distinguish two things a reader will otherwise merge:
a **committed** slice is as permanent as a Founding pocket; an **uncommitted**
remainder is the creator's and carries no promise at all.
