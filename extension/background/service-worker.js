chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

const PAGE_ACTIONS = new Set([
  'ANALYZE', 'SIMPLIFY', 'FILL_DEMO_FIELDS', 'HIGHLIGHT_PROPERTY_FIELD',
  'GET_DEMO_STATE', 'VISIBLE_TEXT', 'GUIDE'
]);
const ALLOWED_HOSTS = new Set(['localhost', '127.0.0.1']);
const MESSAGE_TIMEOUT_MS = 4500;

function envelope(request, fields) {
  return { requestId: request?.requestId || null, activeTabId: fields.activeTabId ?? request?.activeTabId ?? null, backgroundStatus: 'running', ...fields };
}
function getTargetTab(request) {
  return new Promise(resolve => {
    const callback = tab => {
      const lastError = chrome.runtime.lastError;
      if (lastError) resolve({ error: `Could not read the active tab: ${lastError.message}`, tab: null });
      else if (!tab?.id) resolve({ error: 'No active tab is available. Open the demo portal and try again.', tab: null });
      else resolve({ tab });
    };
    if (Number.isInteger(request.activeTabId)) chrome.tabs.get(request.activeTabId, callback);
    else chrome.tabs.query({ active: true, lastFocusedWindow: true }, tabs => callback(tabs?.[0]));
  });
}
function validatePage(tab) {
  if (!tab.url) return { error: 'Chrome did not provide this tab URL. Reload the page and run the connection test again.' };
  let url;
  try { url = new URL(tab.url); } catch { return { error: 'This tab does not have a supported web URL.' }; }
  if (url.protocol !== 'http:' || !ALLOWED_HOSTS.has(url.hostname)) {
    return { error: 'This page is not in UAL’s permitted local development origins. Use http://localhost or http://127.0.0.1. Chrome internal pages and the Web Store are blocked.' };
  }
  return { url };
}
function checkHostPermission(url) {
  return new Promise(resolve => {
    const origin = `${url.protocol}//${url.hostname}/*`;
    chrome.permissions.contains({ origins: [origin] }, granted => {
      const lastError = chrome.runtime.lastError;
      resolve(lastError ? { granted: false, error: lastError.message } : { granted: !!granted });
    });
  });
}
function sendTabMessage(tabId, message) {
  return new Promise(resolve => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ ok: false, code: 'timeout', error: 'The page did not respond within 4.5 seconds. Reload the tab and try again.' });
    }, MESSAGE_TIMEOUT_MS);
    chrome.tabs.sendMessage(tabId, message, response => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const lastError = chrome.runtime.lastError;
      if (lastError) resolve({ ok: false, code: 'no_receiver', error: `No UAL content script responded: ${lastError.message}` });
      else if (response === undefined) resolve({ ok: false, code: 'empty_response', error: 'The content script returned no response.' });
      else resolve({ ok: true, data: response });
    });
  });
}
function injectContentScript(tabId) {
  return new Promise(resolve => {
    chrome.scripting.executeScript({ target: { tabId }, files: ['content/content.js'], world: 'ISOLATED' }, () => {
      const lastError = chrome.runtime.lastError;
      if (lastError) {
        const permissionDenied = /permission|cannot access|not allowed|host/i.test(lastError.message);
        resolve({ ok: false, code: permissionDenied ? 'permission_denied' : 'injection_failed', error: permissionDenied ? `Site access was denied. Allow UAL on this localhost origin in Chrome extension site settings. (${lastError.message})` : `Content script injection failed: ${lastError.message}` });
      } else resolve({ ok: true });
    });
  });
}
async function ensureContentScript(tab) {
  const permission = await checkHostPermission(validatePage(tab).url);
  const effectiveAccess = permission.granted ? 'granted' : 'activeTab';
  const pingMessage = { type: 'UAL_PING', activeTabId: tab.id, requestId: crypto.randomUUID(), payload: {} };
  const ping = await sendTabMessage(tab.id, pingMessage);
  if (ping.ok && ping.data?.alive) return { ok: true, permission: effectiveAccess, content: 'available', injection: 'already_available' };
  if (ping.code === 'timeout') return { ok: false, code: ping.code, permission: effectiveAccess, content: 'unresponsive', injection: 'not_attempted', error: ping.error };
  const injected = await injectContentScript(tab.id);
  if (!injected.ok) return { ...injected, permission: permission.granted ? 'granted' : 'missing', content: 'unavailable', injection: 'failed' };
  const recheck = await sendTabMessage(tab.id, pingMessage);
  if (!recheck.ok || !recheck.data?.alive) return { ok: false, code: 'content_unavailable', permission: effectiveAccess, content: 'unavailable', injection: 'injected_but_unresponsive', error: recheck.error || 'Content script injection completed but its listener did not become available. Reload this page.' };
  return { ok: true, permission: effectiveAccess, content: 'available', injection: 'injected' };
}
async function handlePageRequest(request) {
  const target = await getTargetTab(request);
  if (!target.tab) return envelope(request, { ok: false, error: target.error, activeTabId: request.activeTabId ?? null });
  const { tab } = target;
  const valid = validatePage(tab);
  if (valid.error) return envelope(request, { ok: false, error: valid.error, activeTabId: tab.id, activeTabUrl: tab.url || null, hostPermission: 'not_applicable' });

  const ensured = await ensureContentScript(tab);
  if (request.type === 'UAL_DIAGNOSTICS') {
    let analysisStatus = ensured.ok ? 'not_checked' : 'failed';
    let analysisError = ensured.error || null;
    if (ensured.ok) {
      const analysis = await sendTabMessage(tab.id, { type: 'ANALYZE', activeTabId: tab.id, requestId: request.requestId, payload: {} });
      analysisStatus = analysis.ok && analysis.data?.title ? 'success' : 'failed';
      analysisError = analysis.ok ? (analysis.data?.error || null) : analysis.error;
    }
    return envelope(request, {
      ok: true, activeTabId: tab.id, activeTabUrl: tab.url, hostPermission: ensured.permission || 'unknown',
      contentScriptStatus: ensured.content || 'unavailable', injectionStatus: ensured.injection || 'not_attempted',
      pageAnalysisStatus: analysisStatus, backgroundStatus: 'running', lastCommunicationError: analysisError
    });
  }
  if (!ensured.ok) return envelope(request, { ok: false, error: ensured.error, code: ensured.code, activeTabId: tab.id, activeTabUrl: tab.url, hostPermission: ensured.permission, contentScriptStatus: ensured.content, injectionStatus: ensured.injection });

  const contentMessage = { ...request.payload, type: request.type, payload: request.payload || {}, requestId: request.requestId, activeTabId: tab.id };
  const result = await sendTabMessage(tab.id, contentMessage);
  if (!result.ok) return envelope(request, { ok: false, error: result.error, code: result.code, activeTabId: tab.id, activeTabUrl: tab.url, hostPermission: ensured.permission, contentScriptStatus: 'unresponsive', injectionStatus: ensured.injection });
  if (result.data?.error) return envelope(request, { ok: false, error: result.data.error, activeTabId: tab.id, activeTabUrl: tab.url, hostPermission: ensured.permission, contentScriptStatus: ensured.content, injectionStatus: ensured.injection });
  return envelope(request, { ok: true, data: result.data, activeTabId: tab.id, activeTabUrl: tab.url, hostPermission: ensured.permission, contentScriptStatus: ensured.content, injectionStatus: ensured.injection });
}

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request?.channel !== 'UAL_PAGE_REQUEST') return false;
  if (request.type !== 'UAL_DIAGNOSTICS' && !PAGE_ACTIONS.has(request.type)) {
    sendResponse(envelope(request, { ok: false, error: `Unsupported UAL action: ${request.type || 'unknown'}` }));
    return false;
  }
  handlePageRequest(request)
    .then(sendResponse)
    .catch(error => sendResponse(envelope(request, { ok: false, error: `UAL background request failed: ${error instanceof Error ? error.message : String(error)}` })));
  return true;
});
