import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';

const read = name => JSON.parse(readFileSync(new URL(name, import.meta.url), 'utf8'));
const schema = read('./schema.json');
const vectors = read('./shape-vectors.json');
const ajv = new Ajv({ strict: true, allErrors: true, validateFormats: true });
ajv.addFormat('brm-js-date', { type: 'string', validate: s => Number.isFinite(Date.parse(s)) });
const validate = ajv.compile(schema);

for (const row of vectors.cases) {
  test(row.id, () => assert.equal(validate(row.value), row.shapeValid, JSON.stringify(validate.errors)));
}
test('all five object levels are closed, with every property required', () => {
  const levels = [schema, schema.properties.identity, schema.properties.recovery,
    schema.properties.derived, schema.properties.derived.properties.evm];
  for (const level of levels) {
    assert.equal(level.additionalProperties, false);
    assert.deepEqual([...level.required].sort(), Object.keys(level.properties).sort());
  }
});
test('unknown custom date format refuses compilation rather than silently skipping', () => {
  assert.throws(() => new Ajv({ strict: true, validateFormats: true }).compile(schema), /unknown format/);
});
test('shape example is explicitly synthetic, not a decryption claim', () => {
  assert.equal(validate(read('./shape-example.json')), true);
  assert.match(vectors.scope, /SYNTHETIC STRUCTURE ONLY/);
  assert.match(vectors.scope, /No usable encrypted secret/);
});
test('profile is the existing file generation, not a new external binding method', () => {
  assert.equal(schema.properties.schema.const, 'berm.recovery_module/0.1');
  const profile = readFileSync(new URL('./PROFILE.md', import.meta.url), 'utf8');
  assert.match(profile, /berm\.external_account_binding\.x\/2/);
  assert.match(profile, /does NOT prove the user saved a file/);
  assert.match(profile, /JSON\/schema validation alone does not prove root\/public-/);
});
