<?php
/**
 * Renders a stored NIP-23 article into a page with correct card metadata.
 *
 * This is the canonical URL: the one that survives an X suspension, the one the
 * event's `r` tag points at, and the one whose meta tags decide what the in-feed
 * card looks like.
 *
 * The renderer is intentionally a *view*. It holds no truth — everything it
 * shows comes from a signed event that was verified at ingest, and it says so
 * in the footer.
 *
 * @package XOnly_Node
 */

defined( 'ABSPATH' ) || defined( 'XONLY_CLI' ) || exit;

require_once __DIR__ . '/crypto/class-xonly-event.php';

final class XOnly_Render {

	/* ------------------------------------------------------------------ */
	/* Markdown subset                                                     */
	/* ------------------------------------------------------------------ */

	/**
	 * Convert the markdown the editor emits.
	 *
	 * Deliberately a strict subset matching the editor's block model rather
	 * than a general markdown engine: everything is escaped first and only a
	 * known set of constructs is re-introduced, so no author can inject markup
	 * through a signed event.
	 */
	public static function markdown_to_html( string $md ): string {
		$lines  = preg_split( '/\R/', $md );
		$out    = array();
		$i      = 0;
		$count  = count( $lines );

		while ( $i < $count ) {
			$line = $lines[ $i ];

			if ( '' === trim( $line ) ) {
				$i++;
				continue;
			}

			// fenced code
			if ( preg_match( '/^```/', $line ) ) {
				$buf = array();
				$i++;
				while ( $i < $count && ! preg_match( '/^```/', $lines[ $i ] ) ) {
					$buf[] = $lines[ $i ];
					$i++;
				}
				$i++;
				$out[] = '<pre><code>' . self::esc( implode( "\n", $buf ) ) . '</code></pre>';
				continue;
			}

			// horizontal rule
			if ( preg_match( '/^---+$/', trim( $line ) ) ) {
				$out[] = '<hr>';
				$i++;
				continue;
			}

			// headings
			if ( preg_match( '/^(#{1,3})\s+(.*)$/', $line, $m ) ) {
				$level = strlen( $m[1] );
				$out[] = "<h{$level}>" . self::inline( $m[2] ) . "</h{$level}>";
				$i++;
				continue;
			}

			// image
			if ( preg_match( '/^!\[(.*?)\]\((\S+?)\)$/', trim( $line ), $m ) ) {
				$out[] = '<figure><img src="' . self::esc_url( $m[2] ) . '" alt="' . self::esc( $m[1] ) . '" loading="lazy"></figure>';
				$i++;
				continue;
			}

			// blockquote
			if ( preg_match( '/^>\s?(.*)$/', $line, $m ) ) {
				$buf = array( $m[1] );
				$i++;
				while ( $i < $count && preg_match( '/^>\s?(.*)$/', $lines[ $i ], $mm ) ) {
					$buf[] = $mm[1];
					$i++;
				}
				$out[] = '<blockquote>' . self::inline( implode( ' ', $buf ) ) . '</blockquote>';
				continue;
			}

			// unordered list
			if ( preg_match( '/^[-*]\s+(.*)$/', $line, $m ) ) {
				$items = array( $m[1] );
				$i++;
				while ( $i < $count && preg_match( '/^[-*]\s+(.*)$/', $lines[ $i ], $mm ) ) {
					$items[] = $mm[1];
					$i++;
				}
				$out[] = '<ul>' . implode( '', array_map( fn( $x ) => '<li>' . self::inline( $x ) . '</li>', $items ) ) . '</ul>';
				continue;
			}

			// ordered list
			if ( preg_match( '/^\d+\.\s+(.*)$/', $line, $m ) ) {
				$items = array( $m[1] );
				$i++;
				while ( $i < $count && preg_match( '/^\d+\.\s+(.*)$/', $lines[ $i ], $mm ) ) {
					$items[] = $mm[1];
					$i++;
				}
				$out[] = '<ol>' . implode( '', array_map( fn( $x ) => '<li>' . self::inline( $x ) . '</li>', $items ) ) . '</ol>';
				continue;
			}

			// paragraph
			$out[] = '<p>' . self::inline( $line ) . '</p>';
			$i++;
		}

		return implode( "\n", $out );
	}

	/** Inline marks. Escape everything first, then re-introduce a known set. */
	private static function inline( string $s ): string {
		$s = self::esc( $s );

		// inline code first, so its contents are not further transformed
		$codes = array();
		$s     = preg_replace_callback(
			'/`([^`]+)`/',
			function ( $m ) use ( &$codes ) {
				$key           = '%%CODE' . count( $codes ) . '%%';
				$codes[ $key ] = '<code>' . $m[1] . '</code>';
				return $key;
			},
			$s
		);

		// [text](url) — only http(s), so a signed event cannot smuggle javascript:
		$s = preg_replace_callback(
			'/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/',
			fn( $m ) => '<a href="' . self::esc_url( $m[2] ) . '" rel="noopener">' . $m[1] . '</a>',
			$s
		);

		$s = preg_replace( '/\*\*(.+?)\*\*/', '<strong>$1</strong>', $s );
		$s = preg_replace( '/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/', '<em>$1</em>', $s );
		$s = preg_replace( '/~~(.+?)~~/', '<s>$1</s>', $s );

		// unescape the markdown escapes the editor emits
		$s = preg_replace( '/\\\\([\\\\`*_\[\]])/', '$1', $s );

		return strtr( $s, $codes );
	}

	private static function esc( string $s ): string {
		return htmlspecialchars( $s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8' );
	}

	/** Only http(s) survives. Anything else becomes '#'. */
	private static function esc_url( string $url ): string {
		$url = html_entity_decode( $url, ENT_QUOTES, 'UTF-8' );
		if ( ! preg_match( '#^https?://#i', $url ) ) {
			return '#';
		}
		return self::esc( $url );
	}

	/* ------------------------------------------------------------------ */
	/* Card metadata                                                       */
	/* ------------------------------------------------------------------ */

	/**
	 * X reads twitter:* and falls back to og:*, so emit both.
	 * summary_large_image is what produces the full-width card.
	 */
	public static function card_meta( array $event, array $ctx ): string {
		$title   = XOnly_Event::tag( $event, 'title' ) ?? 'Untitled';
		$summary = XOnly_Event::tag( $event, 'summary' ) ?? '';
		$image   = $ctx['og_image'] ?? XOnly_Event::tag( $event, 'image' );
		$url     = $ctx['canonical'];

		$tags = array(
			'<meta name="description" content="' . self::esc( $summary ) . '">',
			'<link rel="canonical" href="' . self::esc_url( $url ) . '">',
			'<meta property="og:type" content="article">',
			'<meta property="og:title" content="' . self::esc( $title ) . '">',
			'<meta property="og:description" content="' . self::esc( $summary ) . '">',
			'<meta property="og:url" content="' . self::esc_url( $url ) . '">',
			'<meta name="twitter:card" content="' . ( $image ? 'summary_large_image' : 'summary' ) . '">',
			'<meta name="twitter:title" content="' . self::esc( $title ) . '">',
			'<meta name="twitter:description" content="' . self::esc( $summary ) . '">',
		);

		if ( $image ) {
			$tags[] = '<meta property="og:image" content="' . self::esc_url( $image ) . '">';
			$tags[] = '<meta property="og:image:width" content="1200">';
			$tags[] = '<meta property="og:image:height" content="630">';
			$tags[] = '<meta name="twitter:image" content="' . self::esc_url( $image ) . '">';
		}
		if ( ! empty( $ctx['handle'] ) ) {
			$tags[] = '<meta name="twitter:creator" content="@' . self::esc( ltrim( $ctx['handle'], '@' ) ) . '">';
		}

		// Machine-readable sovereignty: this page is a rendering, and here is
		// where the original lives.
		$tags[] = '<meta name="nostr:pubkey" content="' . self::esc( $event['pubkey'] ) . '">';
		$d      = XOnly_Event::tag( $event, 'd' );
		if ( $d ) {
			$tags[] = '<meta name="nostr:coordinate" content="' .
				self::esc( '30023:' . $event['pubkey'] . ':' . $d ) . '">';
		}

		return implode( "\n", $tags );
	}

	/** The article body plus the provenance footer. */
	public static function article_html( array $event, array $ctx ): string {
		$title    = XOnly_Event::tag( $event, 'title' ) ?? 'Untitled';
		$summary  = XOnly_Event::tag( $event, 'summary' ) ?? '';
		$body     = self::markdown_to_html( (string) $event['content'] );
		$date     = gmdate( 'F j, Y', (int) ( XOnly_Event::tag( $event, 'published_at' ) ?? $event['created_at'] ) );
		$coord    = '30023:' . $event['pubkey'] . ':' . ( XOnly_Event::tag( $event, 'd' ) ?? '' );
		$verified = ! empty( $ctx['verified_at'] );

		$byline = self::esc( $ctx['author_name'] ?? 'Anonymous' );
		if ( ! empty( $ctx['handle'] ) ) {
			$byline .= ' &middot; @' . self::esc( ltrim( $ctx['handle'], '@' ) );
		}

		return '<article class="xonly-article">'
			. '<header><h1>' . self::esc( $title ) . '</h1>'
			. ( $summary ? '<p class="xonly-sub">' . self::esc( $summary ) . '</p>' : '' )
			. '<div class="xonly-byline">' . $byline . ' &middot; ' . $date . '</div>'
			. '</header>'
			. '<div class="xonly-body">' . $body . '</div>'
			. '<footer class="xonly-provenance">'
			. 'This page is a rendering, not the original. The article is signed and stored on the Nostr '
			. 'network at <code>' . self::esc( $coord ) . '</code>. '
			. ( $verified
				? 'This node verified the signature itself before storing it.'
				: '<strong>This node could not verify the signature.</strong>' )
			. ' If this site disappears, the work does not.'
			. '</footer>'
			. '</article>';
	}
}
