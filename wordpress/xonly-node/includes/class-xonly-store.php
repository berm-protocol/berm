<?php
/**
 * Storage for verified articles.
 *
 * The node caches events so pages render fast, but the cache is NOT the source
 * of truth — every row is reconstructible from relays, and the table records
 * when and how the signature was checked so the claim on the page is auditable.
 *
 * @package XOnly_Node
 */

defined( 'ABSPATH' ) || exit;

final class XOnly_Store {

	public static function table(): string {
		global $wpdb;
		return $wpdb->prefix . 'xonly_articles';
	}

	public static function install(): void {
		global $wpdb;
		require_once ABSPATH . 'wp-admin/includes/upgrade.php';

		$table   = self::table();
		$charset = $wpdb->get_charset_collate();

		dbDelta(
			"CREATE TABLE {$table} (
				id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
				event_id CHAR(64) NOT NULL,
				pubkey CHAR(64) NOT NULL,
				d_tag VARCHAR(191) NOT NULL,
				handle VARCHAR(64) NOT NULL DEFAULT '',
				title TEXT NOT NULL,
				event LONGTEXT NOT NULL,
				verified_at BIGINT UNSIGNED NULL,
				verify_backend VARCHAR(16) NOT NULL DEFAULT '',
				created_at BIGINT UNSIGNED NOT NULL,
				PRIMARY KEY (id),
				UNIQUE KEY uniq_addr (pubkey, d_tag),
				KEY idx_event (event_id),
				KEY idx_handle (handle)
			) {$charset};"
		);
	}

	/**
	 * Insert or replace an addressable article.
	 *
	 * NIP-01 replaceable-event semantics: a newer `created_at` for the same
	 * (pubkey, d) supersedes. An older one is silently ignored rather than
	 * allowed to roll a published article backwards.
	 */
	public static function put( array $event, string $handle, array $verify ): bool {
		global $wpdb;

		$d       = XOnly_Event::tag( $event, 'd' ) ?? '';
		$title   = XOnly_Event::tag( $event, 'title' ) ?? 'Untitled';
		$existing = self::get( $event['pubkey'], $d );

		if ( $existing && (int) $existing['created_at'] >= (int) $event['created_at'] ) {
			return false;
		}

		$row = array(
			'event_id'       => $event['id'],
			'pubkey'         => $event['pubkey'],
			'd_tag'          => $d,
			'handle'         => $handle,
			'title'          => $title,
			'event'          => wp_json_encode( $event ),
			'verified_at'    => $verify['valid'] ? time() : null,
			'verify_backend' => XOnly_Schnorr::backend(),
			'created_at'     => (int) $event['created_at'],
		);

		if ( $existing ) {
			return false !== $wpdb->update( self::table(), $row, array( 'id' => $existing['id'] ) );
		}
		return false !== $wpdb->insert( self::table(), $row );
	}

	public static function get( string $pubkey, string $d ): ?array {
		global $wpdb;
		$row = $wpdb->get_row(
			$wpdb->prepare( 'SELECT * FROM ' . self::table() . ' WHERE pubkey = %s AND d_tag = %s', $pubkey, $d ),
			ARRAY_A
		);
		return $row ?: null;
	}

	public static function get_by_handle_slug( string $handle, string $slug ): ?array {
		global $wpdb;
		$row = $wpdb->get_row(
			$wpdb->prepare( 'SELECT * FROM ' . self::table() . ' WHERE handle = %s AND d_tag = %s', $handle, $slug ),
			ARRAY_A
		);
		return $row ?: null;
	}

	public static function recent( int $limit = 20 ): array {
		global $wpdb;
		return $wpdb->get_results(
			$wpdb->prepare( 'SELECT * FROM ' . self::table() . ' ORDER BY created_at DESC LIMIT %d', $limit ),
			ARRAY_A
		) ?: array();
	}

	public static function decode( array $row ): array {
		return json_decode( $row['event'], true );
	}
}
