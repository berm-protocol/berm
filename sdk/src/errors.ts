/**
 * Every error an app has to handle, named.
 *
 * These are separate classes rather than string codes because the correct UI
 * response differs for each one, and `catch (e) { alert(e.message) }` is what
 * happens when a library makes that hard.
 */

export class XnsbSdkError extends Error {
  constructor(msg: string) { super(msg); this.name = new.target.name; }
}

/** The user saw the prompt and said no. Not an error condition — a decision.
 *  Apps should return to the previous state silently, not show a red banner. */
export class UserDeclinedError extends XnsbSdkError {
  constructor() { super('The user declined the signing request'); }
}

/** The signer cannot be reached. Offer a retry; never silently downgrade to a
 *  weaker signing path, because the user chose their custody model. */
export class SignerUnavailableError extends XnsbSdkError {
  constructor(detail = 'signer unreachable') { super(detail); }
}

/** No signing path exists in this browser. The app should show onboarding,
 *  not an error — this is the state every new user starts in. */
export class NoSignerError extends XnsbSdkError {
  readonly tried: string[];
  constructor(tried: string[]) {
    super(
      'No signer available. Install a NIP-07 extension, connect a bunker, ' +
      `or use the Berm passkey signer. (tried: ${tried.join(', ') || 'nothing'})`,
    );
    this.tried = tried;
  }
}

/**
 * The development signer was constructed outside localhost.
 *
 * This exists because every "dev mode" that merely *warns* eventually ships.
 * The dev signer holds a raw key in localStorage; on a public origin that is a
 * key-theft vector, so it refuses to exist rather than logging a warning nobody
 * reads.
 */
export class DevSignerMisuseError extends XnsbSdkError {
  constructor(origin: string) {
    super(
      `Refusing to create the development signer on ${origin}. It keeps a raw ` +
      'secret key in localStorage and is for localhost only. Ship tier 0, 1 or 2.',
    );
  }
}

/** A relay accepted the connection and then rejected the event. */
export class PublishRejectedError extends XnsbSdkError {
  readonly receipt: unknown;
  constructor(detail: string, receipt: unknown) { super(detail); this.receipt = receipt; }
}
