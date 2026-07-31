<?php
/**
 * BIP-340 Schnorr verification over secp256k1 — verification only.
 *
 * This never signs. A node has no key and no business having one; it exists to
 * check that what it was handed was signed by the pubkey it claims.
 *
 * Uses GMP when the host has it, and falls back to XOnly_Bignum otherwise. Both
 * paths are checked against the official BIP-340 test vectors in
 * tests/test-schnorr.php, including every negative case.
 *
 * @package XOnly_Node
 */

defined( 'ABSPATH' ) || defined( 'XONLY_CLI' ) || exit;

require_once __DIR__ . '/class-xonly-bignum.php';

final class XOnly_Schnorr {

	/** Which arithmetic backend is in use — surfaced in the admin screen. */
	public static function backend(): string {
		return function_exists( 'gmp_init' ) ? 'gmp' : 'pure-php';
	}

	/**
	 * Verify a BIP-340 signature.
	 *
	 * @param string $msg    32 raw bytes (for Nostr, the event id).
	 * @param string $pubkey 32 raw bytes, x-only.
	 * @param string $sig    64 raw bytes.
	 */
	public static function verify( string $msg, string $pubkey, string $sig ): bool {
		if ( 32 !== strlen( $pubkey ) || 64 !== strlen( $sig ) ) {
			return false;
		}
		return function_exists( 'gmp_init' )
			? self::verify_gmp( $msg, $pubkey, $sig )
			: self::verify_pure( $msg, $pubkey, $sig );
	}

	/** BIP-340 tagged hash. */
	public static function tagged_hash( string $tag, string $data ): string {
		$th = hash( 'sha256', $tag, true );
		return hash( 'sha256', $th . $th . $data, true );
	}

	/* ================================================================== */
	/* Pure-PHP backend                                                    */
	/* ================================================================== */

	private static function verify_pure( string $msg, string $pubkey, string $sig ): bool {
		$B = 'XOnly_Bignum';

		$p = $B::p();
		$n = $B::n();

		// 1. P = lift_x(pubkey)
		$px = $B::from_bin( $pubkey );
		if ( $B::cmp( $px, $p ) >= 0 ) {
			return false; // not a field element
		}
		$P = self::lift_x_pure( $px );
		if ( null === $P ) {
			return false; // x is not on the curve
		}

		// 2. r must be a field element
		$r = $B::from_bin( substr( $sig, 0, 32 ) );
		if ( $B::cmp( $r, $p ) >= 0 ) {
			return false;
		}

		// 3. s must be below the group order
		$s = $B::from_bin( substr( $sig, 32, 32 ) );
		if ( $B::cmp( $s, $n ) >= 0 ) {
			return false;
		}

		// 4. e = int(tagged_hash("BIP0340/challenge", r || P.x || m)) mod n
		$e_bytes = self::tagged_hash( 'BIP0340/challenge', substr( $sig, 0, 32 ) . $pubkey . $msg );
		$e       = $B::mod_n( $B::from_bin( $e_bytes ) );

		// 5. R = s*G - e*P
		$sG  = self::scalar_mul_pure( self::generator_pure(), $s );
		$eP  = self::scalar_mul_pure( $P, $e );
		$neg = self::point_neg_pure( $eP );
		$R   = self::point_add_pure( $sG, $neg );

		// 6. R must be finite, with even y, and x equal to r
		if ( null === $R ) {
			return false; // point at infinity
		}
		$aff = self::to_affine_pure( $R );
		if ( null === $aff ) {
			return false;
		}
		list( $rx, $ry ) = $aff;

		if ( $B::is_odd( $ry ) ) {
			return false;
		}
		return 0 === $B::cmp( $rx, $r );
	}

	/** Curve generator in Jacobian coordinates. */
	private static function generator_pure(): array {
		$B = 'XOnly_Bignum';
		return array(
			$B::from_hex( '79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798' ),
			$B::from_hex( '483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8' ),
			$B::from_int( 1 ),
		);
	}

	/** Recover the even-y point for a given x, or null if x is not on the curve. */
	private static function lift_x_pure( array $x ): ?array {
		$B = 'XOnly_Bignum';

		// y^2 = x^3 + 7
		$x3  = $B::mod_mul( $B::mod_sqr( $x ), $x );
		$ysq = $B::mod_add( $x3, $B::from_int( 7 ) );

		$y = $B::mod_sqrt( $ysq );

		// mod_sqrt always returns something; confirm it is a genuine root.
		if ( 0 !== $B::cmp( $B::mod_sqr( $y ), $ysq ) ) {
			return null;
		}
		if ( $B::is_odd( $y ) ) {
			$y = $B::mod_neg( $y );
		}
		return array( $x, $y, $B::from_int( 1 ) );
	}

	private static function point_neg_pure( ?array $P ): ?array {
		if ( null === $P ) {
			return null;
		}
		$B = 'XOnly_Bignum';
		return array( $P[0], $B::mod_neg( $P[1] ), $P[2] );
	}

	/** Jacobian doubling for a = 0. */
	private static function point_double_pure( ?array $P ): ?array {
		if ( null === $P ) {
			return null;
		}
		$B = 'XOnly_Bignum';
		list( $X, $Y, $Z ) = $P;

		if ( $B::is_zero( $Y ) || $B::is_zero( $Z ) ) {
			return null;
		}

		$A = $B::mod_sqr( $Y );                                   // Y^2
		$Bv = $B::mod_mul( $B::from_int( 4 ), $B::mod_mul( $X, $A ) ); // 4XY^2
		$C = $B::mod_mul( $B::from_int( 8 ), $B::mod_sqr( $A ) );  // 8Y^4
		$D = $B::mod_mul( $B::from_int( 3 ), $B::mod_sqr( $X ) );  // 3X^2

		$X3 = $B::mod_sub( $B::mod_sqr( $D ), $B::mod_mul( $B::from_int( 2 ), $Bv ) );
		$Y3 = $B::mod_sub( $B::mod_mul( $D, $B::mod_sub( $Bv, $X3 ) ), $C );
		$Z3 = $B::mod_mul( $B::from_int( 2 ), $B::mod_mul( $Y, $Z ) );

		return array( $X3, $Y3, $Z3 );
	}

	private static function point_add_pure( ?array $P, ?array $Q ): ?array {
		if ( null === $P ) {
			return $Q;
		}
		if ( null === $Q ) {
			return $P;
		}
		$B = 'XOnly_Bignum';

		list( $X1, $Y1, $Z1 ) = $P;
		list( $X2, $Y2, $Z2 ) = $Q;

		$Z1Z1 = $B::mod_sqr( $Z1 );
		$Z2Z2 = $B::mod_sqr( $Z2 );
		$U1   = $B::mod_mul( $X1, $Z2Z2 );
		$U2   = $B::mod_mul( $X2, $Z1Z1 );
		$S1   = $B::mod_mul( $Y1, $B::mod_mul( $Z2, $Z2Z2 ) );
		$S2   = $B::mod_mul( $Y2, $B::mod_mul( $Z1, $Z1Z1 ) );

		$H = $B::mod_sub( $U2, $U1 );
		$Rr = $B::mod_sub( $S2, $S1 );

		if ( $B::is_zero( $H ) ) {
			if ( $B::is_zero( $Rr ) ) {
				return self::point_double_pure( $P );
			}
			return null; // P + (-P) = infinity
		}

		$HH  = $B::mod_sqr( $H );
		$HHH = $B::mod_mul( $H, $HH );
		$V   = $B::mod_mul( $U1, $HH );

		$X3 = $B::mod_sub( $B::mod_sub( $B::mod_sqr( $Rr ), $HHH ), $B::mod_mul( $B::from_int( 2 ), $V ) );
		$Y3 = $B::mod_sub( $B::mod_mul( $Rr, $B::mod_sub( $V, $X3 ) ), $B::mod_mul( $S1, $HHH ) );
		$Z3 = $B::mod_mul( $H, $B::mod_mul( $Z1, $Z2 ) );

		return array( $X3, $Y3, $Z3 );
	}

	private static function scalar_mul_pure( ?array $P, array $k ): ?array {
		$B = 'XOnly_Bignum';
		if ( $B::is_zero( $k ) || null === $P ) {
			return null;
		}
		$result = null;
		$addend = $P;

		for ( $i = 0; $i < 256; $i++ ) {
			if ( $B::bit( $k, $i ) ) {
				$result = self::point_add_pure( $result, $addend );
			}
			$addend = self::point_double_pure( $addend );
			if ( null === $addend ) {
				break;
			}
		}
		return $result;
	}

	/** @return array{0:int[],1:int[]}|null */
	private static function to_affine_pure( ?array $P ): ?array {
		if ( null === $P ) {
			return null;
		}
		$B = 'XOnly_Bignum';
		list( $X, $Y, $Z ) = $P;
		if ( $B::is_zero( $Z ) ) {
			return null;
		}
		$zinv  = $B::mod_inv( $Z );
		$zinv2 = $B::mod_sqr( $zinv );
		$zinv3 = $B::mod_mul( $zinv2, $zinv );
		return array( $B::mod_mul( $X, $zinv2 ), $B::mod_mul( $Y, $zinv3 ) );
	}

	/* ================================================================== */
	/* GMP backend — same algorithm, native bignums                        */
	/* ================================================================== */

	private static function verify_gmp( string $msg, string $pubkey, string $sig ): bool {
		$p = gmp_init( XOnly_Bignum::P_HEX, 16 );
		$n = gmp_init( XOnly_Bignum::N_HEX, 16 );

		$px = gmp_init( bin2hex( $pubkey ), 16 );
		if ( gmp_cmp( $px, $p ) >= 0 ) {
			return false;
		}

		$P = self::lift_x_gmp( $px, $p );
		if ( null === $P ) {
			return false;
		}

		$r = gmp_init( bin2hex( substr( $sig, 0, 32 ) ), 16 );
		if ( gmp_cmp( $r, $p ) >= 0 ) {
			return false;
		}
		$s = gmp_init( bin2hex( substr( $sig, 32, 32 ) ), 16 );
		if ( gmp_cmp( $s, $n ) >= 0 ) {
			return false;
		}

		$e_bytes = self::tagged_hash( 'BIP0340/challenge', substr( $sig, 0, 32 ) . $pubkey . $msg );
		$e       = gmp_mod( gmp_init( bin2hex( $e_bytes ), 16 ), $n );

		$G  = array(
			gmp_init( '79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798', 16 ),
			gmp_init( '483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8', 16 ),
		);
		$sG = self::mul_gmp( $G, $s, $p );
		$eP = self::mul_gmp( $P, $e, $p );
		if ( null !== $eP ) {
			$eP = array( $eP[0], gmp_mod( gmp_sub( $p, $eP[1] ), $p ) );
		}
		$R = self::add_gmp( $sG, $eP, $p );

		if ( null === $R ) {
			return false;
		}
		if ( 1 === gmp_intval( gmp_mod( $R[1], 2 ) ) ) {
			return false;
		}
		return 0 === gmp_cmp( $R[0], $r );
	}

	private static function lift_x_gmp( $x, $p ) {
		$ysq = gmp_mod( gmp_add( gmp_powm( $x, 3, $p ), 7 ), $p );
		$y   = gmp_powm( $ysq, gmp_div_q( gmp_add( $p, 1 ), 4 ), $p );
		if ( 0 !== gmp_cmp( gmp_mod( gmp_mul( $y, $y ), $p ), $ysq ) ) {
			return null;
		}
		if ( 1 === gmp_intval( gmp_mod( $y, 2 ) ) ) {
			$y = gmp_sub( $p, $y );
		}
		return array( $x, $y );
	}

	private static function add_gmp( $P, $Q, $p ) {
		if ( null === $P ) {
			return $Q;
		}
		if ( null === $Q ) {
			return $P;
		}
		if ( 0 === gmp_cmp( $P[0], $Q[0] ) ) {
			if ( 0 !== gmp_cmp( $P[1], $Q[1] ) || 0 === gmp_cmp( $P[1], gmp_init( 0 ) ) ) {
				return null;
			}
			$lam = gmp_mod(
				gmp_mul(
					gmp_mul( 3, gmp_mul( $P[0], $P[0] ) ),
					gmp_invert( gmp_mod( gmp_mul( 2, $P[1] ), $p ), $p )
				),
				$p
			);
		} else {
			$lam = gmp_mod(
				gmp_mul(
					gmp_sub( $Q[1], $P[1] ),
					gmp_invert( gmp_mod( gmp_sub( $Q[0], $P[0] ), $p ), $p )
				),
				$p
			);
		}
		$x3 = gmp_mod( gmp_sub( gmp_sub( gmp_mul( $lam, $lam ), $P[0] ), $Q[0] ), $p );
		$y3 = gmp_mod( gmp_sub( gmp_mul( $lam, gmp_sub( $P[0], $x3 ) ), $P[1] ), $p );
		return array( $x3, $y3 );
	}

	private static function mul_gmp( $P, $k, $p ) {
		$R = null;
		$A = $P;
		$bits = gmp_strval( $k, 2 );
		for ( $i = strlen( $bits ) - 1; $i >= 0; $i-- ) {
			if ( '1' === $bits[ $i ] ) {
				$R = self::add_gmp( $R, $A, $p );
			}
			$A = self::add_gmp( $A, $A, $p );
		}
		return $R;
	}
}
