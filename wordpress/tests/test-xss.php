<?php
define('XONLY_CLI', true);
require_once __DIR__ . '/../xonly-node/includes/class-xonly-render.php';

$ctx = ['canonical'=>'https://xonly.ai/x','author_name'=>'A','handle'=>'a','verified_at'=>1];
$evil = [
  'pubkey' => str_repeat('a',64), 'created_at' => 1, 'kind' => 30023,
  'tags' => [['title','<script>alert(1)</script>'],['d','x'],['summary','" onload="alert(2)']],
  'content' => "Try: <script>alert(3)</script>\n\n[click](javascript:alert(4))\n\n![x](javascript:alert(5))\n\n[ok](https://good.example/p)\n\n**bold** and `code<b>`\n\n> quote with <img src=x onerror=alert(6)>",
];
$body = XOnly_Render::article_html($evil, $ctx);
$meta = XOnly_Render::card_meta($evil, $ctx);

echo "=== rendered body ===\n$body\n";
echo "\n=== meta ===\n$meta\n";

echo "\n=== attribute-context assertions ===\n";
$all = $body . $meta;
$tests = [
  'no <script tag'                 => !preg_match('/<script/i', $all),
  'no javascript: in href/src'     => !preg_match('/(href|src)\s*=\s*"[^"]*javascript:/i', $all),
  'no unescaped onload= attribute' => !preg_match('/\son(load|error|click)\s*=\s*"/i', $all),
  'no raw <img from content'       => !preg_match('/<img(?![^>]*loading="lazy")/i', $all),
  'good https link survived'       => str_contains($all, '<a href="https://good.example/p"'),
  'bold rendered'                  => str_contains($all, '<strong>bold</strong>'),
];
$fail = 0;
foreach ($tests as $name => $ok) { printf("  %-34s %s\n", $name, $ok ? 'pass' : 'FAIL'); if(!$ok) $fail++; }
echo $fail ? "\n$fail FAILED\n" : "\nall pass\n";
exit($fail ? 1 : 0);
