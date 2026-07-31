/**
 * Re-export only. The canonical surface lives in ../../../sdk.
 *
 * This file used to be a copy, and there were three of them. Three copies of a
 * signing interface is three versions of the security properties, diverging
 * quietly. The shim stays so app code keeps importing `./sdk/types.js`.
 */
export * from '../../../sdk/src/types.js';
