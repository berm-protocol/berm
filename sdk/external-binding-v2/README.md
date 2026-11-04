# Current external binding developer quickstart

This is the standalone, offline entrypoint for `berm.external_account_binding.x/2`.
The runtime is a byte-exact mirror of the accepted implementation used by
BermLaunch, not a second verifier. Its upstream paths and SHA-256 values are
listed in `spec/external-binding-v2/SOURCE_MANIFEST.json` from the repository root.
The original normative files retain their original bytes and historical labels.

## Run from a fresh checkout

Use Node 22.6 or newer, then run from the repository root:

```sh
node sdk/external-binding-v2/verify.mjs
node --test sdk/external-binding-v2/test.mjs
node sdk/external-binding-v2/example.mjs
```

These commands require no package installation and make zero network requests.
The first verifies the exact source/specification/vector hashes and executes all
97 vectors. The second exercises signatures, operator authorization, policy,
tamper refusal and file export/readback. The example prints a disposable local
result, never a public identity certificate. Add a new output directory as the
last argument to retain `evidence.json` and its checksum; existing files refuse
overwrite. The test suite uses only OS-managed temporary directories.

The repository's broader browser/build tests use the committed per-package
lockfiles. Run `node scripts/install-chromium.mjs`, then
`node scripts/verify-all.mjs` with PHP 8.1+ on PATH. The full gate installs npm
dependencies with `npm ci`; it does not claim missing dependencies or skipped
browser checks passed. `--fast` is explicitly incomplete browser coverage.

## What to reuse

Import `verifyXBinding` from `runtime/bermProtocolR13a.js` and
`foldBindingEvidence` from `runtime/bermProtocolR13aEvidence.js`. Supply the actual
raw capture bytes, expected npub and acquisition timestamp to the method. The
only positive method value has the six fixed binding fields; failures contain
`ok: false` and a code. Never infer acceptance from a posted URL or screenshot.

The method's half-open window is `0 <= observedAt - postCreatedAt < 300000`.
Acceptance verifies the original subject claim, validator observations and
authorizations against the application's independently selected signed policy.
The application must pin its trusted policy/key outside untrusted submitted
evidence. A self-consistent policy is not automatically trusted. An authorization
requires operator identity standing; two instances of one operator do not prove
two independent operators. Capture hashes are signed provenance, not an extra
binding-equality condition.

`example.mjs` uses public fixture keys to create a subject, an operator, a
separate validator and an application. It validates original synthetic capture
bytes through the real method, signs each role's artifacts, executes the real
evidence fold and exports the same evidence. Its one explicit synthetic genesis
operator demonstrates mechanics only. It is not evidence that any public
operator has genesis standing. The reference signer under `test/` exists only
for this disposable example; it is not a production custody recommendation.

## Acquisition and application integration

The accepted acquisition specification is under
`spec/external-binding-v2/authority/method/spec/ACQUISITION_PROFILE.md`.
The current separately bound transport implementation lives in Xonly's
`services/xonly-r4-adapter/src/r4/x-syndication-provider.mjs`. Its fixed anonymous
syndication request is described in the technical reference. External platform
availability is not guaranteed; acquisition failures must remain unavailable,
not fabricated verification success. Do not add arbitrary proxy targets, OAuth,
private cookies, privileged X API credentials or redirect following.

The exact historical source can be read at
[Xonly's audited commit](https://github.com/xonly-ai/xonly/tree/9ba84644824b25f236c36622d81a89010ba08f78/services/xonly-r4-adapter).
Its injected handler and in-memory store are utilities, not a deployed durable
validator. Operators must supply authenticated role authorization, protected
observation signing, persistence and the reviewed receiver/transport boundary.
This quickstart neither installs those services nor authorizes a public signer.

## Portability and limits

Original signed artifacts can be exported and verified without their original
frontend. Back up the evidence and the externally selected policy identity.
The example's file export proves a file roundtrip, not crash-safe production
storage or multi-operator availability. A surviving website alone does not prove
independent replication. Historical NIP-39/Wayback records remain historical
evidence and are not automatically current `/2` binding certificates.

Keep copied runtime bytes unchanged. To update an accepted upstream version,
review that version, replace the explicit mirrored file set and update the
inventory together. Do not patch this mirror into an independent protocol.
