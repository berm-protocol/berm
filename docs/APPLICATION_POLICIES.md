# Application policies

## Each application decides for itself

An application publishes an `ApplicationAcceptancePolicy`: which methods (by id
and hash), which acquisition profiles, which validator keys and operators, how
many distinct operators must match, and the observation window it applies.

Two applications may accept the same binding under different policies, and
neither is wrong. **No Berm-maintained list is universal identity authority.**

V1 acceptance, in full:

```text
required eligible validators independently return the same canonical
six-field bindingHash inside the method's five-minute law   ->  accepted
anything else                                               ->  not accepted
```

## BermLaunch as a consumer

BermLaunch is an application built on Berm Protocol. It:

- **consumes** accepted portable binding evidence under its own policy;
- runs a **separate** campaign enrollment step, signed separately;
- enforces `(campaignId, npub) -> at most one campaign position`;
- keeps campaign, cohort, destination, allocation, provider and token facts
  **out of** the portable X binding.

BermLaunch does **not** issue identity, does not own any npub, and does not hold
anyone's private keys. If BermLaunch disappeared, every binding and every signed
observation would remain verifiable by anyone else.

```text
portable identity evidence → campaign enrollment → unique (campaignId, npub) position
```
