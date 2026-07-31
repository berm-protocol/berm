<?php
define('XONLY_CLI', true);
require_once __DIR__ . '/../xonly-node/includes/class-xonly-render.php';
require_once __DIR__ . '/../xonly-node/includes/class-xonly-card.php';

$cases = json_decode(file_get_contents(__DIR__ . '/events.json'), true);
$article = null;
foreach ($cases as $c) if ($c['label'] === 'NIP-23 article') $article = $c['event'];

$ctx = [
  'canonical' => 'https://xonly.ai/@dorian/your-identity-should-outlive-the-platform',
  'author_name' => 'Dorian', 'handle' => 'dorian',
  'og_image' => 'https://xonly.ai/og/your-identity-should-outlive-the-platform.png',
  'verified_at' => time(),
];

echo "=== markdown -> html ===\n";
echo XOnly_Render::markdown_to_html($article['content']) . "\n";

echo "\n=== card meta ===\n";
echo XOnly_Render::card_meta($article, $ctx) . "\n";

echo "\n=== XSS / injection resistance ===\n";
$evil = [
  'pubkey' => str_repeat('a',64), 'created_at' => 1, 'kind' => 30023,
  'tags' => [['title','<script>alert(1)</script>'],['d','x'],['summary','" onload="alert(2)']],
  'content' => "Try: <script>alert(3)</script>\n\n[click](javascript:alert(4))\n\n![x](javascript:alert(5))\n\n**bold** and `code<b>`",
];
$html = XOnly_Render::article_html($evil, $ctx) . XOnly_Render::card_meta($evil, $ctx);
foreach (['<script','javascript:','onload='] as $needle) {
    printf("  %-14s present in output: %s\n", $needle, str_contains($html, $needle) ? 'YES  <-- FAIL' : 'no');
}

echo "\n=== card image (GD) ===\n";
printf("  GD available: %s\n", XOnly_Card::available() ? 'yes' : 'no');
$png = XOnly_Card::render([
  'title' => 'Your identity should outlive the platform',
  'subtitle' => 'A short argument for writing things you actually own.',
  'author' => 'Dorian', 'handle' => 'dorian', 'minutes' => 3,
  'npub_short' => 'npub1abcd…x7f2', 'domain' => 'xonly.ai',
]);
if ($png) {
  file_put_contents(__DIR__ . '/card.png', $png);
  $info = getimagesizefromstring($png);
  printf("  wrote card.png  %dx%d  %s  %.1f KB\n", $info[0], $info[1], $info['mime'], strlen($png)/1024);
} else { echo "  FAILED\n"; }
