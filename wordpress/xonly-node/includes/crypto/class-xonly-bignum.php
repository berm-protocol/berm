<?php
/**
 * Fixed-width 256-bit modular arithmetic over the secp256k1 field.
 *
 * WHY THIS EXISTS: a node has to verify the signatures it stores, or it is a
 * database with opinions. Plenty of WordPress hosts ship without GMP and
 * without BCMath, so the plugin carries its own arithmetic and uses GMP only as
 * a fast path when it happens to be there.
 *
 * REPRESENTATION: 16 limbs of 16 bits, little-endian. Base 2^16 is slower than
 * a wider limb, but 2^256 lands exactly on limb 16, which makes the fast
 * reduction below a clean split instead of a bit-shuffling exercise. In
 * verification code, obviously-correct beats fast.
 *
 * Products are 32 bits and at most 16 accumulate, so intermediates stay under
 * 2^36 — comfortably inside PHP's 63-bit signed integers.
 *
 * @package XOnly_Node
 */

defined( 'ABSPATH' ) || defined( 'XONLY_CLI' ) || exit;

final class XOnly_Bignum {

	const LIMBS = 16;
	const BASE  = 65536;      // 2^16
	const MASK  = 0xFFFF;
	const SHIFT = 16;

	/** secp256k1 field prime: 2^256 - 2^32 - 977 */
	const P_HEX = 'FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F';
	/** secp256k1 group order */
	const N_HEX = 'FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141';

	/* ------------------------------------------------------------------ */
	/* Conversion                                                          */
	/* ------------------------------------------------------------------ */

	/** @return int[] 16 limbs, little-endian */
	public static function zero(): array {
		return array_fill( 0, self::LIMBS, 0 );
	}

	public static function from_int( int $v ): array {
		$r = self::zero();
		$i = 0;
		while ( $v > 0 && $i < self::LIMBS ) {
			$r[ $i ] = $v & self::MASK;
			$v     >>= self::SHIFT;
			$i++;
		}
		return $r;
	}

	/** Hex string (any length up to 64) to limbs. */
	public static function from_hex( string $hex ): array {
		$hex = str_pad( ltrim( $hex ), 64, '0', STR_PAD_LEFT );
		$hex = substr( $hex, -64 );
		$r   = self::zero();
		// Big-endian hex: the last 4 hex chars are limb 0.
		for ( $i = 0; $i < self::LIMBS; $i++ ) {
			$chunk      = substr( $hex, 64 - ( $i + 1 ) * 4, 4 );
			$r[ $i ]    = (int) hexdec( $chunk );
		}
		return $r;
	}

	public static function to_hex( array $a ): string {
		$out = '';
		for ( $i = self::LIMBS - 1; $i >= 0; $i-- ) {
			$out .= str_pad( dechex( $a[ $i ] ), 4, '0', STR_PAD_LEFT );
		}
		return $out;
	}

	public static function from_bin( string $bytes ): array {
		return self::from_hex( bin2hex( $bytes ) );
	}

	public static function to_bin( array $a ): string {
		return hex2bin( self::to_hex( $a ) );
	}

	/* ------------------------------------------------------------------ */
	/* Comparison                                                          */
	/* ------------------------------------------------------------------ */

	public static function cmp( array $a, array $b ): int {
		for ( $i = self::LIMBS - 1; $i >= 0; $i-- ) {
			if ( $a[ $i ] !== $b[ $i ] ) {
				return $a[ $i ] > $b[ $i ] ? 1 : -1;
			}
		}
		return 0;
	}

	public static function is_zero( array $a ): bool {
		for ( $i = 0; $i < self::LIMBS; $i++ ) {
			if ( 0 !== $a[ $i ] ) {
				return false;
			}
		}
		return true;
	}

	public static function is_odd( array $a ): bool {
		return 1 === ( $a[0] & 1 );
	}

	/** Bit at position $n, counting from the least significant. */
	public static function bit( array $a, int $n ): int {
		$limb = intdiv( $n, self::SHIFT );
		if ( $limb >= self::LIMBS ) {
			return 0;
		}
		return ( $a[ $limb ] >> ( $n % self::SHIFT ) ) & 1;
	}

	/* ------------------------------------------------------------------ */
	/* Raw add / sub (no modular reduction)                                */
	/* ------------------------------------------------------------------ */

	/** @return array{0:int[],1:int} [result, carry] */
	public static function add_raw( array $a, array $b ): array {
		$r     = self::zero();
		$carry = 0;
		for ( $i = 0; $i < self::LIMBS; $i++ ) {
			$t       = $a[ $i ] + $b[ $i ] + $carry;
			$r[ $i ] = $t & self::MASK;
			$carry   = $t >> self::SHIFT;
		}
		return array( $r, $carry );
	}

	/** @return array{0:int[],1:int} [result, borrow] */
	public static function sub_raw( array $a, array $b ): array {
		$r      = self::zero();
		$borrow = 0;
		for ( $i = 0; $i < self::LIMBS; $i++ ) {
			$t = $a[ $i ] - $b[ $i ] - $borrow;
			if ( $t < 0 ) {
				$t     += self::BASE;
				$borrow = 1;
			} else {
				$borrow = 0;
			}
			$r[ $i ] = $t;
		}
		return array( $r, $borrow );
	}

	/* ------------------------------------------------------------------ */
	/* Modular arithmetic mod p                                            */
	/* ------------------------------------------------------------------ */

	private static ?array $p_cache = null;

	public static function p(): array {
		if ( null === self::$p_cache ) {
			self::$p_cache = self::from_hex( self::P_HEX );
		}
		return self::$p_cache;
	}

	private static ?array $n_cache = null;

	public static function n(): array {
		if ( null === self::$n_cache ) {
			self::$n_cache = self::from_hex( self::N_HEX );
		}
		return self::$n_cache;
	}

	public static function mod_add( array $a, array $b ): array {
		list( $r, $carry ) = self::add_raw( $a, $b );
		if ( $carry || self::cmp( $r, self::p() ) >= 0 ) {
			list( $r, ) = self::sub_raw( $r, self::p() );
		}
		return $r;
	}

	public static function mod_sub( array $a, array $b ): array {
		list( $r, $borrow ) = self::sub_raw( $a, $b );
		if ( $borrow ) {
			list( $r, ) = self::add_raw( $r, self::p() );
		}
		return $r;
	}

	public static function mod_neg( array $a ): array {
		if ( self::is_zero( $a ) ) {
			return self::zero();
		}
		list( $r, ) = self::sub_raw( self::p(), $a );
		return $r;
	}

	/**
	 * Schoolbook multiply to 32 limbs, then reduce.
	 *
	 * Reduction uses the shape of p: since 2^256 ≡ 2^32 + 977 (mod p), the high
	 * half folds back into the low half by multiplying by that small constant.
	 * Two passes always suffice, followed by at most a couple of conditional
	 * subtractions.
	 */
	public static function mod_mul( array $a, array $b ): array {
		$t = array_fill( 0, self::LIMBS * 2, 0 );

		for ( $i = 0; $i < self::LIMBS; $i++ ) {
			$ai = $a[ $i ];
			if ( 0 === $ai ) {
				continue;
			}
			$carry = 0;
			for ( $j = 0; $j < self::LIMBS; $j++ ) {
				$idx        = $i + $j;
				$acc        = $t[ $idx ] + $ai * $b[ $j ] + $carry;
				$t[ $idx ]  = $acc & self::MASK;
				$carry      = $acc >> self::SHIFT;
			}
			$k = $i + self::LIMBS;
			while ( $carry > 0 ) {
				$acc      = $t[ $k ] + $carry;
				$t[ $k ]  = $acc & self::MASK;
				$carry    = $acc >> self::SHIFT;
				$k++;
			}
		}

		return self::reduce_wide( $t );
	}

	public static function mod_sqr( array $a ): array {
		return self::mod_mul( $a, $a );
	}

	/**
	 * Fold a 512-bit value into the field.
	 *
	 * value = L + H * 2^256  ≡  L + H * (2^32 + 977)   (mod p)
	 */
	private static function reduce_wide( array $t ): array {
		for ( $pass = 0; $pass < 3; $pass++ ) {
			$high_zero = true;
			for ( $i = self::LIMBS; $i < self::LIMBS * 2; $i++ ) {
				if ( 0 !== $t[ $i ] ) {
					$high_zero = false;
					break;
				}
			}
			if ( $high_zero ) {
				break;
			}

			$low  = array_slice( $t, 0, self::LIMBS );
			$high = array_slice( $t, self::LIMBS, self::LIMBS );

			// high * 977
			$acc   = array_fill( 0, self::LIMBS * 2, 0 );
			$carry = 0;
			for ( $i = 0; $i < self::LIMBS; $i++ ) {
				$v         = $high[ $i ] * 977 + $carry;
				$acc[ $i ] = $v & self::MASK;
				$carry     = $v >> self::SHIFT;
			}
			$acc[ self::LIMBS ] = $carry;

			// high * 2^32  (2^32 == two limbs of 16 bits)
			$carry = 0;
			for ( $i = 0; $i < self::LIMBS; $i++ ) {
				$idx        = $i + 2;
				$v          = $acc[ $idx ] + $high[ $i ] + $carry;
				$acc[ $idx ] = $v & self::MASK;
				$carry      = $v >> self::SHIFT;
			}
			$k = self::LIMBS + 2;
			while ( $carry > 0 && $k < self::LIMBS * 2 ) {
				$v        = $acc[ $k ] + $carry;
				$acc[ $k ] = $v & self::MASK;
				$carry    = $v >> self::SHIFT;
				$k++;
			}

			// t = low + acc
			$carry = 0;
			for ( $i = 0; $i < self::LIMBS * 2; $i++ ) {
				$lv        = $i < self::LIMBS ? $low[ $i ] : 0;
				$v         = $lv + $acc[ $i ] + $carry;
				$t[ $i ]   = $v & self::MASK;
				$carry     = $v >> self::SHIFT;
			}
		}

		$r = array_slice( $t, 0, self::LIMBS );
		while ( self::cmp( $r, self::p() ) >= 0 ) {
			list( $r, ) = self::sub_raw( $r, self::p() );
		}
		return $r;
	}

	/** Modular exponentiation, square-and-multiply, exponent as limbs. */
	public static function mod_pow( array $base, array $exp ): array {
		$result = self::from_int( 1 );
		$b      = $base;

		for ( $i = 0; $i < 256; $i++ ) {
			if ( self::bit( $exp, $i ) ) {
				$result = self::mod_mul( $result, $b );
			}
			$b = self::mod_sqr( $b );
		}
		return $result;
	}

	/** Inverse via Fermat: a^(p-2) mod p. */
	public static function mod_inv( array $a ): array {
		$exp = self::from_hex( 'FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2D' ); // p - 2
		return self::mod_pow( $a, $exp );
	}

	/**
	 * Square root mod p. Valid because p ≡ 3 (mod 4), so the root is
	 * a^((p+1)/4). Caller MUST confirm the result squares back to the input —
	 * this returns a value even when no root exists.
	 */
	public static function mod_sqrt( array $a ): array {
		$exp = self::from_hex( '3FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFBFFFFF0C' ); // (p+1)/4
		return self::mod_pow( $a, $exp );
	}

	/** Reduce a 256-bit value mod n. Since 2^256 < 2n, this is at most two
	 *  conditional subtractions. */
	public static function mod_n( array $a ): array {
		$r = $a;
		while ( self::cmp( $r, self::n() ) >= 0 ) {
			list( $r, ) = self::sub_raw( $r, self::n() );
		}
		return $r;
	}
}
