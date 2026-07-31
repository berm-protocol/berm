<?php
/**
 * NIP-39 binding — Channel B, the live attestation (Berm v2 §3.4).
 *
 * Channel A is the public proof post, which anyone can click through and check.
 * Channel B is this: at OAuth time the node knows the authenticated handle, so
 * it can confirm the claim in the profile still matches. It catches handle
 * transfers and stale claims that Channel A alone cannot.
 *
 * The three states MUST NOT be conflated. Rendering `claimed` as `verified` is
 * an impersonation vector, not a cosmetic bug.
 *
 * @package XOnly_Node
 */

defined( 'ABSPATH' ) || exit;

final class XOnly_NIP39 {

	const VERIFIED = 'verified';
	const CLAIMED  = 'claimed';
	const UNLINKED = 'unlinked';

	/** Parse `i` tags out of a kind 0 event. Malformed tags are dropped. */
	public static function claims( array $event ): array {
		$out = array();
		foreach ( $event['tags'] as $t ) {
			if ( ! isset( $t[0], $t[1], $t[2] ) || 'i' !== $t[0] ) {
				continue;
			}
			$pos = strpos( $t[1], ':' );
			if ( false === $pos || 0 === $pos || $pos === strlen( $t[1] ) - 1 ) {
				continue;
			}
			$out[] = array(
				'platform' => substr( $t[1], 0, $pos ),
				'identity' => substr( $t[1], $pos + 1 ),
				'proof'    => $t[2],
			);
		}
		return $out;
	}

	/**
	 * @param array|null  $claim       the twitter claim found in kind 0
	 * @param string|null $live_handle handle from /2/users/me this session
	 */
	public static function state( ?array $claim, ?string $live_handle ): string {
		if ( ! $claim ) {
			return self::UNLINKED;
		}
		if ( ! $live_handle ) {
			return self::CLAIMED;
		}
		return strtolower( $claim['identity'] ) === strtolower( ltrim( $live_handle, '@' ) )
			? self::VERIFIED
			: self::CLAIMED;
	}

	/** URL a human can open to check Channel A themselves. */
	public static function proof_url( array $claim ): string {
		switch ( $claim['platform'] ) {
			case 'twitter':
				return 'https://x.com/' . rawurlencode( $claim['identity'] ) . '/status/' . rawurlencode( $claim['proof'] );
			case 'github':
				return 'https://gist.github.com/' . rawurlencode( $claim['identity'] ) . '/' . rawurlencode( $claim['proof'] );
			default:
				return '';
		}
	}

	/** The exact text NIP-39 requires in the proof post. Not ours to change. */
	public static function proof_text( string $npub ): string {
		return 'Verifying my account on nostr My Public Key: "' . $npub . '"';
	}

	public static function badge_html( string $state ): string {
		$labels = array(
			self::VERIFIED => array( 'verified', '#3ecf8e' ),
			self::CLAIMED  => array( 'claimed', '#f0b849' ),
			self::UNLINKED => array( 'unlinked', '#8b919c' ),
		);
		list( $label, $color ) = $labels[ $state ] ?? $labels[ self::UNLINKED ];
		return '<span class="xonly-badge xonly-badge-' . esc_attr( $state ) . '" style="color:' . esc_attr( $color ) . '">'
			. esc_html( $label ) . '</span>';
	}
}
