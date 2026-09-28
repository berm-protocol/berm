---
d: docs/why
title: Why Berm?
summary: Use the platform. Keep what is yours.
nav: 0
x_article: none
---

# Why Berm?

## Use the platform. Keep what is yours.

The internet keeps teaching the same lesson in different forms:

we build relationships inside systems we do not control.

A creator builds an audience on a social platform. A community forms around an
account. An application lets people “sign in with” that platform. Over time, the
platform account quietly stops being just a useful account and becomes the root
of identity for everything built around it.

If the account disappears, changes hands, is restricted, or the platform changes
its rules, every dependent application inherits that fragility.

Berm starts from a different assumption:

> **A platform can be where a relationship is proven without becoming the owner
> of the identity behind that relationship.**

## The name

In fortification, a berm is the strip of ground at the edge of a wall.

It is close enough to the fortress to be useful. But it is not the fortress.

That is the metaphor.

The wall is not the enemy. Walls make gardens useful: people are already inside,
and leaving the audience you spent years building is not a practical answer.
A berm is useful ground at the edge — close enough to the platform to matter,
outside it enough to remain yours.

Platforms such as X are extraordinarily useful fortresses of distribution:
people are already there, conversation already happens there, public history is
there, and social context is there.

Berm does not ask people to abandon those places.

It creates a layer at the edge.

Use X.

Prove that an X account belongs with your portable identity.

Then carry the resulting evidence somewhere else.

## The inversion

The conventional model is:

```text
platform account
    ↓
identity
    ↓
applications
```

If the platform account is the identity root, every application downstream is
borrowing identity from the platform.

Berm inverts it:

```text
portable identity (`npub`)
    ↓
verified relationship to X
    ↓
portable signed evidence
    ↓
applications
```

The X account remains useful and important. It simply stops being the thing that
owns the rest of the user's identity.

## What “portable” means here

Portable does not mean “every platform and every chain is already integrated.”

It means the root and the evidence are not private facts trapped inside one
application's database.

Today, Berm's current concrete external-account method is for X.

A successful X binding has one canonical six-field result:

```text
npub
accountId
handle
postId
textHash
methodHash
```

The immutable X `accountId` is the uniqueness key. The handle is display
metadata.

The permanent law is:

```text
(namespace, accountId) → at most one npub
npub                   → zero, one, or many external accounts
```

So one X account cannot become two different Berm identities. But one Berm
identity can accumulate additional verified external relationships over time as
new methods are published.

That is how portability grows without pretending unsupported integrations
already exist.

## Public proof instead of private assertion

Berm does not ask an application to accept:

```text
verified = true
```

because some server said so.

The method is public.

The evidence is signed.

Validators independently observe public material and sign what they derived.

Applications publish the policy under which they accept that evidence.

Those are different roles:

```text
subject       → signs a claim
validator     → signs an observation
application   → applies an acceptance policy
```

They are deliberately not collapsed into one trusted database.

## Why that matters for communities

A social community is normally represented as a collection of platform-native
objects:

followers, handles, group membership, posts.

Those are useful, but they are rented from the platform.

Berm adds a second layer: portable identities plus independently checkable
relationships and participation evidence.

That does not copy a platform's entire social graph into Berm.

It lets applications remember important relationships in a form that is not
owned exclusively by the platform or the application.

## xonly.ai: a practical implementation

xonly.ai provides a practical implementation and signing surface. It is not the
issuer or owner of the portable identity, and hosting does not confer protocol
authority.

## BermLaunch: the first economic application

BermLaunch is the first place where we are applying that idea economically.

The launchpad has campaign-specific law: community stages, campaign positions,
destinations, fee-sharing rules, launch contracts and market state.

Those facts belong to BermLaunch.

They are **not** silently stuffed into the portable identity binding.

The separation is:

```text
Berm Protocol
    portable identity + public external-account evidence

BermLaunch
    campaign participation + community contract + launch economics
```

That means a person can participate in a BermLaunch campaign without BermLaunch
becoming the permanent owner of the identity they used to participate.

It also means a community can begin around one application while being built on
identity/evidence that is designed to remain useful outside that application.

## Why the Canary matters

**Canary on a Berm** is intended to be the first real BermLaunch campaign.

The token is not the protocol.

The campaign is not the protocol.

The point of the Canary is to make the abstract boundary visible:

- a person keeps a portable identity;
- an X relationship is publicly proven;
- BermLaunch accepts that evidence under campaign policy;
- the person receives one campaign position under public campaign rules;
- the application can later disappear without retroactively becoming the owner
  of the identity proof.

That is a much more concrete demonstration than another identity diagram.

## What Berm does not claim

Berm does not claim:

- that X cannot restrict or delete an X account;
- that Berm restores access to a lost social account;
- that all platforms are already supported;
- that all chains are already supported;
- that validator instances controlled by one operator are organizationally
  independent;
- that applications lose the right to define their own acceptance policies.

The aim is narrower and, we think, more useful:

> **Use centralized platforms where they are useful without making them the
> permanent root of every relationship built around them.**

## The edge should remain yours

A good boundary is not a wall against the world.

It is a place from which you can use the world without surrendering everything
behind it.

That is the idea behind Berm.

Next: [Current standard](docs/current-standard) for the exact pinned method and its limits.
