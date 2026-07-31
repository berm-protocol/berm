<?php
/**
 * Signer gate — the node as an independent watchdog.
 *
 * WHY THIS LIVES IN THE NODE. A signer origin can serve altered JavaScript and
 * no browser will tell the user. The check has to be made by somebody who is
 * not the signer — and the node is already in the flow, because it is the node
 * that opens the signer popup for its visitors.
 *
 * That inverts the role of the "replaceable / untrusted" layer. Thousands of
 * independent WordPress installs, on thousands of networks, each verifying a
 * signer it does not control and has no incentive to cover for, is a far better
 * detection network than anything the signer's operator could run for itself.
 *
 * THREE STATES, and the middle one is the point:
 *
 *   verified     served bytes match the operator's signed attestation
 *   unattested   nothing to check against — unknown, not proven bad
 *   mismatch     served bytes differ from what was signed for → REFUSE
 *
 * A mismatch is never a warning. The node does not open the popup, and it tells
 * the visitor why in words they can act on.
 *
 * HONEST LIMIT: a signer can serve different bytes to this node than to a
 * browser, keyed on IP or user agent. Transparency makes broad tampering
 * impossible to hide and targeted tampering expensive and permanent once
 * caught. It does not make it impossible. Certificate Transparency has the same
 * shape and is still worth having.
 *
 * @package XOnly
 */

declare(strict_types=1);

defined( 'ABSPATH' ) || defined( 'XONLY_CLI' ) || exit;

class XOnly_Signer_Gate {

	const D_TAG        = 'berm:signer-build:v1';
	const CACHE_KEY    = 'xonly_signer_gate';
	const CACHE_TTL    = 900;          // 15 minutes
	const MAX_AGE      = 2592000;      // 30 days — older is treated as absent
	const FETCH_LIMIT  = 2097152;      // 2 MB; a signer bundle is far smaller

	/**
	 * Verify a signer origin against its published attestation.
	 *
	 * @param string $origin  Scheme + host, no path.
	 * @param array  $pinned  pubkey hex => true, keys allowed to speak for $origin.
	 * @param array  $events  Candidate attestation events, already fetched from relays.
	 * @return array{status:string,allow:bool,message:string,observed?:string,expected?:string,version?:string}
	 */
	public static function verify( string $origin, array $pinned, array $events ): array {
		if ( ! preg_match( '#^https://[^/]+$#', $origin ) ) {
			return self::result( 'mismatch', false, 'Signer origin must be https with no path.' );
		}

		$best = null;

		foreach ( $events as $ev ) {
			$a = self::parse( $ev, $origin, $pinned );
			if ( null === $a ) {
				continue;
			}
			// Newest valid attestation wins. Every candidate is checked rather
			// than only the newest, so a hijacker who publishes something newer
			// fails the pinned-key test instead of shadowing the genuine one.
			if ( null === $best || $a['created_at'] > $best['created_at'] ) {
				$best = $a;
			}
		}

		if ( null === $best ) {
			return self::result(
				'unattested',
				false,
				sprintf( '%s has published no build attestation this site can verify.', $origin )
			);
		}

		if ( ( time() - $best['created_at'] ) > self::MAX_AGE ) {
			// A stale attestation says nothing about what is served today.
			return self::result(
				'unattested',
				false,
				sprintf( 'The newest attestation for %s is over 30 days old.', $origin ),
				null,
				$best['sha256'],
				$best['version']
			);
		}

		$bytes = self::fetch( $origin . $best['path'] );
		if ( null === $bytes ) {
			// Cannot check and cannot reach is the worst state, never a
			// permissive one.
			return self::result(
				'unattested',
				false,
				sprintf( 'Could not fetch %s%s to check it.', $origin, $best['path'] ),
				null,
				$best['sha256'],
				$best['version']
			);
		}

		$observed = hash( 'sha256', $bytes );

		if ( ! hash_equals( $best['sha256'], $observed ) ) {
			return self::result(
				'mismatch',
				false,
				sprintf(
					'%s is serving code its operator did not sign for. Do not enter anything there.',
					$origin
				),
				$observed,
				$best['sha256'],
				$best['version']
			);
		}

		return self::result(
			'verified',
			true,
			sprintf( '%s is serving version %s, matching its published attestation.', $origin, $best['version'] ),
			$observed,
			$best['sha256'],
			$best['version']
		);
	}

	/**
	 * Validate one candidate attestation: real signature, pinned key, right origin.
	 *
	 * Reuses the node's own BIP-340 verifier — the same pure-PHP implementation
	 * that checks every event, so this needs no new cryptography and no
	 * extensions.
	 */
	private static function parse( array $ev, string $origin, array $pinned ): ?array {
		$check = XOnly_Event::validate( $ev );
		if ( empty( $check['valid'] ) ) {
			return null;
		}

		if ( self::D_TAG !== XOnly_Event::tag( $ev, 'd' ) ) {
			return null;
		}

		$pubkey = (string) ( $ev['pubkey'] ?? '' );
		if ( ! isset( $pinned[ $pubkey ] ) ) {
			// A valid signature by an unpinned key is the interesting failure:
			// somebody published a well-formed attestation for an origin they
			// do not speak for.
			return null;
		}

		$att_origin = XOnly_Event::tag( $ev, 'origin' );
		$sha        = XOnly_Event::tag( $ev, 'sha256' );
		$path       = XOnly_Event::tag( $ev, 'path' );
		$version    = XOnly_Event::tag( $ev, 'version' );

		if ( $att_origin !== $origin ) {
			return null;
		}
		if ( ! $sha || ! preg_match( '/^[0-9a-f]{64}$/', $sha ) ) {
			return null;
		}
		if ( ! $path || '/' !== $path[0] ) {
			return null;
		}

		return array(
			'origin'     => $att_origin,
			'sha256'     => $sha,
			'path'       => $path,
			'version'    => $version ? $version : '?',
			'created_at' => (int) ( $ev['created_at'] ?? 0 ),
		);
	}

	/**
	 * Overridable fetcher.
	 *
	 * Injected rather than hard-wired to wp_remote_get so the gate is testable
	 * without WordPress and without a network. A verifier that can only be
	 * exercised against the live internet is a verifier that stops being run.
	 *
	 * @var callable|null
	 */
	private static $fetcher = null;

	/** @param callable(string):?string $fn */
	public static function set_fetcher( callable $fn ): void {
		self::$fetcher = $fn;
	}

	/** Fetch the served bytes exactly. No normalisation — a byte is a byte. */
	private static function fetch( string $url ): ?string {
		if ( null !== self::$fetcher ) {
			$out = ( self::$fetcher )( $url );
			return is_string( $out ) ? $out : null;
		}

		$res = wp_remote_get(
			$url,
			array(
				'timeout'     => 10,
				'redirection' => 2,
				'headers'     => array( 'accept' => '*/*' ),
			)
		);

		if ( is_wp_error( $res ) || 200 !== wp_remote_retrieve_response_code( $res ) ) {
			return null;
		}

		$body = wp_remote_retrieve_body( $res );
		if ( strlen( $body ) > self::FETCH_LIMIT ) {
			return null;
		}
		return $body;
	}

	private static function result(
		string $status,
		bool $allow,
		string $message,
		?string $observed = null,
		?string $expected = null,
		?string $version = null
	): array {
		$out = array(
			'status'  => $status,
			'allow'   => $allow,
			'message' => $message,
		);
		if ( $observed ) {
			$out['observed'] = $observed;
		}
		if ( $expected ) {
			$out['expected'] = $expected;
		}
		if ( $version ) {
			$out['version'] = $version;
		}
		return $out;
	}
}
