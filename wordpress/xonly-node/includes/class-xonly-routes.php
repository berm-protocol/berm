<?php
/**
 * Public URLs: article pages, card images, and the NIP-05 file.
 *
 * @package XOnly_Node
 */

defined( 'ABSPATH' ) || exit;

final class XOnly_Routes {

	public static function init(): void {
		add_action( 'init', array( __CLASS__, 'rules' ) );
		add_filter( 'query_vars', array( __CLASS__, 'vars' ) );
		add_action( 'template_redirect', array( __CLASS__, 'dispatch' ) );
	}

	public static function rules(): void {
		add_rewrite_rule( '^\.well-known/nostr\.json$', 'index.php?xonly_nip05=1', 'top' );
		add_rewrite_rule( '^xonly-og/([^/]+)/([^/]+)\.png$', 'index.php?xonly_card=1&xonly_handle=$matches[1]&xonly_slug=$matches[2]', 'top' );
		add_rewrite_rule( '^@([^/]+)/([^/]+)/?$', 'index.php?xonly_article=1&xonly_handle=$matches[1]&xonly_slug=$matches[2]', 'top' );
	}

	public static function vars( array $v ): array {
		return array_merge( $v, array( 'xonly_nip05', 'xonly_card', 'xonly_article', 'xonly_handle', 'xonly_slug' ) );
	}

	public static function article_url( string $handle, string $slug ): string {
		return home_url( '/@' . rawurlencode( $handle ) . '/' . rawurlencode( $slug ) );
	}

	public static function card_url( string $handle, string $slug ): string {
		return home_url( '/xonly-og/' . rawurlencode( $handle ) . '/' . rawurlencode( $slug ) . '.png' );
	}

	public static function dispatch(): void {
		if ( get_query_var( 'xonly_nip05' ) ) {
			self::serve_nip05();
		}
		if ( get_query_var( 'xonly_card' ) ) {
			self::serve_card();
		}
		if ( get_query_var( 'xonly_article' ) ) {
			self::serve_article();
		}
	}

	/**
	 * NIP-05.
	 *
	 * Path and CORS both matter: clients fetch this cross-origin, and without a
	 * permissive header they fail silently. `_` is the reserved name that
	 * renders as the bare domain.
	 */
	private static function serve_nip05(): void {
		$pubkey = XOnly_Settings::get( 'nip05_root_pubkey' );
		header( 'Content-Type: application/json; charset=utf-8' );
		header( 'Access-Control-Allow-Origin: *' );

		$doc = array( 'names' => new stdClass(), 'relays' => new stdClass() );
		if ( $pubkey ) {
			$doc['names']  = array( '_' => $pubkey );
			$doc['relays'] = array( $pubkey => XOnly_Settings::relays() );
		}
		echo wp_json_encode( $doc );
		exit;
	}

	private static function serve_card(): void {
		$handle = sanitize_text_field( get_query_var( 'xonly_handle' ) );
		$slug   = sanitize_text_field( get_query_var( 'xonly_slug' ) );
		$row    = XOnly_Store::get_by_handle_slug( $handle, $slug );

		if ( ! $row ) {
			status_header( 404 );
			exit;
		}

		$event = XOnly_Store::decode( $row );
		$png   = XOnly_Card::render(
			array(
				'title'      => XOnly_Event::tag( $event, 'title' ) ?? 'Untitled',
				'subtitle'   => XOnly_Event::tag( $event, 'summary' ) ?? '',
				'author'     => $handle,
				'handle'     => $handle,
				'minutes'    => max( 1, (int) round( str_word_count( wp_strip_all_tags( $event['content'] ) ) / 220 ) ),
				'npub_short' => substr( $event['pubkey'], 0, 10 ) . '…' . substr( $event['pubkey'], -6 ),
				'domain'     => wp_parse_url( home_url(), PHP_URL_HOST ),
			)
		);

		if ( ! $png ) {
			status_header( 500 );
			exit;
		}

		header( 'Content-Type: image/png' );
		header( 'Cache-Control: public, max-age=86400' );
		echo $png;
		exit;
	}

	private static function serve_article(): void {
		$handle = sanitize_text_field( get_query_var( 'xonly_handle' ) );
		$slug   = sanitize_text_field( get_query_var( 'xonly_slug' ) );
		$row    = XOnly_Store::get_by_handle_slug( $handle, $slug );

		if ( ! $row ) {
			status_header( 404 );
			return;
		}

		$event = XOnly_Store::decode( $row );
		$ctx   = array(
			'canonical'   => self::article_url( $handle, $slug ),
			'og_image'    => self::card_url( $handle, $slug ),
			'author_name' => $handle,
			'handle'      => $handle,
			'verified_at' => $row['verified_at'],
		);

		status_header( 200 );
		header( 'Content-Type: text/html; charset=utf-8' );

		echo "<!DOCTYPE html>\n<html " . get_language_attributes() . ">\n<head>\n";
		echo '<meta charset="utf-8">' . "\n";
		echo '<meta name="viewport" content="width=device-width, initial-scale=1">' . "\n";
		echo '<title>' . esc_html( XOnly_Event::tag( $event, 'title' ) ?? 'Untitled' ) . "</title>\n";
		echo XOnly_Render::card_meta( $event, $ctx ) . "\n";
		echo '<link rel="stylesheet" href="' . esc_url( XONLY_URL . 'assets/article.css' ) . '">' . "\n";
		echo "</head>\n<body class=\"xonly-page\">\n";
		echo XOnly_Render::article_html( $event, $ctx );
		echo "\n</body>\n</html>";
		exit;
	}
}
