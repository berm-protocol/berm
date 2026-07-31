<?php
/**
 * Plugin Name:       XOnly Node
 * Plugin URI:        https://xonly.ai
 * Description:       Turns this site into a sovereign node: sign in with X, publish articles you own to Nostr, and serve canonical pages with correct card metadata. Never touches a private key.
 * Version:           0.1.0
 * Requires at least: 6.0
 * Requires PHP:      8.0
 * Author:            XOnly
 * License:           MIT
 * Text Domain:       xonly-node
 *
 * WHAT THIS PLUGIN MAY DO (Berm v2 §5.2), exhaustively:
 *   1. Run the X OAuth 2.0 + PKCE handshake.
 *   2. Call /2/users/me once, keep the handle, discard the token.
 *   3. Verify NIP-39 claims (Channel B).
 *   4. Hold node configuration.
 *   5. Verify and store signed articles, and render them.
 *
 * WHAT IT MUST NEVER DO:
 *   - Touch a private key, in any form, ever.
 *   - Persist a raw X user ID.
 *   - Sign anything.
 *   - Treat wp_posts as the source of truth for user content.
 *
 * @package XOnly_Node
 */

defined( 'ABSPATH' ) || exit;

define( 'XONLY_VERSION', '0.1.0' );
define( 'XONLY_FILE', __FILE__ );
define( 'XONLY_DIR', plugin_dir_path( __FILE__ ) );
define( 'XONLY_URL', plugin_dir_url( __FILE__ ) );

require_once XONLY_DIR . 'includes/crypto/class-xonly-bignum.php';
require_once XONLY_DIR . 'includes/crypto/class-xonly-schnorr.php';
require_once XONLY_DIR . 'includes/crypto/class-xonly-event.php';
require_once XONLY_DIR . 'includes/class-xonly-settings.php';
require_once XONLY_DIR . 'includes/class-xonly-oauth.php';
require_once XONLY_DIR . 'includes/class-xonly-nip39.php';
require_once XONLY_DIR . 'includes/class-xonly-store.php';
require_once XONLY_DIR . 'includes/class-xonly-render.php';
require_once XONLY_DIR . 'includes/class-xonly-card.php';
require_once XONLY_DIR . 'includes/class-xonly-rest.php';
require_once XONLY_DIR . 'includes/class-xonly-routes.php';

XOnly_Settings::init();
XOnly_OAuth::init();
XOnly_REST::init();
XOnly_Routes::init();

register_activation_hook(
	__FILE__,
	function () {
		XOnly_Store::install();
		XOnly_Routes::rules();
		flush_rewrite_rules();
	}
);

register_deactivation_hook( __FILE__, 'flush_rewrite_rules' );

/**
 * [xonly_editor] — drops the editor onto a page.
 *
 * The bundle is enqueued with Subresource Integrity from a build manifest, and
 * only ever from this origin. No CDN (Berm v2 §6): if the editor could be
 * swapped by a third party, "check it yourself in devtools" would be a lie.
 */
add_shortcode(
	'xonly_editor',
	function () {
		$session = XOnly_OAuth::session();

		if ( ! $session ) {
			return '<div class="xonly-signin"><a class="xonly-btn" href="'
				. esc_url( XOnly_OAuth::authorize_url() ) . '">Sign in with X to start writing</a></div>';
		}

		$manifest = XONLY_DIR . 'assets/manifest.json';
		$sri      = '';
		if ( file_exists( $manifest ) ) {
			$m   = json_decode( file_get_contents( $manifest ), true );
			$sri = $m['editor.js'] ?? '';
		}

		wp_enqueue_script( 'xonly-editor', XONLY_URL . 'assets/editor.js', array(), XONLY_VERSION, true );

		if ( $sri ) {
			add_filter(
				'script_loader_tag',
				function ( $tag, $handle ) use ( $sri ) {
					if ( 'xonly-editor' !== $handle ) {
						return $tag;
					}
					return str_replace( ' src=', ' integrity="' . esc_attr( $sri ) . '" crossorigin="anonymous" src=', $tag );
				},
				10,
				2
			);
		}

		wp_localize_script(
			'xonly-editor',
			'XONLY_NODE',
			array(
				'restUrl'      => esc_url_raw( rest_url( XOnly_REST::NS ) ),
				'nonce'        => wp_create_nonce( 'wp_rest' ),
				'signerOrigin' => XOnly_Settings::get( 'signer_origin' ),
				'relays'       => XOnly_Settings::relays(),
				'handle'       => $session['handle'],
				'name'         => $session['name'],
				'xArticles'    => (bool) XOnly_Settings::get( 'enable_x_articles' ),
				// Deliberately absent: X user id, access token, anything key-shaped.
			)
		);

		return '<div id="xonly-editor-root"></div>';
	}
);
