<?php
/**
 * REST ingest.
 *
 * The browser publishes to relays AND posts the signed event here so the node
 * can render a canonical page. The node opens no websockets — PHP hosting and
 * long-lived connections get along badly — which makes self-verification
 * mandatory rather than optional. An ingest endpoint that trusts its input is
 * an open forgery gate.
 *
 * Two independent gates:
 *   1. Authorisation — an X session, and the author may only write under a
 *      handle they are actually signed in as.
 *   2. Verification  — the signature is checked here, in PHP, every time.
 *
 * Either alone would be weaker than both.
 *
 * @package XOnly_Node
 */

defined( 'ABSPATH' ) || exit;

final class XOnly_REST {

	const NS = 'xonly/v1';

	public static function init(): void {
		add_action( 'rest_api_init', array( __CLASS__, 'routes' ) );
	}

	public static function routes(): void {
		register_rest_route(
			self::NS,
			'/publish',
			array(
				'methods'             => 'POST',
				'callback'            => array( __CLASS__, 'publish' ),
				'permission_callback' => array( __CLASS__, 'can_publish' ),
			)
		);

		register_rest_route(
			self::NS,
			'/session',
			array(
				'methods'             => 'GET',
				'callback'            => array( __CLASS__, 'session' ),
				'permission_callback' => '__return_true',
			)
		);
	}

	/** An X session is required. Anonymous ingest would let anyone fill the node. */
	public static function can_publish(): bool {
		return null !== XOnly_OAuth::session();
	}

	public static function session( WP_REST_Request $r ) {
		$s = XOnly_OAuth::session();
		if ( ! $s ) {
			return new WP_REST_Response( array( 'signed_in' => false ), 200 );
		}
		return new WP_REST_Response(
			array(
				'signed_in'     => true,
				'handle'        => $s['handle'],
				'name'          => $s['name'],
				'avatar'        => $s['avatar'],
				'signer_origin' => XOnly_Settings::get( 'signer_origin' ),
				'relays'        => XOnly_Settings::relays(),
				// Note what is absent: no X user id, no token, no key material.
			),
			200
		);
	}

	public static function publish( WP_REST_Request $r ) {
		$event = $r->get_json_params()['event'] ?? null;

		if ( ! is_array( $event ) ) {
			return new WP_REST_Response( array( 'ok' => false, 'error' => 'missing event' ), 400 );
		}
		if ( 30023 !== (int) ( $event['kind'] ?? 0 ) ) {
			return new WP_REST_Response( array( 'ok' => false, 'error' => 'only kind 30023 is accepted here' ), 400 );
		}

		// Gate 2: verify the signature ourselves, always.
		$verify = XOnly_Event::validate( $event );
		if ( ! $verify['valid'] ) {
			return new WP_REST_Response(
				array( 'ok' => false, 'error' => 'invalid event: ' . $verify['reason'] ),
				400
			);
		}

		$session = XOnly_OAuth::session();
		$handle  = $session['handle'] ?? '';

		$d = XOnly_Event::tag( $event, 'd' );
		if ( ! $d ) {
			return new WP_REST_Response( array( 'ok' => false, 'error' => 'addressable event needs a d tag' ), 400 );
		}

		$stored = XOnly_Store::put( $event, $handle, $verify );

		return new WP_REST_Response(
			array(
				'ok'             => true,
				'stored'         => $stored,
				'reason'         => $stored ? '' : 'an equal or newer revision already exists',
				'url'            => XOnly_Routes::article_url( $handle, $d ),
				'og_image'       => XOnly_Routes::card_url( $handle, $d ),
				'verified'       => true,
				'verify_ms'      => $verify['ms'],
				'verify_backend' => XOnly_Schnorr::backend(),
			),
			200
		);
	}
}
