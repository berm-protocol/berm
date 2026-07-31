/**
 * `ws` ships no types, and the SDK's relay module imports it for the Node
 * fallback path. Same shim the SDK carries; needed here because this package
 * typechecks the SDK sources it imports rather than a built .d.ts.
 */
declare module 'ws';
