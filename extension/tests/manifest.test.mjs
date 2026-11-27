import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'extension/manifest.json'), 'utf8'));
const localPatterns = ['http://localhost/*', 'http://127.0.0.1/*'];

test('Manifest V3 grants only the required local development site access', () => {
  assert.equal(manifest.manifest_version, 3);
  assert.ok(['activeTab', 'scripting', 'tabs', 'storage', 'sidePanel'].every(permission => manifest.permissions.includes(permission)));
  assert.deepEqual(manifest.host_permissions, localPatterns);
  assert.deepEqual(manifest.content_scripts[0].matches, localPatterns);
  assert.equal(manifest.content_scripts[0].js[0], 'content/content.js');
  assert.ok(!manifest.host_permissions.includes('<all_urls>'));
});

test('Manifest entry points and declared extension scripts exist', () => {
  for (const filename of [manifest.background.service_worker, manifest.side_panel.default_path, manifest.content_scripts[0].js[0]]) {
    assert.ok(fs.existsSync(path.join(root, 'extension', filename)), `${filename} exists`);
  }
});
