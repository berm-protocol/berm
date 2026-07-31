/**
 * @berm/crypto — Berm v2 identity primitives.
 *
 * Public surface. Note what is NOT here: nothing accepts or returns a private
 * key derived from a public identifier, and the v1 quarantine module is not
 * re-exported. Mini-apps never import this package at all — they use
 * `window.berm` (Berm v2 §5.4), which reaches the signer over NIP-46.
 */

export {
  SECP256K1_ORDER,
  PRF_SALT_IDENTITY,
  HKDF_SALT_IDENTITY,
  MAX_SCALAR_ATTEMPTS,
  D_TAG_PATTERN,
  nip39ProofText,
} from './constants.js';

export {
  XnsbError,
  PrfUnsupportedError,
  PrfAdvertisedButAbsentError,
  WrongOriginError,
  ScalarDerivationExhaustedError,
  BackupNotConfirmedError,
  BindingVerificationError,
} from './errors.js';

export {
  type Identity,
  type Kdf,
  hkdfSha256,
  isValidScalar,
  buildInfo,
  deriveSecretKey,
  identityFromPrf,
} from './derive.js';

export { assertSignerOrigin, rpIdFromOrigin, type OriginLike } from './origin.js';

// v2.1 §1 — multi-device. Additive: the primary derivation above is unchanged.
export {
  type WrappedKey,
  type RegisteredCredential,
  type IdentityRegistry,
  WrapError,
  UnwrapFailedError,
  HKDF_SALT_WRAP,
  WRAP_ALG,
  deriveKek,
  wrapKey,
  unwrapKey,
  unlock,
  addCredential,
  removeCredential,
} from './wrap.js';

export {
  type SignerConfig,
  type CredentialRecord,
  type BackupConfirmation,
  createPrfCredential,
  evaluatePrf,
  enrol,
} from './webauthn.js';

export {
  type EventTemplate,
  type UnsignedEvent,
  type SignedEvent,
  serializeEvent,
  eventId,
  assertConformantDTag,
  assertCommentKind,
  KIND,
} from './event.js';

export {
  type Platform,
  type IdentityClaim,
  type BindingState,
  buildClaimTag,
  parseClaimTags,
  proofText,
  proofUrl,
  proofTextMatches,
  resolveBindingState,
  shareIntentUrl,
} from './nip39.js';
