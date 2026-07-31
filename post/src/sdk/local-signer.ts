/**
 * Re-export only. The canonical dev signer lives in ../../../sdk.
 *
 * It keeps a raw key in localStorage and throws `DevSignerMisuseError` anywhere
 * but localhost — not a warning, because every dev mode that merely warns
 * eventually ships, and this one leaks a private key when it does.
 */
export {
  createDevSigner as createLocalSigner,
  createDevSigner,
  describeForApproval,
  isLocalOrigin,
  type DevSignerOptions,
} from '../../../sdk/src/backends/dev.js';
