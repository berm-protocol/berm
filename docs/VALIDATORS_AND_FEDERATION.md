# Validators and federation

## A method is not a validator

- A **method** (for X: `berm.external_account_binding.x/2`) is a public,
  hashed specification. Anyone may implement it. No one owns it because they
  run it.
- A **validator** is an instance that executes a method and signs what its own
  fetch derived. A method must reach the same result with no knowledge of any
  other operator, peer count or quorum — the method is decidable alone.
- How many validators must agree, and which ones, is **application policy**,
  never part of the method.

## Operators and keys — an authorization chain

1. An **operator** proves its own external-account binding by the same public
   method everyone else uses.
2. The operator signs a `ValidatorAuthorization` naming a dedicated, rotatable
   validator key and the exact method and acquisition profile that key may
   observe under.
3. Observations signed by that key can then be traced back to the operator.

Authorizations are append-only: rotation and supersession never delete an
earlier authorization, so an observation signed while a key was live stays
checkable.

## Honest independence accounting

**Multiple validator instances under one operator are one operator.**

At launch, the two validator instances (one at xonly.ai, one at bermlaunch.com)
are run by the **same controlling operator**. Published results describe this as
*same-operator witnessed evidence* and a mechanism demonstration — not as
independent-operator corroboration, organizational independence or
infrastructure independence.

What two same-operator instances do show: the wire format works, two deployments
of the method agree (catching build drift, configuration divergence and clock
skew), and the accountability chain is satisfiable. What they show about
collusion resistance: nothing.

One genuinely outside operator changes that claim. No external independent
operator is claimed today.

Hosting a validator instance does not make xonly.ai or bermlaunch.com an
identity authority. They are infrastructure.
