<?php
/**
 * Nostr event validation (NIP-01).
 *
 * The node accepts signed events over HTTP rather than opening relay
 * websockets, because PHP hosting and long-lived websockets get along badly.
 * That means the node MUST check the signature itself — an ingest endpoint that
 * trusts its input is an open forgery gate.
 *
 * @package XOnly_Node
 */

defined( 'ABSPATH' ) || defined( 'XONLY_CLI' ) || exit;

require_once __DIR__ . '/class-xonly-schnorr.php';

final class XOnly_Event {

	/**
	 * NIP-01 canonical serialization:
	 *   [0, pubkey, created_at, kind, tags, content]
	 *
	 * JSON_UNESCAPED_SLASHES and JSON_UNESCAPED_UNICODE are REQUIRED. PHP
	 * escapes forward slashes and non-ASCII by default, and either one changes
	 * the bytes, which changes the id, which makes every signature look invalid.
	 */
	public static function serialize( array $e ): string {
		return wp_json_encode_compat(
			array(
				0,
				(string) $e['pubkey'],
				(int) $e['created_at'],
				(int) $e['kind'],
				$e['tags'],
				(string) $e['content'],
			)
		);
	}

	public static function compute_id( array $e ): string {
		return hash( 'sha256', self::serialize( $e ) );
	}

	/**
	 * Full validation: shape, id, signature.
	 *
	 * @return array{valid:bool,reason:string,ms:int}
	 */
	public static function validate( array $e ): array {
		$t0 = microtime( true );

		$fail = function ( string $why ) use ( $t0 ): array {
			return array(
				'valid'  => false,
				'reason' => $why,
				'ms'     => (int) round( ( microtime( true ) - $t0 ) * 1000 ),
			);
		};

		foreach ( array( 'id', 'pubkey', 'sig', 'kind', 'created_at', 'tags', 'content' ) as $k ) {
			if ( ! array_key_exists( $k, $e ) ) {
				return $fail( "missing field: {$k}" );
			}
		}
		if ( ! is_array( $e['tags'] ) ) {
			return $fail( 'tags must be an array' );
		}
		if ( ! preg_match( '/^[0-9a-f]{64}$/', (string) $e['id'] ) ) {
			return $fail( 'malformed id' );
		}
		if ( ! preg_match( '/^[0-9a-f]{64}$/', (string) $e['pubkey'] ) ) {
			return $fail( 'malformed pubkey' );
		}
		if ( ! preg_match( '/^[0-9a-f]{128}$/', (string) $e['sig'] ) ) {
			return $fail( 'malformed sig' );
		}

		$computed = self::compute_id( $e );
		if ( ! hash_equals( $computed, (string) $e['id'] ) ) {
			return $fail( "id mismatch (computed {$computed})" );
		}

		$ok = XOnly_Schnorr::verify(
			hex2bin( $e['id'] ),
			hex2bin( $e['pubkey'] ),
			hex2bin( $e['sig'] )
		);
		if ( ! $ok ) {
			return $fail( 'signature verification failed' );
		}

		return array(
			'valid'  => true,
			'reason' => '',
			'ms'     => (int) round( ( microtime( true ) - $t0 ) * 1000 ),
		);
	}

	/** First value of a given tag name. */
	public static function tag( array $e, string $name ): ?string {
		foreach ( $e['tags'] as $t ) {
			if ( isset( $t[0], $t[1] ) && $t[0] === $name ) {
				return (string) $t[1];
			}
		}
		return null;
	}

	/** All values for a repeated tag. */
	public static function tags( array $e, string $name ): array {
		$out = array();
		foreach ( $e['tags'] as $t ) {
			if ( isset( $t[0], $t[1] ) && $t[0] === $name ) {
				$out[] = (string) $t[1];
			}
		}
		return $out;
	}
}

/**
 * json_encode with the flags NIP-01 requires, usable outside WordPress so the
 * serializer can be unit-tested from the CLI.
 */
if ( ! function_exists( 'wp_json_encode_compat' ) ) {
	function wp_json_encode_compat( $data ): string {
		return json_encode( $data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE );
	}
}
