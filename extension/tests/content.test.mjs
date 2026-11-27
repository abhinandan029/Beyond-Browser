import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const source = fs.readFileSync(path.join(root, 'extension/content/content.js'), 'utf8');

class ClassList {
  values = new Set();
  add(value) { this.values.add(value); }
  remove(value) { this.values.delete(value); }
  contains(value) { return this.values.has(value); }
  toggle(value, force) { const on = force ?? !this.values.has(value); on ? this.add(value) : this.remove(value); return on; }
}
class Element {
  constructor(tagName, options = {}) {
    this.tagName = tagName.toUpperCase(); this.id = options.id || ''; this.name = options.name || '';
    this.type = options.type || ''; this.placeholder = options.placeholder || ''; this.disabled = !!options.disabled;
    this.labels = options.label ? [{ innerText: options.label }] : [];
    this.attributes = options.attributes || {}; this.innerText = options.innerText || ''; this.textContent = options.textContent || this.innerText;
    this.classList = new ClassList(); this.style = {}; this.events = []; this.focused = false; this.scrolled = false;
    this.offsetWidth = 100; this.offsetHeight = 30; this.options = options.options || [];
    this._value = options.value || ''; this.children = [];
  }
  get value() { return this._value; }
  set value(value) { this._value = String(value); }
  getAttribute(name) { return this.attributes[name] || null; }
  getClientRects() { return [{}]; }
  dispatchEvent(event) { this.events.push(event.type); return true; }
  scrollIntoView() { this.scrolled = true; }
  focus() { this.focused = true; }
  append(element) { element.parent = this; this.children.push(element); }
  remove() { this.removed = true; if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
}
class HTMLInputElement extends Element { constructor(options) { super('input', options); } }
class HTMLSelectElement extends Element { constructor(options) { super('select', options); } }

function makeHarness({ url = 'http://localhost:5173/portal', propertyValue = '', wardValue = '', receiptText = '' } = {}) {
  const property = new HTMLInputElement({ id: 'property-id', name: 'propertyId', type: 'text', label: 'Property Identification Number', attributes: { 'aria-label': 'Property Identification Number' }, placeholder: 'Example: BBMP-2048', value: propertyValue });
  const ward = new HTMLSelectElement({ id: 'ward', name: 'ward', label: 'Ward', attributes: { 'aria-label': 'Ward' }, value: wardValue, options: [{ value: '', textContent: 'Select a ward' }, ...['Jayanagar', 'Basavanagudi', 'Indiranagar'].map(value => ({ value, textContent: value }))] });
  const dues = new Element('section', { innerText: 'Property found Outstanding property tax ₹1,250' });
  const amount = new Element('div', { innerText: '₹1,250' });
  const receipt = new Element('section', { innerText: receiptText });
  const head = new Element('head'); const body = new Element('body', { innerText: `DEMO ONLY ${receiptText}` }); const rootElement = new Element('html');
  const idMap = new Map([[property.id, property], [ward.id, ward]]);
  const document = {
    title: 'Demo Property Tax', body, head, documentElement: rootElement,
    createElement: tag => new Element(tag),
    getElementById: id => idMap.get(id) || [...head.children, ...body.children].find(x => x.id === id) || null,
    querySelectorAll(selector) {
      if (selector === 'input') return [property];
      if (selector === 'select') return [ward];
      if (selector === 'input,select,textarea,button,a') return [property, ward];
      if (selector === 'h1,h2,h3') return [];
      if (selector === '.ual-field-highlight') return [property, ward].filter(x => x.classList.contains('ual-field-highlight'));
      return [];
    },
    querySelector(selector) {
      if (selector === '.dues') return dues;
      if (selector === '.amount') return amount;
      if (selector === '.receipt') return receipt;
      return null;
    }
  };
  const listeners = new Set();
  const context = {
    window: {}, document, location: new URL(url), chrome: { runtime: { onMessage: { addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn) } } },
    HTMLInputElement, HTMLSelectElement, Event: class { constructor(type, options) { this.type = type; this.bubbles = options.bubbles; } },
    console
  };
  vm.runInNewContext(source, context, { filename: 'content.js' });
  function send(message) { let response; [...listeners].at(-1)(message, {}, value => { response = value; }); return response; }
  function reinject() { vm.runInNewContext(source, context, { filename: 'content.js' }); }
  return { send, reinject, listenerCount: () => listeners.size, property, ward, rootElement, document, head, body, idMap };
}

test('fills only the demo portal fields and emits input/change events', () => {
  const h = makeHarness();
  const result = h.send({ type: 'FILL_DEMO_FIELDS', propertyId: 'BBMP-2048', ward: 'Jayanagar' });
  assert.equal(result.populated, true);
  assert.equal(h.property.value, 'BBMP-2048');
  assert.equal(h.ward.value, 'Jayanagar');
  assert.deepEqual(h.property.events, ['input', 'change']);
  assert.deepEqual(h.ward.events, ['input', 'change']);
});

test('matches the property field by its semantic label instead of another empty input', () => {
  const h = makeHarness();
  h.property.id = 'tax-reference';
  h.property.name = 'assessmentRef';
  h.property.attributes = {};
  const unrelated = new HTMLInputElement({ id: 'owner-name', name: 'owner', label: 'Owner Name', type: 'text' });
  const originalQuery = h.document.querySelectorAll.bind(h.document);
  h.document.querySelectorAll = selector => selector === 'input' ? [unrelated, h.property] : originalQuery(selector);
  const result = h.send({ type: 'FILL_DEMO_FIELDS', propertyId: 'BBMP-2048', ward: 'Jayanagar' });
  assert.equal(result.populated, true);
  assert.equal(h.property.value, 'BBMP-2048');
  assert.equal(unrelated.value, '');
});

test('does not overwrite existing values unless the user confirms', () => {
  const h = makeHarness({ propertyValue: 'BBMP-1000', wardValue: 'Basavanagudi' });
  const blocked = h.send({ type: 'FILL_DEMO_FIELDS', propertyId: 'BBMP-2048', ward: 'Jayanagar' });
  assert.equal(blocked.confirmation_required, true);
  assert.equal(h.property.value, 'BBMP-1000');
  assert.equal(h.ward.value, 'Basavanagudi');
  const confirmed = h.send({ type: 'FILL_DEMO_FIELDS', propertyId: 'BBMP-2048', ward: 'Jayanagar', allowOverwrite: true });
  assert.equal(confirmed.populated, true);
  assert.equal(h.property.value, 'BBMP-2048');
  assert.equal(h.ward.value, 'Jayanagar');
});

test('refuses to fill a non-demo page or invalid property identifier', () => {
  assert.match(makeHarness({ url: 'https://example.gov/service' }).send({ type: 'FILL_DEMO_FIELDS', propertyId: 'BBMP-2048', ward: 'Jayanagar' }).error, /portal/i);
  assert.match(makeHarness().send({ type: 'FILL_DEMO_FIELDS', propertyId: 'not-real', ward: 'Jayanagar' }).error, /synthetic demo format/i);
});

test('highlights and focuses the labeled Property ID field without changing its value', () => {
  const h = makeHarness({ propertyValue: 'BBMP-2048' });
  const result = h.send({ type: 'HIGHLIGHT_PROPERTY_FIELD' });
  assert.equal(result.found, true);
  assert.equal(h.property.value, 'BBMP-2048');
  assert.equal(h.property.focused, true);
  assert.equal(h.property.scrolled, true);
  assert.equal(h.property.classList.contains('ual-field-highlight'), true);
  assert.match(h.document.getElementById('ual-tip').textContent, /Property Identification Number/);
});

test('fails clearly when no property identifier control can be identified', () => {
  const h = makeHarness();
  h.property.id = 'other-input';
  h.property.name = 'owner';
  h.property.labels = [];
  h.property.attributes = {};
  h.property.placeholder = 'Enter your name';
  const result = h.send({ type: 'HIGHLIGHT_PROPERTY_FIELD' });
  assert.match(result.error, /Property Identification Number input was found/i);
});

test('simplify enables reading styles and restore removes all UAL presentation changes', () => {
  const h = makeHarness();
  assert.equal(h.send({ type: 'SIMPLIFY', enabled: true }).ok, true);
  assert.equal(h.rootElement.classList.contains('ual-simplified'), true);
  assert.ok(h.document.getElementById('ual-simplify-style'));
  h.send({ type: 'HIGHLIGHT_PROPERTY_FIELD' });
  assert.ok(h.document.getElementById('ual-highlight-style'));
  assert.equal(h.send({ type: 'SIMPLIFY', enabled: false }).enabled, false);
  assert.equal(h.rootElement.classList.contains('ual-simplified'), false);
  assert.equal(h.document.getElementById('ual-simplify-style'), null);
  assert.equal(h.document.getElementById('ual-highlight-style'), null);
  assert.equal(h.document.getElementById('ual-tip'), null);
  assert.equal(h.property.classList.contains('ual-field-highlight'), false);
});

test('reports safe portal state and extracts verification only from the receipt block', () => {
  const h = makeHarness({ propertyValue: 'BBMP-2048', wardValue: 'Jayanagar', receiptText: 'DEMO ONLY UAL-DEMO-AB1234' });
  const state = h.send({ type: 'GET_DEMO_STATE' });
  assert.equal(state.portal, true);
  assert.equal(state.propertyFilled, true);
  assert.equal(state.wardSelected, true);
  assert.equal(state.duesVisible, true);
  assert.equal(h.send({ type: 'VISIBLE_TEXT' }).receipt_reference, 'UAL-DEMO-AB1234');
});

test('reinjecting after an extension reload replaces the old page listener', () => {
  const h = makeHarness();
  h.reinject();
  assert.equal(h.listenerCount(), 1);
  assert.equal(h.send({ type: 'ANALYZE' }).title, 'Demo Property Tax');
});

test('responds to the background content-script readiness probe', () => {
  const result = makeHarness().send({ type: 'UAL_PING' });
  assert.equal(result.alive, true);
  assert.equal(result.version, '0.2.0');
});
