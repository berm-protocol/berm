/**
 * Generates vectors/test-vectors.json.
 *
 * Run once, commit the output, then never regenerate casually — the file is a
 * FROZEN BASELINE. If a dependency upgrade or a refactor changes any value in
 * it, that is a breaking change to every existing user's identity and must be
 * treated as such. `npm run vectors:verify` is what enforces that.
 *
 * All inputs are themselves derived from fixed strings via SHA-256, so any
 * third party can regenerate this file from scratch and get identical bytes.
 */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { nip44 } from 'nostr-tools';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { identityFromPrf, isValidScalar, buildInfo } from '../src/derive.js';
import { eventId, serializeEvent, type UnsignedEvent } from '../src/event.js';
import { buildClaimTag, proofText, shareIntentUrl } from '../src/nip39.js';
import { SECP256K1_ORDER } from '../src/constants.js';

const here = dirname(fileURLToPath(import.meta.url));

/** Reproducible pseudo-PRF input. Not a real PRF output — a fixed stand-in so
 *  the derivation downstream of the authenticator is pinned. */
const fixed = (label: string) => sha256(utf8ToBytes(label));

/**
 * Test inputs, seeded from fixed strings.
 *
 * THESE STRINGS MUST NOT BE RENAMED. They still say `xnsb` after the rename to
 * Berm, for the same reason the derivation salts do — but the failure mode here
 * is sneakier.
 *
 * Every value in the frozen vector file is derived from these seeds. Changing one
 * character changes `prfOut` and `credentialId`, which changes every secret key,
 * npub, event id and conversation key in the baseline. The derivation function
 * would be untouched and the file would be entirely different — destroying the
 * one thing the frozen vectors exist to prove: *these exact bytes come back*.
 *
 * This nearly shipped during the rename. The generated file changed in four
 * sections and it looked like derivation drift; it was the inputs moving under a
 * fixed function. See `scripts/check-vectors-frozen.mjs`, which now pins the
 * baseline hash so this cannot pass silently again.
 */
const PRF_A = fixed('xnsb/test/prf/A');
const PRF_B = fixed('xnsb/test/prf/B');
const CRED_A = fixed('xnsb/test/cred/A').slice(0, 16);
const CRED_B = fixed('xnsb/test/cred/B').slice(0, 16);

const idA = identityFromPrf(PRF_A, CRED_A);
const idB = identityFromPrf(PRF_B, CRED_A);
const idAcredB = identityFromPrf(PRF_A, CRED_B);

/* ---- V3: a real kind 0 with two NIP-39 claims -------------------------- */

const profileContent = JSON.stringify({
  name: 'dorian',
  display_name: 'Dorian',
  about: 'Building Berm.',
  nip05: '_@xonly.ai',
  website: 'https://xonly.ai',
});

const kind0: UnsignedEvent = {
  pubkey: idA.pubkeyHex,
  created_at: 1785000000,
  kind: 0,
  tags: [
    buildClaimTag({ platform: 'twitter', identity: 'dorian_handle', proof: '1789456123456789012' }),
    buildClaimTag({ platform: 'github', identity: 'dorian', proof: '9721ce4ee4fceb91c9711ca2a6c9a5ab' }),
  ],
  content: profileContent,
};

/* ---- V4: NIP-44 v2 ----------------------------------------------------- */

const hexToBytes = (h: string) => Uint8Array.from(h.match(/../g)!.map((b) => parseInt(b, 16)));

/** Taken verbatim from the official nip44.vectors.json (v2.valid.get_conversation_key).
 *  These are the cross-implementation anchor — they were NOT produced by this repo. */
const OFFICIAL_CONVERSATION_KEYS = [
  {
    sec1: '315e59ff51cb9209768cf7da80791ddcaae56ac9775eb25b6dee1234bc5d2268',
    pub2: 'c2f9d9948dc8c7c38321e4b85c8558872eafa0641cd269db76848a6073e69133',
    conversation_key: '3dfef0ce2a4d80a25e7a328accf73448ef67096f65f79588e358d9a0eb9013f1',
  },
  {
    sec1: 'a1e37752c9fdc1273be53f68c5f74be7c8905728e8de75800b94262f9497c86e',
    pub2: '03bb7947065dde12ba991ea045132581d0954f042c84e06d8c00066e23c1a800',
    conversation_key: '4d14f36e81b8452128da64fe6f1eae873baae2f444b02c950b90e43553f2178b',
  },
];

const selfConvKey = nip44.v2.utils.getConversationKey(idA.secretKey, idA.pubkeyHex);

/* ---- assemble ---------------------------------------------------------- */

const vectors = {
  $schema: 'Berm v2 §7 test vectors',
  generatedBy: '@berm/crypto@2.0.0 — scripts/generate-vectors.ts',
  frozen: true,
  note:
    'FROZEN BASELINE. A change to any value here changes every existing ' +
    'user identity. Do not regenerate to make a failing test pass.',

  V1_derivation_stability: {
    description:
      'Fixed PRF output + credential id must always yield the same identity, ' +
      'in every browser, on every device, across rebuilds. This determinism is ' +
      'what lets a user sign in on a new machine with only a synced passkey.',
    cases: [
      {
        label: 'prf=A cred=A',
        prfOutHex: bytesToHex(PRF_A),
        credentialIdHex: bytesToHex(CRED_A),
        infoHex: bytesToHex(buildInfo(CRED_A, 0)),
        secretKeyHex: bytesToHex(idA.secretKey),
        pubkeyHex: idA.pubkeyHex,
        npub: idA.npub,
        nsec: idA.nsec,
        attempt: idA.attempt,
      },
      {
        label: 'prf=B cred=A — different PRF must give a different identity',
        prfOutHex: bytesToHex(PRF_B),
        credentialIdHex: bytesToHex(CRED_A),
        secretKeyHex: bytesToHex(idB.secretKey),
        pubkeyHex: idB.pubkeyHex,
        npub: idB.npub,
        attempt: idB.attempt,
      },
      {
        label: 'prf=A cred=B — different credential must give a different identity',
        prfOutHex: bytesToHex(PRF_A),
        credentialIdHex: bytesToHex(CRED_B),
        secretKeyHex: bytesToHex(idAcredB.secretKey),
        pubkeyHex: idAcredB.pubkeyHex,
        npub: idAcredB.npub,
        attempt: idAcredB.attempt,
      },
    ],
  },

  V2_scalar_validation: {
    description:
      'Boundary conditions for 0 < sk < n, plus the counter-retry branch. ' +
      'A natural retry case is unreachable: P(HKDF output >= n) < 2^-128, so ' +
      'the branch is exercised by injecting a stub KDF. This is a deliberate ' +
      'substitution, documented rather than hidden.',
    curveOrderHex: SECP256K1_ORDER.toString(16),
    boundary: [
      { label: 'zero', hex: '00'.repeat(32), valid: false },
      { label: 'one', hex: '00'.repeat(31) + '01', valid: true },
      { label: 'n minus 1', hex: (SECP256K1_ORDER - 1n).toString(16).padStart(64, '0'), valid: true },
      { label: 'n exactly', hex: SECP256K1_ORDER.toString(16).padStart(64, '0'), valid: false },
      { label: 'n plus 1', hex: (SECP256K1_ORDER + 1n).toString(16).padStart(64, '0'), valid: false },
      { label: 'all 0xff', hex: 'ff'.repeat(32), valid: false },
      { label: 'wrong length (31 bytes)', hex: '00'.repeat(30) + '01', valid: false },
    ],
    retry: {
      description:
        'Stub KDF returns n (invalid) at counter 0, then a valid scalar at ' +
        'counter 1. deriveSecretKey must return attempt=1, not throw and not clamp.',
      counter0Hex: SECP256K1_ORDER.toString(16).padStart(64, '0'),
      counter1Hex: '00'.repeat(31) + '2a',
      expectedAttempt: 1,
    },
  },

  V3_event_id: {
    description:
      'NIP-01 canonical serialization and event id for a kind 0 carrying two ' +
      'NIP-39 claims. Pinned because a serialization bug produces events that ' +
      'relays reject silently.',
    event: kind0,
    serialized: serializeEvent(kind0),
    id: eventId(kind0),
  },

  V4_nip44: {
    description:
      'NIP-44 v2 only. NIP-04 is deprecated and prohibited repo-wide. The ' +
      'conversation-key cases are copied verbatim from the official ' +
      'nip44.vectors.json and are the cross-implementation anchor.',
    officialConversationKeys: OFFICIAL_CONVERSATION_KEYS,
    selfEncryption: {
      description: 'kind 30078 app state is self-encrypted (§4.3).',
      pubkeyHex: idA.pubkeyHex,
      conversationKeyHex: bytesToHex(selfConvKey),
      plaintext: JSON.stringify({ theme: 'dark', apps: ['wp-shop-node'] }),
    },
  },

  V5_origin_scoping: {
    description:
      'NEGATIVE VECTOR. Key derivation must refuse to run anywhere except the ' +
      'signer origin, and two signer origins must yield two different RP IDs ' +
      'and therefore two non-interchangeable identities. The full WebAuthn ' +
      'RP-ID guarantee is a browser property and is covered by the manual e2e ' +
      'checklist; what is unit-tested here is our own origin guard.',
    signerOrigin: 'https://signer.xonly.ai',
    expectedRpId: 'signer.xonly.ai',
    mustThrow: [
      'https://blog-a.com',
      'https://xonly.ai',
      'https://signer.xonly.ai.evil.tld',
      'http://signer.xonly.ai',
    ],
  },

  V6_v1_regression_guard: {
    description:
      'NEGATIVE VECTOR. The v1 derivation is a public function of a public ' +
      'value. An attacker holding only the X user ID reproduces the key ' +
      'exactly. This vector exists so the broken primitive can never re-enter ' +
      'the codebase unnoticed.',
    publicXUserId: '12345678',
    note:
      'The expected key is intentionally NOT recorded here. The test computes ' +
      'both the victim-side and attacker-side derivations and asserts they are ' +
      'equal — the assertion is the equality itself, not a stored constant.',
    alsoAsserts: [
      'a 6-digit PIN is recovered by exhaustive offline search in well under a second',
      'no file under src/ (excluding src/quarantine/) contains the v1 salt literal',
      'no file under src/ or test/ references nip04',
    ],
  },

  V7_nip39_binding: {
    description: 'Binding state resolution must never render "claimed" as "verified".',
    npub: idA.npub,
    proofText: proofText(idA.npub),
    shareIntentUrl: shareIntentUrl(idA.npub),
    claimTag: buildClaimTag({
      platform: 'twitter',
      identity: 'dorian_handle',
      proof: '1789456123456789012',
    }),
    states: [
      { claim: 'dorian_handle', liveHandle: 'dorian_handle', expected: 'verified' },
      { claim: 'dorian_handle', liveHandle: 'DORIAN_HANDLE', expected: 'verified' },
      { claim: 'dorian_handle', liveHandle: null, expected: 'claimed' },
      { claim: 'dorian_handle', liveHandle: 'someone_else', expected: 'claimed' },
      { claim: null, liveHandle: 'dorian_handle', expected: 'unlinked' },
    ],
  },
};

const outPath = resolve(here, '..', 'vectors', 'test-vectors.json');
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(vectors, null, 2) + '\n');

console.log(`wrote ${outPath}`);
console.log(`  V1 identity (prf=A, cred=A): ${idA.npub}`);
console.log(`  V3 event id: ${eventId(kind0)}`);
console.log(`  sanity: sk valid = ${isValidScalar(idA.secretKey)}, attempt = ${idA.attempt}`);
