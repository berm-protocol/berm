<?php
/**
 * Server-side card image, 1200x630, via GD.
 *
 * This has to run on the server because X's crawler does not execute
 * JavaScript. The editor renders the same layout on canvas for preview; this is
 * the one the crawler actually fetches.
 *
 * The crawler is anonymous — no cookies, no session — so a card can never be
 * personalised per viewer. It is personalised per URL, which is all that's
 * needed: one path, one image.
 *
 * @package XOnly_Node
 */

defined( 'ABSPATH' ) || defined( 'XONLY_CLI' ) || exit;

final class XOnly_Card {

	const W = 1200;
	const H = 630;

	public static function available(): bool {
		return extension_loaded( 'gd' ) && function_exists( 'imagecreatetruecolor' );
	}

	/**
	 * @param array $d title, subtitle, author, handle, minutes, npub_short, domain
	 * @return string|null PNG bytes, or null if GD is unavailable.
	 */
	public static function render( array $d ): ?string {
		if ( ! self::available() ) {
			return null;
		}

		$img = imagecreatetruecolor( self::W, self::H );
		imagesavealpha( $img, true );

		$bg     = imagecolorallocate( $img, 10, 11, 13 );
		$white  = imagecolorallocate( $img, 243, 244, 246 );
		$dim    = imagecolorallocate( $img, 154, 161, 173 );
		$faint  = imagecolorallocate( $img, 90, 96, 107 );
		$accent = imagecolorallocate( $img, 124, 156, 255 );
		$green  = imagecolorallocate( $img, 62, 207, 142 );
		$line   = imagecolorallocate( $img, 38, 42, 51 );

		imagefill( $img, 0, 0, $bg );

		// Top gradient rule — blue to green across the full width.
		for ( $x = 0; $x < self::W; $x++ ) {
			$t = $x / self::W;
			$c = imagecolorallocate(
				$img,
				(int) ( 124 + ( 62 - 124 ) * $t ),
				(int) ( 156 + ( 207 - 156 ) * $t ),
				(int) ( 255 + ( 142 - 255 ) * $t )
			);
			imagefilledrectangle( $img, $x, 0, $x, 5, $c );
			imagecolordeallocate( $img, $c );
		}

		$font = self::font();
		$pad  = 80;

		if ( $font ) {
			// TrueType path — the good-looking one.
			imagettftext( $img, 20, 0, $pad, 150, $faint, $font, strtoupper( $d['domain'] ?? 'XONLY.COM' ) );

			$y     = 214;
			$lines = self::wrap_ttf( $img, $font, 54, $d['title'] ?? 'Untitled', self::W - $pad * 2, 3 );
			foreach ( $lines as $l ) {
				imagettftext( $img, 54, 0, $pad, $y, $white, $font, $l );
				$y += 74;
			}

			if ( ! empty( $d['subtitle'] ) ) {
				$y += 14;
				foreach ( self::wrap_ttf( $img, $font, 26, $d['subtitle'], self::W - $pad * 2, 2 ) as $l ) {
					imagettftext( $img, 26, 0, $pad, $y, $dim, $font, $l );
					$y += 40;
				}
			}

			imageline( $img, $pad, self::H - 118, self::W - $pad, self::H - 118, $line );

			$by = $d['author'] ?? 'Anonymous';
			if ( ! empty( $d['handle'] ) ) {
				$by .= '  ·  @' . ltrim( $d['handle'], '@' );
			}
			imagettftext( $img, 25, 0, $pad, self::H - 58, $white, $font, $by );

			$meta = ( $d['minutes'] ?? 1 ) . ' min read';
			$box  = imagettfbbox( 22, 0, $font, $meta );
			imagettftext( $img, 22, 0, self::W - $pad - ( $box[2] - $box[0] ), self::H - 58, $dim, $font, $meta );

			if ( ! empty( $d['npub_short'] ) ) {
				$box = imagettfbbox( 16, 0, $font, $d['npub_short'] );
				imagettftext( $img, 16, 0, self::W - $pad - ( $box[2] - $box[0] ), self::H - 26, $faint, $font, $d['npub_short'] );
			}
		} else {
			// Bitmap fallback — ugly but never blank. A missing card image
			// means no card at all in the feed, which is worse than a plain one.
			imagestring( $img, 5, $pad, 140, strtoupper( $d['domain'] ?? 'XONLY.COM' ), $faint );
			$y = 200;
			foreach ( self::wrap_chars( $d['title'] ?? 'Untitled', 46, 3 ) as $l ) {
				imagestring( $img, 5, $pad, $y, $l, $white );
				$y += 34;
			}
			if ( ! empty( $d['subtitle'] ) ) {
				$y += 12;
				foreach ( self::wrap_chars( $d['subtitle'], 70, 2 ) as $l ) {
					imagestring( $img, 3, $pad, $y, $l, $dim );
					$y += 22;
				}
			}
			imageline( $img, $pad, self::H - 118, self::W - $pad, self::H - 118, $line );
			imagestring( $img, 4, $pad, self::H - 76, ( $d['author'] ?? '' ) . '  @' . ltrim( $d['handle'] ?? '', '@' ), $white );
			imagestring( $img, 3, $pad, self::H - 48, ( $d['minutes'] ?? 1 ) . ' min read', $dim );
		}

		ob_start();
		imagepng( $img, null, 6 );
		$png = ob_get_clean();
		imagedestroy( $img );

		return $png;
	}

	/** Find a usable TrueType font. WordPress ships none, so look around. */
	private static function font(): ?string {
		$candidates = array(
			defined( 'XONLY_DIR' ) ? XONLY_DIR . 'assets/fonts/Inter-SemiBold.ttf' : null,
			'/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
			'/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
			'/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
			'/System/Library/Fonts/Helvetica.ttc',
			'C:\\Windows\\Fonts\\arialbd.ttf',
		);
		foreach ( $candidates as $f ) {
			if ( $f && is_readable( $f ) && function_exists( 'imagettftext' ) ) {
				return $f;
			}
		}
		return null;
	}

	private static function wrap_ttf( $img, string $font, int $size, string $text, int $max, int $max_lines ): array {
		$words = preg_split( '/\s+/', trim( $text ) );
		$lines = array();
		$cur   = '';
		foreach ( $words as $w ) {
			$try = '' === $cur ? $w : "$cur $w";
			$box = imagettfbbox( $size, 0, $font, $try );
			if ( ( $box[2] - $box[0] ) <= $max ) {
				$cur = $try;
				continue;
			}
			if ( '' !== $cur ) {
				$lines[] = $cur;
			}
			$cur = $w;
			if ( count( $lines ) >= $max_lines ) {
				break;
			}
		}
		if ( '' !== $cur && count( $lines ) < $max_lines ) {
			$lines[] = $cur;
		}
		if ( count( $lines ) === $max_lines ) {
			$joined = implode( ' ', $lines );
			if ( strlen( $joined ) < strlen( trim( $text ) ) ) {
				$lines[ $max_lines - 1 ] = preg_replace( '/\s+\S*$/', '', $lines[ $max_lines - 1 ] ) . '…';
			}
		}
		return $lines;
	}

	private static function wrap_chars( string $text, int $width, int $max_lines ): array {
		$lines = explode( "\n", wordwrap( $text, $width, "\n", true ) );
		return array_slice( $lines, 0, $max_lines );
	}
}
