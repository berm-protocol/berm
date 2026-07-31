## What and why

<!-- The diff shows what changed. Explain why. -->

## Claims

Every claim in this project has a command behind it. Which does this PR touch?

- [ ] Adds a claim — and the check that proves it
- [ ] Changes a claim — named below, with the check updated
- [ ] Removes a claim — named below, with why it is no longer true
- [ ] No claims affected

<!-- If a check was removed, say which guarantee stopped being guaranteed. -->

## Verification

```
<!-- paste the relevant verifier output -->
```

- [ ] `node scripts/verify-all.mjs` is green locally
- [ ] No test here would pass if the feature were deleted

## Checklist

- [ ] Test vectors not regenerated (or: this is a deliberate versioned migration, explained above)
- [ ] No NIP-04, no CDN, no external origin
- [ ] Any new signer prompt names its consequence in `describeForApproval`
- [ ] Comments explain decisions, not mechanisms
