<?php
define('XONLY_CLI', true);
require_once __DIR__ . '/../xonly-node/includes/crypto/class-xonly-schnorr.php';

echo "backend: " . XOnly_Schnorr::backend() . "\n";
echo str_repeat('-', 72) . "\n";

$rows = array_filter(array_map('trim', file(__DIR__ . '/vectors-bip340.csv')));
$pass = 0; $fail = 0; $t0 = microtime(true);

foreach ($rows as $line) {
    $c = str_getcsv($line);
    [$idx, $pub, $msg, $sig, $expect] = $c;
    $comment = $c[5] ?? '';
    $want = ('TRUE' === $expect);

    $start = microtime(true);
    $got = XOnly_Schnorr::verify(hex2bin($msg), hex2bin($pub), hex2bin($sig));
    $ms = round((microtime(true) - $start) * 1000);

    $ok = ($got === $want);
    if ($ok) { $pass++; } else { $fail++; }
    printf("%-4s %-5s expected=%-5s got=%-5s %5dms  %s\n",
        $idx, $ok ? 'PASS' : 'FAIL',
        $want ? 'true' : 'false', $got ? 'true' : 'false', $ms, $comment);
}

$total = round((microtime(true) - $t0), 1);
echo str_repeat('-', 72) . "\n";
printf("%d passed, %d failed  (%ss total)\n", $pass, $fail, $total);
exit($fail === 0 ? 0 : 1);
