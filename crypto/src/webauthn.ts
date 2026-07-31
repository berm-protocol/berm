/**
 * Berm v2 §3.2.2–§3.2.3 — WebAuthn PRF enrolment and evaluation.
 *
 * Browser-only. Node cannot exercise these paths, so they are covered by the
 * manual e2e checklist (scripts/e2e-checklist.md), not by unit tests. What IS
 * unit-tested is everything downstream of `prfOut`, plus the origin guard.
 */

import {
  PrfUnsupportedError,
  PrfAdvertisedButAbsentError,
  BackupNotConfirmedError,
} from './errors.js';
import { PRF_SALT_IDENTITY } from './constants.js';
import { assertSignerOrigin, rpIdFromOrigin } from './origin.js';
import { identityFromPrf, type Identity } from './derive.js';

const enc = new TextEncoder();

/**
 * TypeScript 5.7+ types `Uint8Array` as `Uint8Array<ArrayBufferLike>`, which is
 * not assignable to the DOM's `BufferSource` (that requires `ArrayBuffer`
 * specifically, since a `SharedArrayBuffer` is not permitted here). Copy into a
 * freshly allocated, non-shared buffer. Also has the useful side effect of
 * detaching the WebAuthn inputs from any caller-owned memory.
 */
function asBufferSource(u8: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(u8.length));
  out.set(u8);
  return out;
}

const prfSalt = () => asBufferSource(enc.encode(PRF_SALT_IDENTITY));
const challenge = () => crypto.getRandomValues(new Uint8Array(new ArrayBuffer(32)));

export interface SignerConfig {
  /** e.g. "https://signer.xonly.ai" */
  readonly origin: string;
  readonly rpName: string;
}

export interface CredentialRecord {
  readonly credentialId: Uint8Array;
  readonly npub: string;
  readonly createdAt: number;
}

/* ------------------------------------------------------------------ */
/* Enrolment                                                           */
/* ------------------------------------------------------------------ */

/**
 * Step 1 of enrolment: create a discoverable passkey with PRF requested.
 *
 * `extensions: { prf: {} }` — the empty object is what enables the extension
 * at registration time. The authenticator reports support via
 * `getClientExtensionResults().prf.enabled`.
 */
export async function createPrfCredential(
  cfg: SignerConfig,
  user: { id: Uint8Array; name: string; displayName: string },
): Promise<Uint8Array> {
  assertSignerOrigin(cfg.origin);

  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge: challenge(),
      rp: { id: rpIdFromOrigin(cfg.origin), name: cfg.rpName },
      user: {
        id: asBufferSource(user.id),
        name: user.name,
        displayName: user.displayName,
      },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },   // ES256
        { type: 'public-key', alg: -257 }, // RS256
      ],
      authenticatorSelection: {
        residentKey: 'required',
        requireResidentKey: true,
        userVerification: 'required',
      },
      extensions: { prf: {} },
    },
  })) as PublicKeyCredential | null;

  if (!cred) throw new PrfUnsupportedError('Credential creation returned null');

  const ext = cred.getClientExtensionResults() as any;
  if (ext?.prf?.enabled !== true) {
    throw new PrfUnsupportedError(
      'Authenticator does not support PRF. Route the user to Tier 0 (NIP-07) ' +
        'or Tier 2 (NIP-46). Do NOT fall back to a weaker derivation.',
    );
  }
  return new Uint8Array(cred.rawId);
}

/**
 * Step 2: evaluate the PRF. Returns 32 bytes of hardware-bound secret.
 *
 * Some authenticators advertise PRF at create() and then return nothing at
 * get(). That case is fatal to enrolment and MUST NOT be worked around.
 */
export async function evaluatePrf(
  cfg: SignerConfig,
  credentialId: Uint8Array,
): Promise<Uint8Array> {
  assertSignerOrigin(cfg.origin);

  const assertion = (await navigator.credentials.get({
    publicKey: {
      challenge: challenge(),
      rpId: rpIdFromOrigin(cfg.origin),
      allowCredentials: [{ id: asBufferSource(credentialId), type: 'public-key' }],
      userVerification: 'required',
      // `eval` is valid with a non-empty allowCredentials. `evalByCredential`
      // is the alternative, but it MUST be empty when allowCredentials is
      // empty or the call throws NotSupportedError.
      extensions: { prf: { eval: { first: prfSalt() } } },
    },
  })) as PublicKeyCredential | null;

  if (!assertion) throw new PrfAdvertisedButAbsentError();

  const ext = assertion.getClientExtensionResults() as any;
  const first: ArrayBuffer | undefined = ext?.prf?.results?.first;
  if (!first) throw new PrfAdvertisedButAbsentError();

  const out = new Uint8Array(first);
  if (out.length !== 32) {
    throw new PrfUnsupportedError(`PRF returned ${out.length} bytes, expected 32`);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Full enrolment, backup-gated                                        */
/* ------------------------------------------------------------------ */

export interface BackupConfirmation {
  /** Resolves true only after the user has demonstrably secured the nsec:
   *  downloaded an Argon2id-encrypted keyfile, or passed a re-entry challenge. */
  confirm(identity: Identity): Promise<boolean>;
}

/**
 * §3.2.3 — enrolment MUST NOT complete until a backup exists.
 *
 * PRF output is credential-bound: losing the passkey destroys the identity.
 * Platform passkeys sync via iCloud Keychain / Google Password Manager, which
 * covers device loss but not account loss. The backup is the difference
 * between "sovereign" and "sovereign until you change phone vendors".
 */
export async function enrol(
  cfg: SignerConfig,
  user: { id: Uint8Array; name: string; displayName: string },
  backup: BackupConfirmation,
): Promise<CredentialRecord> {
  const credentialId = await createPrfCredential(cfg, user);

  // Verify PRF really works before we let the user rely on it.
  const prfOut = await evaluatePrf(cfg, credentialId);
  const identity = identityFromPrf(prfOut, credentialId);

  const ok = await backup.confirm(identity);
  prfOut.fill(0);
  identity.secretKey.fill(0);
  if (!ok) throw new BackupNotConfirmedError();

  return { credentialId, npub: identity.npub, createdAt: Math.floor(Date.now() / 1000) };
}
