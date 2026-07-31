// Node signs with the SAME library the editor uses; PHP must agree.
import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolved against this file, not the cwd. The relative path meant the script
// only worked when run from wordpress/ and failed confusingly everywhere else.
const HERE = dirname(fileURLToPath(import.meta.url));

const cases = [];
const push = (label, ev, expect) => cases.push({ label, expect, event: ev });

// 1. plain ascii note
const sk1 = generateSecretKey();
push('plain kind 1', finalizeEvent({kind:1,created_at:1785000000,tags:[],content:'hello'}, sk1), true);

// 2. a real NIP-23 article with tags — what the editor actually emits
const sk2 = generateSecretKey();
const article = finalizeEvent({
  kind: 30023, created_at: 1785000100,
  tags: [['d','your-identity-should-outlive-the-platform'],
         ['title','Your identity should outlive the platform'],
         ['summary','A short argument for writing things you actually own.'],
         ['published_at','1785000100'],
         ['r','https://xonly.ai/@dorian/your-identity-should-outlive-the-platform']],
  content: '# Heading\n\nEvery platform made you the same offer: *we host it, you make it*.\n\n- one\n- two\n',
}, sk2);
push('NIP-23 article', article, true);

// 3. characters that break naive PHP json_encode: forward slashes + unicode
const sk3 = generateSecretKey();
push('slashes + unicode + emoji', finalizeEvent({
  kind: 1, created_at: 1785000200, tags: [['r','https://example.com/a/b?c=d&e=f']],
  content: 'URL https://xonly.ai/@you — café, naïve, 日本語, emoji 🚀, quote "x", backslash \\ done',
}, sk3), true);

// nostr-tools memoises verifyEvent on the object via a Symbol, and object
// spread COPIES symbol properties — so a spread clone of a verified event
// reports valid even after tampering. Round-trip through JSON to strip it.
const clone = (o) => JSON.parse(JSON.stringify(o));

// 4. tampered content — id no longer matches
const t = { ...clone(article), content: article.content + ' (tampered)' };
push('tampered content', t, false);

// 5. tampered signature
const s = { ...clone(article), sig: article.sig.slice(0,-2) + (article.sig.slice(-2)==='00'?'11':'00') };
push('tampered sig', s, false);

// 6. valid signature, someone else's pubkey
const other = getPublicKey(generateSecretKey());
push('swapped pubkey', { ...clone(article), pubkey: other }, false);

for (const c of cases) {
  console.log(`${c.label.padEnd(28)} nostr-tools verifyEvent = ${verifyEvent(c.event)}  (expect ${c.expect})`);
}
writeFileSync(join(HERE, 'events.json'), JSON.stringify(cases, null, 2));
console.log('\nwrote tests/events.json');
