<?php
/**
 * Node test runner.
 *
 * There were four test files and no way to run them together, so CI pointed at
 * a path that did not exist and would have failed on its first run. One entry
 * point, called by scripts/verify-all.mjs and by the CI job.
 *
 *   php wordpress/tests/run.php
 *
 * Deliberately no PHPUnit. The claim this suite exists to prove is that a node
 * verifies BIP-340 signatures on any shared host with no extensions — a runner
 * that needs Composer would undermine the thing being tested.
 */

declare(strict_types=1);

$dir = __DIR__;
$tests = ['test-schnorr.php', 'test-events.php', 'test-render.php', 'test-xss.php', 'test-signer-gate.php'];

$why = [
    'test-schnorr.php' => 'BIP-340 verification in pure PHP, no GMP, no BCMath',
    'test-events.php'  => 'NIP-01 canonical serialization and event ids',
    'test-render.php'  => 'markdown rendering and card metadata',
    'test-xss.php'     => 'no injection survives into an attribute context',
    'test-signer-gate.php' => 'the node detects a signer serving unattested code',
];

echo "\nxonly-node — PHP " . PHP_VERSION . "\n";

// State the absence rather than assume it. If a runner happens to have GMP
// installed, the fast path is exercised and the pure-PHP path is NOT — which
// would make a green run mean less than it appears to.
$ext = [];
foreach (['gmp', 'bcmath'] as $e) {
    if (extension_loaded($e)) { $ext[] = $e; }
}
echo $ext
    ? "  NOTE: " . implode(', ', $ext) . " loaded — the pure-PHP fallback is NOT being exercised\n"
    : "  no gmp, no bcmath — pure-PHP path under test\n";
echo str_repeat('-', 64) . "\n";

$failed = [];

foreach ($tests as $t) {
    $path = $dir . DIRECTORY_SEPARATOR . $t;
    if (!is_file($path)) {
        $failed[] = "$t (missing)";
        printf("  FAIL  %-20s file not found\n", $t);
        continue;
    }

    $start  = microtime(true);
    $output = [];
    $code   = 0;
    exec(escapeshellarg(PHP_BINARY) . ' ' . escapeshellarg($path) . ' 2>&1', $output, $code);
    $ms = (int) round((microtime(true) - $start) * 1000);

    if ($code === 0) {
        printf("  PASS  %-20s %s  (%d ms)\n", $t, $why[$t] ?? '', $ms);
    } else {
        $failed[] = $t;
        printf("  FAIL  %-20s exit %d\n", $t, $code);
        foreach (array_slice($output, -20) as $line) {
            echo "        $line\n";
        }
    }
}

echo str_repeat('-', 64) . "\n";

if ($failed) {
    echo "\n" . count($failed) . " test file(s) FAILED: " . implode(', ', $failed) . "\n\n";
    exit(1);
}

echo "\nall green\n\n";
exit(0);
