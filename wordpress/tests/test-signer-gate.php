<?php
/**
 * The node as watchdog.
 *
 * Attestations are signed by nostr-tools and verified here by the node's own
 * pure-PHP BIP-340 implementation. That cross-language check is the point: a
 * gate that only agrees with the library that produced its inputs proves
 * nothing about what a real signer publishes.
 *
 * The cases that matter are adversarial — a hijacked origin serving altered
 * code, an attacker publishing a newer attestation with their own key, and a
 * stale attestation being mistaken for current.
 */

define( 'XONLY_CLI', true );
require_once __DIR__ . '/../xonly-node/includes/crypto/class-xonly-event.php';
require_once __DIR__ . '/../xonly-node/includes/class-xonly-signer-gate.php';

$fx = json_decode( file_get_contents( __DIR__ . '/../../signer-log/gate-fixtures.json' ), true );

$origin  = $fx['origin'];
$pinned  = array( $fx['releasePub'] => true );
$genuine = $fx['genuine'];

$pass = 0;
$fail = 0;

function check( string $name, bool $ok, string $detail = '' ): void {
	global $pass, $fail;
	printf( "  %s  %-52s %s\n", $ok ? 'PASS' : 'FAIL', $name, $detail );
	$ok ? $pass++ : $fail++;
}

/** Serve a fixed body regardless of URL. */
function serving( string $body ): callable {
	return function ( string $url ) use ( $body ) {
		return $body;
	};
}

echo "\nsigner gate — PHP " . PHP_VERSION . ', backend ' . XOnly_Schnorr::backend() . "\n";
echo str_repeat( '-', 72 ) . "\n";

/* ---- the happy path ---- */
XOnly_Signer_Gate::set_fetcher( serving( $fx['goodBody'] ) );
$r = XOnly_Signer_Gate::verify( $origin, $pinned, array( $genuine ) );
check( 'matching bytes verify', 'verified' === $r['status'] && $r['allow'], $r['status'] );
check( 'version is reported', '2.4.1' === ( $r['version'] ?? '' ), $r['version'] ?? '-' );

/* ---- the scenario this exists for ---- */
XOnly_Signer_Gate::set_fetcher( serving( $fx['evilBody'] ) );
$r = XOnly_Signer_Gate::verify( $origin, $pinned, array( $genuine ) );
check( 'altered code is a MISMATCH', 'mismatch' === $r['status'], $r['status'] );
check( 'mismatch BLOCKS', false === $r['allow'] );
check( 'observed hash is reported', ( $r['observed'] ?? '' ) === $fx['evilHash'] );
check( 'message tells the visitor what to do', (bool) preg_match( '/Do not enter anything/', $r['message'] ) );

/* ---- an attacker with the origin but not the release key ---- */
XOnly_Signer_Gate::set_fetcher( serving( $fx['evilBody'] ) );
$r = XOnly_Signer_Gate::verify( $origin, $pinned, array( $fx['forgedNewer'], $genuine ) );
check( 'a newer forged attestation cannot launder a mismatch', 'mismatch' === $r['status'], $r['status'] );

XOnly_Signer_Gate::set_fetcher( serving( $fx['goodBody'] ) );
$r = XOnly_Signer_Gate::verify( $origin, $pinned, array( $fx['forgedNewer'], $genuine ) );
check( 'a forged attestation does not shadow the genuine one', 'verified' === $r['status'], $r['status'] );

/* ---- attestations that must be ignored ---- */
XOnly_Signer_Gate::set_fetcher( serving( $fx['goodBody'] ) );
$r = XOnly_Signer_Gate::verify( $origin, $pinned, array( $fx['wrongOrigin'] ) );
check( 'an attestation for another origin is ignored', 'unattested' === $r['status'], $r['status'] );

$r = XOnly_Signer_Gate::verify( $origin, $pinned, array( $fx['stale'] ) );
check( 'a stale attestation is treated as absent', 'unattested' === $r['status'], $r['status'] );
check( 'stale still blocks', false === $r['allow'] );

$r = XOnly_Signer_Gate::verify( $origin, array( $fx['attackerPub'] => true ), array( $genuine ) );
check( 'the genuine key is rejected when not pinned', 'unattested' === $r['status'], $r['status'] );

$r = XOnly_Signer_Gate::verify( $origin, $pinned, array() );
check( 'no attestation fails CLOSED', 'unattested' === $r['status'] && false === $r['allow'] );

/* ---- tampering with the event itself ---- */
$tampered = $genuine;
foreach ( $tampered['tags'] as $i => $t ) {
	if ( 'sha256' === $t[0] ) {
		$tampered['tags'][ $i ][1] = $fx['evilHash'];
	}
}
XOnly_Signer_Gate::set_fetcher( serving( $fx['evilBody'] ) );
$r = XOnly_Signer_Gate::verify( $origin, $pinned, array( $tampered ) );
check( 'a tampered attestation fails signature verification', 'unattested' === $r['status'], $r['status'] );

/* ---- unreachable ---- */
XOnly_Signer_Gate::set_fetcher(
	function ( string $url ) {
		return null;
	}
);
$r = XOnly_Signer_Gate::verify( $origin, $pinned, array( $genuine ) );
check( 'unreachable never allows', false === $r['allow'], $r['status'] );

/* ---- malformed origin ---- */
$r = XOnly_Signer_Gate::verify( 'https://signer.xonly.ai/app', $pinned, array( $genuine ) );
check( 'an origin with a path is refused', false === $r['allow'] );

echo str_repeat( '-', 72 ) . "\n";
printf( "  %d passed, %d failed\n\n", $pass, $fail );
exit( $fail > 0 ? 1 : 0 );
