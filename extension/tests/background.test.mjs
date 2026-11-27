import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const source = fs.readFileSync(path.join(root, 'extension/background/service-worker.js'), 'utf8');
function harness({ url = 'http://localhost:5173/portal', permission = true, restricted = false, initiallyAvailable = false, unresponsive = false, timeoutMs = 4500, response = { title: 'Demo', fields: [] }, tabs = [{ id: 42 }] } = {}) {
  let messageListener, contentAvailable = initiallyAvailable;
  const injected = [], sent = [];
  const runtime = { _lastError: null, get lastError() { return this._lastError; }, onInstalled: { addListener() {} }, onMessage: { addListener(fn) { messageListener = fn; } } };
  const tab = { ...tabs[0], url };
  const chrome = {
    runtime,
    sidePanel: { setPanelBehavior() {} },
    permissions: { contains(_details, callback) { callback(permission); } },
    tabs: {
      query(_query, callback) { callback(tabs.length ? [tab] : []); },
      get(id, callback) { callback(tabs.length && id === tab.id ? tab : undefined); },
      sendMessage(id, message, callback) {
        sent.push({ id, message });
        if (unresponsive) return;
        if (restricted) { runtime._lastError = { message: 'Cannot access contents of url. Permission denied' }; callback(); runtime._lastError = null; return; }
        if (message.type === 'UAL_PING' && !contentAvailable) { runtime._lastError = { message: 'Receiving end does not exist' }; callback(); runtime._lastError = null; return; }
        runtime._lastError = null;
        callback(message.type === 'UAL_PING' ? { alive: true } : response);
      }
    },
    scripting: {
      executeScript(details, callback) {
        injected.push(details);
        runtime._lastError = restricted ? { message: 'Cannot access contents of url. Permission denied' } : null;
        if (!restricted) contentAvailable = true;
        callback(); runtime._lastError = null;
      }
    }
  };
  const workerSetTimeout = (fn, ms) => setTimeout(fn, Math.min(ms, timeoutMs));
  vm.runInNewContext(source, { chrome, URL, crypto: { randomUUID: () => 'ping-id' }, setTimeout: workerSetTimeout, clearTimeout });
  return { injected, sent, request(message) { return new Promise(resolve => messageListener({ channel: 'UAL_PAGE_REQUEST', requestId: 'request-id', activeTabId: 42, payload: {}, ...message }, {}, resolve)); } };
}

test('injects a missing content script, confirms it responds, then forwards the action', async () => {
  const h = harness();
  const result = await h.request({ type: 'ANALYZE', payload: { sample: 1 } });
  assert.equal(result.ok, true);
  assert.equal(result.activeTabId, 42);
  assert.equal(result.data.title, 'Demo');
  assert.equal(h.injected.length, 1);
  assert.equal(h.injected[0].target.tabId, 42);
  assert.deepEqual(Array.from(h.injected[0].files), ['content/content.js']);
  assert.deepEqual(h.sent.map(x => x.message.type), ['UAL_PING', 'UAL_PING', 'ANALYZE']);
  assert.equal(h.sent.at(-1).message.activeTabId, 42);
  assert.deepEqual(h.sent.at(-1).message.payload, { sample: 1 });
});

test('uses an already-installed content script without reinjecting it', async () => {
  const h = harness({ initiallyAvailable: true });
  const result = await h.request({ type: 'ANALYZE' });
  assert.equal(result.ok, true);
  assert.equal(result.injectionStatus, 'already_available');
  assert.equal(h.injected.length, 0);
});

test('uses the action-granted activeTab access when permanent host access is withheld', async () => {
  const h = harness({ permission: false });
  const result = await h.request({ type: 'SIMPLIFY' });
  assert.equal(result.ok, true);
  assert.equal(result.hostPermission, 'activeTab');
  assert.equal(result.injectionStatus, 'injected');
  assert.equal(h.injected.length, 1);
});

test('reports injection permission failures distinctly', async () => {
  const result = await harness({ restricted: true }).request({ type: 'SIMPLIFY' });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'permission_denied');
  assert.match(result.error, /site access was denied/i);
});

test('rejects browser internal pages before injection', async () => {
  const h = harness({ url: 'chrome://settings' });
  const result = await h.request({ type: 'ANALYZE' });
  assert.equal(result.ok, false);
  assert.match(result.error, /Chrome internal pages.*blocked/i);
  assert.equal(h.injected.length, 0);
});

test('connection diagnostics report permission, injection, worker and page round-trip', async () => {
  const result = await harness().request({ type: 'UAL_DIAGNOSTICS' });
  assert.equal(result.ok, true);
  assert.equal(result.hostPermission, 'granted');
  assert.equal(result.contentScriptStatus, 'available');
  assert.equal(result.injectionStatus, 'injected');
  assert.equal(result.pageAnalysisStatus, 'success');
  assert.equal(result.backgroundStatus, 'running');
});

test('returns a clear error when no active tab exists', async () => {
  const h = harness({ tabs: [] });
  const result = await h.request({ type: 'ANALYZE' });
  assert.equal(result.ok, false);
  assert.match(result.error, /No active tab/i);
});

test('returns a timeout error when a page does not answer the readiness probe', async () => {
  const result = await harness({ unresponsive: true, timeoutMs: 5 }).request({ type: 'ANALYZE' });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'timeout');
  assert.match(result.error, /did not respond within/i);
});
