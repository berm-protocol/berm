# What it all does

Berm protocol · xonly.ai · bermlaunch.com — the whole system, in order, with the
human reason for every step.

---

## Why this document has this shape

We keep losing the thread the same way. A spec says one thing and the code does
another. A test asserts the workaround instead of the rule. Two repositories
implement "the same" law incompatibly and nobody notices for weeks.

None of that happens because people forget *what* the code should do. It happens
because they forget **why**. A specification tells you the required behaviour; only
the intent tells you whether a proposed change is still the same product.

So every step below carries four lines:

> **Someone wants** — the sentence a real person would say, in their words
> **What happens** — the mechanism, precisely
> **Why this way** — the reason, so a future change can be checked against it
> **You'd know it broke when** — the observable symptom

That last line is the important one. If you cannot say how you would notice a step
failing, you do not have an intent — you have a hope. Every place this project has
been bitten, the missing line was that one.

State is marked lightly: **[built]** · **[partial]** · **[not yet]**. For the
graded detail see `bags/CANARY-READINESS.md` and `spec/XONLY-READINESS.md`.

---

# Act 1 — Berm protocol: being someone

The layer that answers *"is this actually you?"* It works on its own and needs
nothing else here.

### 1. Get a key **[built]**

> **Someone wants:** "I want an account that nobody can take away from me."

**What happens.** A keypair is generated on your device. It is not registered
anywhere. There is no server that knows about it, no email, no password to reset.
The public half becomes your name; the private half stays with you.

**Why this way.** Every account you have ever lost was lost because somebody else
was holding it. An account nobody issues is an account nobody can revoke.

**You'd know it broke when:** creating an identity requires anything from us — a
signup, an approval, a rate limit. The moment we can say no, the promise is gone.

### 2. Claim your handle **[built]**

> **Someone wants:** "People know me as @dorian. I want that to mean me here too."

**What happens.** You sign a statement binding your key to an X handle *and* to X's
internal numeric account id.

**Why this way.** Handles get renamed, abandoned, suspended and re-registered by
strangers. Numeric ids never recycle. A claim bound only to the handle cannot tell
the original owner from whoever registered it after the account was deleted.

**You'd know it broke when:** a claim shows a handle with no account id and the
page treats it as equally good. It isn't, and it says so.

### 3. Prove it publicly **[built]**

> **Someone wants:** "Fine — but why should anyone believe I own that handle?"

**What happens.** You post the claim from the X account itself. Only someone who
controls that account can do that.

**Why this way.** A signature proves you hold a key. It does not prove you hold an
account. The post is what connects the two, and it has to happen in public.

**You'd know it broke when:** a claim ranks well with no proof post behind it.

### 4. Archive the proof **[built]**

> **Someone wants:** "What if the post disappears?"

**What happens.** The post is captured by a third-party archive before the claim
is treated as strong.

**Why this way — and this is the step people skip.** The proof post dies with the X
account. That is *exactly* the moment somebody else has registered your old handle
and is claiming to be you. The evidence vanishes precisely when it is needed. An
archived copy is held by someone with no stake in the argument.

**You'd know it broke when:** an identity's evidence is a link to a page that no
longer exists.

### 5. Anchor it in time **[built]**

> **Someone wants:** "Someone else is claiming they had this name first."

**What happens.** The claim is timestamped against a Bitcoin block. Unanchored
claims are still shown, but can never outrank an anchored one — and if nothing is
anchored, the page refuses to pick a winner rather than guessing.

**Why this way.** Every event carries a date typed by whoever signed it. Any key
can sign something dated 2009. Most tools display that field as though it were a
fact, which is exactly how a squatter wins an argument they should lose. A block
height is not a claim about time; it is time.

**You'd know it broke when:** ordering anywhere in the system depends on a
self-reported timestamp. **This is the mistake to watch for. It has nearly happened
more than once.**

### 6. Let anyone check **[built]**

> **Someone wants:** "How do I know the person messaging me is really them?"

**What happens.** `/who` resolves any handle and shows what is *actually* proven —
anchored or not, account id present or missing, proof archived or not, which relays
answered and which stayed silent.

**Why this way.** A claim nobody can check is decoration. And it must show absence
as loudly as presence, or "we found nothing" quietly becomes "nothing is wrong."

**You'd know it broke when:** the page shows a green tick for something it did not
verify.

### 7. Argue, if it comes to that **[built]**

> **Someone wants:** "Two accounts claim to be me. Now what?"

**What happens.** Both sides are laid out with their evidence graded, and the
strength of each is stated rather than a winner being asserted.

**Why this way.** A system that always names a winner will sometimes name the wrong
one confidently. Better to show the evidence and let a human decide when the
evidence genuinely does not decide.

**You'd know it broke when:** a dispute resolves confidently on weak evidence.

### 8. Lose a device without losing yourself **[built]**

> **Someone wants:** "My laptop died. Am I finished?"

**What happens.** You are told the truth for your actual situation, including
*"this identity cannot be recovered"* when that is the answer.

**Why this way.** A recovery flow that always offers hope is worse than useless —
people act on it. Naming the unrecoverable case is what makes the recoverable ones
believable.

**You'd know it broke when:** every path ends in reassurance.

---

# Act 2 — xonly.ai: doing something with it

Where an identity is made and used.

### 9. Hold a key without learning cryptography **[partial]**

> **Someone wants:** "I don't want to understand any of this. I just want in."

**What happens.** Four ways in, ordered **by how little you end up depending on
us** — not by what is easiest for us.

- **Already have a signer?** We use it and say so. No argument.
- **Otherwise: make a key here, and download it immediately.** Encrypted with a
  passphrase you choose, in a standard format that works in Amber, Damus, Alby,
  nsec.app, or anything invented later. **You cannot continue until you have it.**
- **Or use a passkey at our signer** — fastest, and labelled plainly as depending
  on us, with the export button always visible.
- **Or bring your own** extension or bunker.

**Why this way.** The ordering is the argument. Anyone can offer a convenient
account; the point here is that you can leave with everything, from the first
second, having lost nothing. The blocked download is the only place in the whole
product where we refuse to let you continue — because someone who walks away
without it has an identity that exists only in a browser tab.

**You'd know it broke when:** the convenient option is offered first, or the
download becomes skippable. Both would be small changes. Both would end the
product.

*Currently: the encrypted download is specified but not built, so the default path
cannot ship yet.*

### 10. Let other apps ask you to sign **[not yet]**

> **Someone wants:** "This other site wants me to sign something. Is that safe?"

**What happens.** The other site never touches your key. It opens our signer in a
real window — real address bar, visible — and receives back a signature, or a
refusal.

**Why this way.** The tempting design gives every partner a subdomain and lets each
one call the passkey directly. It is one line of configuration and it is
unshippable: those clients would share the *credential*, so one compromised partner
could sign as any user of any partner. So clients never touch the key. They ask.

**You'd know it broke when:** a partner site can obtain key material rather than a
signature. There is no disclosure that makes that acceptable.

### 11. Write something that outlives the platform **[built]**

> **Someone wants:** "I want to write properly, and I don't want it to vanish."

**What happens.** A real editor. What you write is signed by you and published to
Nostr, where any client can read it. It can also be pushed to your own page and
exported to X.

**Why this way.** Signed and distributed means no single company can delete it, and
anyone can prove you wrote it. Deleting it from X does not delete it.

**You'd know it broke when:** declining the signature still publishes something.
*This is asserted by a test: on refusal, relays store zero events.*

### 12. Your page **[partial]**

> **Someone wants:** "I want one place that is mine, that shows what I've written
> and that I really am who I say."

**What happens.** Everything you signed appears under your handle, with the
identity evidence attached.

**Why this way.** Two things people normally have to trust separately — *this is
really them* and *they really wrote this* — become one checkable thing. It also
means the record does not quietly improve: something you signed and later deleted
elsewhere is still there.

**You'd know it broke when:** content appears under a handle without a signature
tying it to that key.

---

# Act 3 — bermlaunch.com: when it's worth money

Same identity, higher stakes. Being wrong here is theft rather than embarrassment.

### 13. A creator launches **[partial]**

> **Someone wants:** "I'm launching a token and I want my early supporters to
> actually get paid, not just be promised."

**What happens.** The token launches on Bags. The trading fees are pointed at one
address — a contract we build — instead of at a person.

**Why this way.** A promise to share revenue is a promise. Fees arriving at a
contract that can only split them one way is a fact.

**You'd know it broke when:** the fee destination can still be changed by the
creator after people have signed up. *Until the creator waives that right, it can.*

### 14. A supporter enrolls **[partial]**

> **Someone wants:** "I want in early, and I want my share to be mine — not
> revocable, not conditional on being liked later."

**What happens.** You sign one message: this campaign, this identity, this payout
address, and proof you control that address. Joining costs a signature.

**Why this way.** Enrollment is deliberately easy and claiming is deliberately
strict. Most systems get this backwards — hard to join, easy to withdraw — and
then find they gated the wrong end.

**You'd know it broke when:** any address enters a payout list without proof that
somebody controls it. *This has happened once — fifty addresses, no proofs, and it
passed review — which is why it is now the loudest check in the system.*

### 15. The cohort closes **[partial]**

> **Someone wants:** "Was I early enough?"

**What happens.** Membership comes from published snapshots. The first batch is
whoever was in the first snapshot; the second is the second snapshot minus the
first.

**Why this way.** You are in the batch where you were *seen*, not the batch you
claim. Back-dating buys nothing at all.

**You'd know it broke when:** somebody's position depends on a number they typed.

### 16. The list is committed **[partial]**

> **Someone wants:** "Can they quietly change the list later?"

**What happens.** The whole membership is compressed into one fingerprint published
on-chain. Change any entry and the fingerprint changes.

**Why this way.** It makes silent editing impossible rather than merely against the
rules.

**You'd know it broke when:** the published list and the published fingerprint stop
matching, and nothing says so.

### 17. Money arrives and splits **[partial]**

> **Someone wants:** "When does my share actually show up?"

**What happens.** Trading fees flow to the contract, which credits every pocket by
its fixed proportion. Your pocket is not an address you can spend from — it is an
entitlement that accumulates.

**Why this way.** The arithmetic is chosen so shares always sum to exactly the
whole. No dust, no rounding remainder that someone would have to decide what to do
with. And entitlement **never expires** — no claim window, no way to be too late,
no requirement to be paying attention.

**You'd know it broke when:** anyone finds a deadline, a sweep, or a way for
unclaimed value to go somewhere else.

### 18. You claim **[not yet]**

> **Someone wants:** "I want my money, and I don't want to ask permission."

**What happens.** You prove you are in the list and withdraw. No account, no
approval, no website required.

**Why this way.** If claiming needs our site to be up, our site is a chokepoint —
and a chokepoint is a thing that can be pressured.

**You'd know it broke when:** claiming stops working because we are offline.

### 19. Anyone checks **[not yet]**

> **Someone wants:** "Don't tell me it's fair. Show me."

**What happens.** A page that rebuilds the entire list from public evidence and
compares it to what was published — including every payout address and whether
control of it was ever proven. It runs from a domain we don't control, and from a
file on your own machine.

**Why this way.** Being able to check is the product. And it is not primarily for
outsiders: **the fifty unproven addresses survived a full review and a green tick
because the only way to look at that list was a blob of data.** Fifty rows on a
page, each labelled, would have made it unshippable — not because a stranger would
have caught it, but because we would have.

**You'd know it broke when:** it says "verified" before it has recomputed
anything, or it cannot say "I couldn't check this" as loudly as it says "fine."

---

## The four promises

Everything above serves these. If a change weakens one, it is the wrong change no
matter how much it improves anything else.

1. **Your identity is yours.** Nobody issues it, nobody can revoke it, and you can
   leave with it whole at any moment.
2. **Your share is fixed.** Once committed it cannot be changed by us — and you do
   not have to be present, online, or liked to keep it.
3. **You can check everything yourself**, without asking us, on infrastructure we
   do not control.
4. **We say who can still break it.** Bags can rewrite the fee split and we cannot
   stop them. That is disclosed at the top, not buried.

The fourth is the one that makes the others believable. Anyone can claim the first
three. Publishing the list of people who could still break your promises is the
part nobody does.

---

## What would break the whole thing

Small changes, each of which would look reasonable in isolation:

- ordering anything by a timestamp the signer chose
- letting the convenient signer option be offered first
- making the key download skippable
- accepting an address into a payout list without proof of control
- rendering "verified" for something that was merely absent
- an explorer that checks the code by running the same code
- adding a deadline, a sweep, or an expiry to entitlement
- letting claiming depend on our website being up

Each has been proposed, attempted, or shipped at least once. That is why they are
written down here rather than assumed.
