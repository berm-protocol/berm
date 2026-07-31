<?php
/**
 * X OAuth 2.0 Authorization Code Flow with PKCE.
 *
 * SCOPE OF THIS CLASS (Berm v2 §3.3, §5.2) — its output is used for exactly
 * two things: showing "signed in as @handle", and producing the live
 * attestation that turns a NIP-39 claim from `claimed` into `verified`.
 *
 * Hard rules, enforced below:
 *   - The X user ID is NEVER used as, mixed into, or allowed to influence key
 *     derivation. v1 did this and it was a total break.
 *   - The raw X user ID is NEVER persisted. Only an HMAC pseudonym is stored.
 *   - The access token is NEVER sent to the browser, and is discarded after the
 *     single /2/users/me call.
 *
 * @package XOnly_Node
 */

defined( 'ABSPATH' ) || exit;

final class XOnly_OAuth {

	const AUTHORIZE = 'https://x.com/i/oauth2/authorize';
	const TOKEN     = 'https://api.x.com/2/oauth2/token';
	const ME        = 'https://api.x.com/2/users/me';

	const SESSION_KEY = 'xonly_x_session';

	public static function init(): void {
		add_action( 'init', array( __CLASS__, 'maybe_handle_callback' ) );
	}

	/** Scopes. `tweet.write` is only requested when Article publishing is on. */
	public static function scopes(): array {
		$s = array( 'tweet.read', 'users.read', 'offline.access' );
		if ( XOnly_Settings::get( 'enable_x_articles' ) ) {
			$s[] = 'tweet.write';
		}
		return $s;
	}

	public static function redirect_uri(): string {
		return add_query_arg( 'xonly_oauth', 'callback', home_url( '/' ) );
	}

	/** Begin the flow. */
	public static function authorize_url(): string {
		$verifier  = self::base64url( random_bytes( 48 ) );
		$challenge = self::base64url( hash( 'sha256', $verifier, true ) );
		$state     = self::base64url( random_bytes( 24 ) );

		set_transient( 'xonly_pkce_' . $state, $verifier, 10 * MINUTE_IN_SECONDS );

		return add_query_arg(
			array(
				'response_type'         => 'code',
				'client_id'             => rawurlencode( XOnly_Settings::get( 'x_client_id' ) ),
				'redirect_uri'          => rawurlencode( self::redirect_uri() ),
				'scope'                 => rawurlencode( implode( ' ', self::scopes() ) ),
				'state'                 => $state,
				'code_challenge'        => $challenge,
				'code_challenge_method' => 'S256',
			),
			self::AUTHORIZE
		);
	}

	public static function maybe_handle_callback(): void {
		if ( ! isset( $_GET['xonly_oauth'] ) || 'callback' !== $_GET['xonly_oauth'] ) {
			return;
		}

		$state = isset( $_GET['state'] ) ? sanitize_text_field( wp_unslash( $_GET['state'] ) ) : '';
		$code  = isset( $_GET['code'] ) ? sanitize_text_field( wp_unslash( $_GET['code'] ) ) : '';

		$verifier = get_transient( 'xonly_pkce_' . $state );
		delete_transient( 'xonly_pkce_' . $state );

		if ( ! $verifier || ! $code ) {
			wp_safe_redirect( add_query_arg( 'xonly_auth', 'failed', home_url( '/' ) ) );
			exit;
		}

		$token = self::exchange_code( $code, $verifier );
		if ( is_wp_error( $token ) ) {
			wp_safe_redirect( add_query_arg( 'xonly_auth', 'failed', home_url( '/' ) ) );
			exit;
		}

		$me = self::fetch_me( $token );

		// The token has done its one job. Nothing keeps it.
		unset( $token );

		if ( is_wp_error( $me ) ) {
			wp_safe_redirect( add_query_arg( 'xonly_auth', 'failed', home_url( '/' ) ) );
			exit;
		}

		self::store_session( $me );
		wp_safe_redirect( remove_query_arg( array( 'xonly_oauth', 'code', 'state' ) ) );
		exit;
	}

	private static function exchange_code( string $code, string $verifier ) {
		$args = array(
			'timeout' => 15,
			'headers' => array(
				'Content-Type'  => 'application/x-www-form-urlencoded',
				'Authorization' => 'Basic ' . base64_encode(
					XOnly_Settings::get( 'x_client_id' ) . ':' . XOnly_Settings::get( 'x_client_secret' )
				),
			),
			'body'    => array(
				'grant_type'    => 'authorization_code',
				'code'          => $code,
				'redirect_uri'  => self::redirect_uri(),
				'code_verifier' => $verifier,
				'client_id'     => XOnly_Settings::get( 'x_client_id' ),
			),
		);

		$res = wp_remote_post( self::TOKEN, $args );
		if ( is_wp_error( $res ) ) {
			return $res;
		}
		$body = json_decode( wp_remote_retrieve_body( $res ), true );
		if ( empty( $body['access_token'] ) ) {
			return new WP_Error( 'xonly_token', 'No access token in response' );
		}
		return $body['access_token'];
	}

	/** The single permitted read. No timelines, no followers, no search. */
	private static function fetch_me( string $token ) {
		$res = wp_remote_get(
			self::ME . '?user.fields=profile_image_url,name,username',
			array(
				'timeout' => 15,
				'headers' => array( 'Authorization' => 'Bearer ' . $token ),
			)
		);
		if ( is_wp_error( $res ) ) {
			return $res;
		}
		$body = json_decode( wp_remote_retrieve_body( $res ), true );
		if ( empty( $body['data']['id'] ) ) {
			return new WP_Error( 'xonly_me', 'Malformed /2/users/me response' );
		}
		return $body['data'];
	}

	/**
	 * Persist ONLY what is safe.
	 *
	 * The raw numeric X ID never lands in the database. A site-secret HMAC
	 * gives a stable local pseudonym without letting a database leak become an
	 * X-account correlation list.
	 */
	private static function store_session( array $me ): void {
		if ( ! session_id() && ! headers_sent() ) {
			@session_start();
		}
		$_SESSION[ self::SESSION_KEY ] = array(
			'pseudonym' => self::pseudonym( (string) $me['id'] ),
			'handle'    => isset( $me['username'] ) ? sanitize_text_field( $me['username'] ) : '',
			'name'      => isset( $me['name'] ) ? sanitize_text_field( $me['name'] ) : '',
			'avatar'    => isset( $me['profile_image_url'] ) ? esc_url_raw( $me['profile_image_url'] ) : '',
			'at'        => time(),
		);
	}

	/** Truncated HMAC under a per-site secret. Not reversible to an X ID. */
	public static function pseudonym( string $x_user_id ): string {
		return substr( hash_hmac( 'sha256', $x_user_id, XOnly_Settings::site_secret() ), 0, 32 );
	}

	public static function session(): ?array {
		if ( ! session_id() && ! headers_sent() ) {
			@session_start();
		}
		return $_SESSION[ self::SESSION_KEY ] ?? null;
	}

	public static function logout(): void {
		if ( ! session_id() && ! headers_sent() ) {
			@session_start();
		}
		unset( $_SESSION[ self::SESSION_KEY ] );
	}

	private static function base64url( string $bin ): string {
		return rtrim( strtr( base64_encode( $bin ), '+/', '-_' ), '=' );
	}
}
