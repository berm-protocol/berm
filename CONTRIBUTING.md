# Contributing

```bash
git clone https://github.com/berm-protocol/berm && cd berm
node scripts/verify-all.mjs --fast     # ~1 min, no browser needed
node scripts/verify-all.mjs            # everything, needs Chromium
```

If `--fast` is green you can start working. If the full run is green you can
open a PR.

## The one rule

**Every claim gets a command.**

This project makes strong statements — the node cannot personalise a page, the
archive never leaves your device, a claimed handle can never render as verified.
Each of those is an assertion in a test file, not a sentence in a README. If you
add a claim, add the check. If you remove a check, you are removing a claim, and
the PR needs to say which.

The corollary matters more: **a test that would pass even if the feature were
absent is worse than no test.** When we assert that a forged event is dropped,
we first assert that the hostile relay really sent it.

## Layout

| Directory | What it is | Verify with |
|---|---|---|
| `crypto/` | Identity derivation, vectors, the v1 quarantine | `npm test` |
| `sdk/` | `window.berm` — the surface apps use | `npm test`, `npm run example:verify` |
| `graph/` | X archive import, private follow sets, social proof | `npm test`, `npm run verify` |
| `editor/` | WYSIWYG for long-form, three publish targets | `npm run verify` |
| `link/` | Handle claim, proof, archive | `npm run verify` |
| `recovery/` | Readiness check and loss walkthroughs | `npm run verify` |
| `explorer/` | `/who` identity lookup | `npm run verify` |
| `wordpress/` | The node — pure-PHP BIP-340 verification | `php tests/run.php` |
| `docs/` | Documentation, published as signed events | `node check.mjs` |
| `nips/` | Drafts for `nostr-protocol/nips` | — |

Nothing downstream is safe until `crypto/` is green, because everything inherits
its guarantees.

## Things that will get a PR rejected

**Regenerating the test vectors to make a test pass.** A changed vector means
every existing user's identity changed. `crypto/vectors/test-vectors.json` is a
frozen baseline; regeneration is a deliberate, versioned migration and never a
fix for red CI.

**Introducing NIP-04.** Prohibited repo-wide, including in tests. CI enforces it.

**Loading anything from a CDN.** Same. The node serves what it serves.

**Making the node reader-aware.** `renderArticle(article, reactions)` takes two
arguments and a test asserts `renderArticle.length === 2`. If you need a third,
explain in the PR why the privacy property should be given up.

**A signer prompt that does not name its consequence.** "Save application data"
tells a user nothing and trains them to click yes. Add a case to
`describeForApproval` instead.

**Collapsing `claimed` into `verified`.** The most damaging bug this project
could ship. The SDK is built so the optimistic value is unconstructible
client-side; keep it that way.

## Commits and PRs

Small and focused. Explain *why* in the body — the diff already shows what.

A PR should say which claims it adds, changes or removes, and show the relevant
verifier output. Screenshots welcome for anything visual.

Set your git email to your GitHub `noreply` address before your first commit.
Author emails are embedded in every commit and public forever.

## Comments

Comment the decision, not the mechanism. `// increment i` is noise; *"base 2^16
because 2^256 lands exactly on limb 16, making reduction a clean split"* is the
thing a future reader cannot recover from the code.

Where something is a known limitation, say so in the file. Honest comments about
partial coverage are worth more than confident ones about complete coverage.

## Contributing to NIPs

Protocol proposals go to `nostr-protocol/nips`, **from your personal account,
not from the project org**. See `nips/README.md` for the sequence and why the
NIP-39 amendment goes first. Do not propose the project's own `berm:*`
namespaces — NIP-78 exists so applications never have to.

## Security

Do not open a public issue for an unpublished vulnerability. See
[SECURITY.md](SECURITY.md).
