(()=>{
  if (window.__ualMessageHandler) {
    try { chrome.runtime.onMessage.removeListener(window.__ualMessageHandler); } catch { /* A reloaded extension may invalidate the old listener. */ }
  }

  const sensitive = /\b(password|passcode|otp|one.?time.?code|aadhaar|aadhar|pan|cvv|cvc|credit.?card|debit.?card|bank.?account|upi.?pin)\b/i;
  const allowedWards = ['Jayanagar', 'Basavanagudi', 'Indiranagar'];
  const attrs = element => [element.id, element.name, element.getAttribute('aria-label'), element.placeholder, element.labels?.[0]?.innerText, element.getAttribute('title')].filter(Boolean).join(' ');
  const isSensitive = element => element.type === 'password' || sensitive.test(attrs(element));
  const visible = element => !!(element && (element.getClientRects?.().length || element.offsetWidth || element.offsetHeight));

  function isDemoPortal() {
    const localDemoHost = ['localhost', '127.0.0.1'].includes(location.hostname) && location.port === '5173' && location.pathname.startsWith('/portal');
    return localDemoHost && /DEMO ONLY/i.test(document.body?.innerText || '');
  }
  function findPropertyInput() {
    const candidates = Array.from(document.querySelectorAll('input')).filter(e => !isSensitive(e) && !e.disabled && e.type !== 'hidden');
    const score = e => {
      const text = attrs(e);
      if (e.id === 'property-id') return 100;
      if (/property\s*(identification\s*)?(id|number)|property.?id|assessment\s*(id|number)/i.test(text)) return 80;
      if (/property/i.test(text) && /id|number|identification/i.test(text)) return 70;
      return 0;
    };
    return candidates.map(element => ({ element, score: score(element) })).sort((a, b) => b.score - a.score).find(x => x.score > 0)?.element || null;
  }
  function findWardSelect() {
    return Array.from(document.querySelectorAll('select')).find(e => !e.disabled && /\bward\b/i.test(attrs(e))) || null;
  }
  function setNativeValue(element, value) {
    const prototype = element.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    if (setter) setter.call(element, value); else element.value = value;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function clearUALPresentation() {
    document.documentElement.classList.remove('ual-simplified');
    document.getElementById('ual-simplify-style')?.remove();
    document.getElementById('ual-highlight-style')?.remove();
    document.querySelectorAll('.ual-field-highlight').forEach(element => element.classList.remove('ual-field-highlight'));
    document.getElementById('ual-tip')?.remove();
    const view = window.__ualViewSnapshot;
    delete window.__ualViewSnapshot;
    if (view?.activeElement?.isConnected !== false && typeof view?.activeElement?.focus === 'function') view.activeElement.focus({ preventScroll: true });
    if (view && typeof window.scrollTo === 'function') window.scrollTo(view.x, view.y);
  }
  function showTip(text) {
    let tip = document.getElementById('ual-tip');
    if (!tip) {
      tip = document.createElement('div'); tip.id = 'ual-tip';
      Object.assign(tip.style, { position: 'fixed', zIndex: 2147483647, right: '18px', bottom: '18px', maxWidth: '340px', padding: '16px', borderRadius: '12px', background: '#10233f', color: 'white', font: '16px/1.5 Arial', boxShadow: '0 5px 28px #0005' });
      document.body.append(tip);
    }
    tip.textContent = text;
  }
  function highlightPropertyField() {
    if (!isDemoPortal()) return { error: 'Open the UAL demonstration portal to highlight its Property ID field.' };
    const input = findPropertyInput();
    if (!input) return { error: 'No labeled Property Identification Number input was found on this page.' };
    if (!window.__ualViewSnapshot) window.__ualViewSnapshot = { activeElement: document.activeElement, x: window.scrollX || 0, y: window.scrollY || 0 };
    if (!document.getElementById('ual-highlight-style')) {
      const highlightStyle = document.createElement('style'); highlightStyle.id = 'ual-highlight-style';
      highlightStyle.textContent = '.ual-field-highlight{outline:4px solid #e9a900!important;outline-offset:4px!important;box-shadow:0 0 0 7px #f7d87599!important}';
      document.head.append(highlightStyle);
    }
    document.querySelectorAll('.ual-field-highlight').forEach(element => element.classList.remove('ual-field-highlight'));
    input.classList.add('ual-field-highlight');
    input.scrollIntoView({ behavior: 'smooth', block: 'center' });
    input.focus({ preventScroll: true });
    showTip('Enter the Property Identification Number printed on your previous property tax receipt. UAL will not change this field.');
    return { found: true, label: input.labels?.[0]?.innerText || input.getAttribute('aria-label') || 'Property Identification Number' };
  }
  function fillDemoFields(message) {
    if (!isDemoPortal()) return { error: 'Open http://localhost:5173/portal before filling demo fields.' };
    const propertyId = String(message.propertyId || '').trim().toUpperCase();
    const ward = String(message.ward || '');
    if (!/^BBMP-\d{4}$/.test(propertyId)) return { error: 'Property ID must match the synthetic demo format BBMP-2048.' };
    if (!allowedWards.includes(ward)) return { error: 'Select one of the listed synthetic demo wards.' };
    const property = findPropertyInput(), wardSelect = findWardSelect();
    if (!property || !wardSelect) return { error: 'Could not find both a labeled Property ID field and Ward selector on this page.' };
    const conflicts = [];
    if (property.value && property.value.trim().toUpperCase() !== propertyId) conflicts.push('Property ID');
    if (wardSelect.value && wardSelect.value !== ward) conflicts.push('Ward');
    if (conflicts.length && !message.allowOverwrite) return { confirmation_required: true, conflictFields: conflicts, message: 'Existing portal values were left unchanged.' };
    const wardOption = Array.from(wardSelect.options).find(option => option.value === ward || option.textContent.trim() === ward);
    if (!wardOption) return { error: `The selected ward (${ward}) is not an option on this portal.` };
    setNativeValue(property, propertyId);
    setNativeValue(wardSelect, wardOption.value);
    const populated = property.value.toUpperCase() === propertyId && wardSelect.value === wardOption.value;
    return populated ? { populated: true, message: 'Property ID and Ward values were populated and confirmed.' } : { error: 'The page did not retain both values after input/change events.' };
  }
  function simplify(enabled) {
    if (!enabled) { clearUALPresentation(); return { ok: true, enabled: false }; }
    let style = document.getElementById('ual-simplify-style');
    if (!style) {
      style = document.createElement('style'); style.id = 'ual-simplify-style';
      style.textContent = `
        html.ual-simplified { font-size: 18px !important; line-height: 1.65 !important; color-scheme: light !important; }
        html.ual-simplified body { background: #f4f7fb !important; color: #14253d !important; font-family: Arial, sans-serif !important; line-height: 1.65 !important; }
        html.ual-simplified body * { text-shadow: none !important; background-image: none !important; }
        html.ual-simplified body :is(main,form,fieldset,section,article) { padding: 1rem !important; border-color: #d6e0ea !important; }
        html.ual-simplified body :is(p,li,label,small,td,th) { line-height: 1.65 !important; }
        html.ual-simplified body :is(main,form,section,article) { background-color: #fff !important; color: #14253d !important; border-radius: 10px !important; }
        html.ual-simplified body :is(input,select,textarea,button) { min-height: 46px !important; padding: .55rem .7rem !important; border: 2px solid #516b86 !important; border-radius: 6px !important; background-color: #fff !important; color: #14253d !important; }
        html.ual-simplified body :focus-visible { outline: 4px solid #e0a322 !important; outline-offset: 3px !important; }
        html.ual-simplified body :is(p,li,label) { max-width: 75ch; }
        .ual-field-highlight { outline: 4px solid #e9a900 !important; outline-offset: 4px !important; box-shadow: 0 0 0 7px #f7d87599 !important; }
      `;
      document.head.append(style);
    }
    document.documentElement.classList.add('ual-simplified');
    return { ok: true, enabled: true };
  }
  function classify(text, element) {
    if (isSensitive(element)) return 'sensitive_input';
    if (element.tagName === 'BUTTON' || element.tagName === 'A') return 'navigation_or_action';
    if (/property|assessment|parcel|ward|holding/i.test(text)) return 'property_identifier';
    if (/email|phone|mobile|contact/i.test(text)) return 'contact_details';
    if (/owner|applicant|birth|name|address/i.test(text)) return 'personal_information';
    if (/payment|card|bank|amount|upi/i.test(text)) return 'payment_information';
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(element.tagName)) return 'form_control';
    return 'informational_content';
  }
  function analyze() {
    const fields = Array.from(document.querySelectorAll('input,select,textarea,button,a')).map((element, index) => {
      const text = attrs(element), category = classify(text, element);
      if (category === 'sensitive_input') return { index, tag: element.tagName.toLowerCase(), category, excluded: true };
      return { index, tag: element.tagName.toLowerCase(), type: element.type || '', label: element.labels?.[0]?.innerText || element.getAttribute('aria-label') || element.name || element.id || '', placeholder: element.placeholder || '', text: element.innerText?.trim().slice(0, 100) || '', category };
    });
    return { title: document.title, url: location.href, headings: Array.from(document.querySelectorAll('h1,h2,h3')).map(x => x.innerText).filter(Boolean).slice(0, 20), fields, text: document.body.innerText.slice(0, 3000), fingerprint: `${document.title}|${document.querySelectorAll('form').length}|${document.querySelectorAll('input').length}` };
  }
  function demoState() {
    const portal = isDemoPortal(), property = portal ? findPropertyInput() : null, ward = portal ? findWardSelect() : null;
    const dues = portal && visible(document.querySelector('.dues')) && visible(document.querySelector('.amount'));
    const receipt = portal && visible(document.querySelector('.receipt'));
    return { portal, propertyField: !!property, wardField: !!ward, propertyFilled: !!property?.value.trim(), wardSelected: !!ward && allowedWards.includes(ward.value), duesVisible: !!dues, receiptVisible: !!receipt };
  }
  const handler = (message, _sender, sendResponse) => {
    try {
      if (message.type === 'UAL_PING') sendResponse({ alive: true, version: '0.2.0' });
      else if (message.type === 'ANALYZE') sendResponse(analyze());
      else if (message.type === 'SIMPLIFY') sendResponse(simplify(!!message.enabled));
      else if (message.type === 'FILL_DEMO_FIELDS') sendResponse(fillDemoFields(message));
      else if (message.type === 'HIGHLIGHT_PROPERTY_FIELD' || message.type === 'GUIDE') sendResponse(highlightPropertyField());
      else if (message.type === 'GET_DEMO_STATE') sendResponse(demoState());
      else if (message.type === 'VISIBLE_TEXT') {
        const receipt = document.querySelector('.receipt');
        const text = visible(receipt) ? receipt.innerText : '';
        sendResponse({ receipt_reference: text.match(/UAL-DEMO-[A-Z0-9-]+/)?.[0] || null, demo_marker: /DEMO ONLY/i.test(text) });
      } else sendResponse({ error: `Unsupported page action: ${message.type || 'unknown'}` });
    } catch (error) {
      sendResponse({ error: `UAL could not complete the page action: ${error instanceof Error ? error.message : String(error)}` });
    }
    return false;
  };
  chrome.runtime.onMessage.addListener(handler);
  window.__ualMessageHandler = handler;
})();
