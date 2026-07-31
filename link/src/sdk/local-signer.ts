/**
 * Re-export only. The canonical dev signer lives in ../../../sdk.
 *
 * `createLocalSigner` is kept as an alias for `createDevSigner` so existing app
 * code is unchanged. The name changed in the SDK because "local" sounded like a
 * deployment choice; "dev" says what it is — a raw key in localStorage that
 * refuses to load anywhere but localhost.
 */
export {
  createDevSigner as createLocalSigner,
  createDevSigner,
  describeForApproval,
  isLocalOrigin,
  type DevSignerOptions,
  type DevSignerOptions as LocalSignerOptions,
} from '../../../sdk/src/backends/dev.js';
