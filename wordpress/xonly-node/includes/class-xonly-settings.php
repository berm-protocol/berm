<?php
/**
 * Node configuration and the admin screen.
 *
 * @package XOnly_Node
 */

defined( 'ABSPATH' ) || exit;

final class XOnly_Settings {

	const OPTION = 'xonly_node_settings';

	public static function defaults(): array {
		return array(
			'x_client_id'       => '',
			'x_client_secret'   => '',
			'signer_origin'     => 'https://signer.xonly.ai',
			'relays'            => "wss://nos.lol\nwss://relay.primal.net\nwss://relay.damus.io",
			'enable_x_articles' => false,
			'nip05_root_pubkey' => '',
			'path_prefix'       => '@',
		);
	}

	public static function all(): array {
		return wp_parse_args( get_option( self::OPTION, array() ), self::defaults() );
	}

	public static function get( string $key ) {
		$all = self::all();
		return $all[ $key ] ?? null;
	}

	public static function relays(): array {
		$raw = (string) self::get( 'relays' );
		$out = array();
		foreach ( preg_split( '/\R/', $raw ) as $line ) {
			$line = trim( $line );
			if ( $line && preg_match( '#^wss?://#', $line ) ) {
				$out[] = $line;
			}
		}
		return $out;
	}

	/** Per-site secret for the X-ID pseudonym HMAC. Generated once. */
	public static function site_secret(): string {
		$s = get_option( 'xonly_site_secret' );
		if ( ! $s ) {
			$s = bin2hex( random_bytes( 32 ) );
			add_option( 'xonly_site_secret', $s, '', false );
		}
		return $s;
	}

	public static function init(): void {
		add_action( 'admin_menu', array( __CLASS__, 'menu' ) );
		add_action( 'admin_init', array( __CLASS__, 'register' ) );
	}

	public static function menu(): void {
		add_options_page( 'XOnly Node', 'XOnly Node', 'manage_options', 'xonly-node', array( __CLASS__, 'page' ) );
	}

	public static function register(): void {
		register_setting( 'xonly_node', self::OPTION, array( 'sanitize_callback' => array( __CLASS__, 'sanitize' ) ) );
	}

	public static function sanitize( $input ): array {
		$out = self::defaults();
		$out['x_client_id']       = sanitize_text_field( $input['x_client_id'] ?? '' );
		$out['x_client_secret']   = sanitize_text_field( $input['x_client_secret'] ?? '' );
		$out['signer_origin']     = esc_url_raw( $input['signer_origin'] ?? '' );
		$out['relays']            = sanitize_textarea_field( $input['relays'] ?? '' );
		$out['enable_x_articles'] = ! empty( $input['enable_x_articles'] );
		$out['nip05_root_pubkey'] = preg_replace( '/[^0-9a-f]/', '', strtolower( $input['nip05_root_pubkey'] ?? '' ) );
		$out['path_prefix']       = preg_replace( '/[^a-zA-Z0-9@_-]/', '', $input['path_prefix'] ?? '@' );
		return $out;
	}

	public static function page(): void {
		$s = self::all();
		?>
		<div class="wrap">
			<h1>XOnly Node</h1>

			<div class="notice notice-info inline" style="padding:12px 14px;margin:16px 0">
				<p style="margin:0 0 6px"><strong>What this node does and does not hold.</strong></p>
				<p style="margin:0">
					It stores signed articles it has verified itself, and a one-way pseudonym for each
					signed-in X account. It never receives a private key, never stores a raw X user ID,
					and never signs anything. If that stops being true, it is a bug.
				</p>
			</div>

			<table class="form-table" role="presentation">
				<tr>
					<th>Signature backend</th>
					<td>
						<code><?php echo esc_html( XOnly_Schnorr::backend() ); ?></code>
						<?php if ( 'pure-php' === XOnly_Schnorr::backend() ) : ?>
							<p class="description">
								GMP is not installed, so verification uses the bundled arithmetic
								(~130&nbsp;ms per article, once, at publish). Installing the GMP
								extension makes it faster but is not required.
							</p>
						<?php endif; ?>
					</td>
				</tr>
				<tr>
					<th>Card images</th>
					<td>
						<?php echo XOnly_Card::available() ? '<code>GD available</code>' : '<code style="color:#b32d2e">GD missing — cards cannot be generated</code>'; ?>
					</td>
				</tr>
				<tr>
					<th>OAuth redirect URI</th>
					<td><code><?php echo esc_html( XOnly_OAuth::redirect_uri() ); ?></code>
						<p class="description">Paste this into your X app settings.</p></td>
				</tr>
			</table>

			<form method="post" action="options.php">
				<?php settings_fields( 'xonly_node' ); ?>
				<table class="form-table" role="presentation">
					<tr>
						<th><label for="cid">X client ID</label></th>
						<td><input id="cid" class="regular-text" name="<?php echo esc_attr( self::OPTION ); ?>[x_client_id]"
							value="<?php echo esc_attr( $s['x_client_id'] ); ?>"></td>
					</tr>
					<tr>
						<th><label for="csec">X client secret</label></th>
						<td><input id="csec" type="password" class="regular-text" name="<?php echo esc_attr( self::OPTION ); ?>[x_client_secret]"
							value="<?php echo esc_attr( $s['x_client_secret'] ); ?>"></td>
					</tr>
					<tr>
						<th><label for="signer">Signer origin</label></th>
						<td><input id="signer" class="regular-text" name="<?php echo esc_attr( self::OPTION ); ?>[signer_origin]"
							value="<?php echo esc_attr( $s['signer_origin'] ); ?>">
							<p class="description">Where key custody lives. This node never talks to it directly &mdash; the browser does.</p></td>
					</tr>
					<tr>
						<th><label for="relays">Relays</label></th>
						<td><textarea id="relays" rows="4" class="large-text code" name="<?php echo esc_attr( self::OPTION ); ?>[relays]"><?php echo esc_textarea( $s['relays'] ); ?></textarea>
							<p class="description">One per line. At least three, from at least two operators.</p></td>
					</tr>
					<tr>
						<th>X Articles</th>
						<td><label><input type="checkbox" name="<?php echo esc_attr( self::OPTION ); ?>[enable_x_articles]"
							value="1" <?php checked( $s['enable_x_articles'] ); ?>>
							Request <code>tweet.write</code> so authors can publish a native X Article</label>
							<p class="description">Only ever on an explicit click by the author. No scheduled or unattended posting.</p></td>
					</tr>
					<tr>
						<th><label for="nip05">NIP-05 root pubkey</label></th>
						<td><input id="nip05" class="regular-text code" name="<?php echo esc_attr( self::OPTION ); ?>[nip05_root_pubkey]"
							value="<?php echo esc_attr( $s['nip05_root_pubkey'] ); ?>">
							<p class="description">Served at <code>/.well-known/nostr.json?name=_</code>.</p></td>
					</tr>
				</table>
				<?php submit_button(); ?>
			</form>
		</div>
		<?php
	}
}
