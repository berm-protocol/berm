<?php
define('XONLY_CLI', true);
require_once __DIR__ . '/../xonly-node/includes/crypto/class-xonly-event.php';

$cases = json_decode(file_get_contents(__DIR__ . '/events.json'), true);
echo "PHP backend: " . XOnly_Schnorr::backend() . "\n";
echo "Cross-language check — events signed by nostr-tools, verified by the node\n";
echo str_repeat('-', 78) . "\n";

$pass = 0; $fail = 0;
foreach ($cases as $c) {
    $r = XOnly_Event::validate($c['event']);
    $ok = ($r['valid'] === $c['expect']);
    if ($ok) $pass++; else $fail++;
    printf("%-5s %-28s valid=%-5s %4dms  %s\n",
        $ok ? 'PASS' : 'FAIL', $c['label'],
        $r['valid'] ? 'true' : 'false', $r['ms'], $r['reason']);
}
echo str_repeat('-', 78) . "\n";
printf("%d passed, %d failed\n", $pass, $fail);
exit($fail === 0 ? 0 : 1);
