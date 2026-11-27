import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AlertCircle, Brain, Bookmark, Check, ChevronRight, CircleCheck, Eye, FileText, Globe2, MapPin, RefreshCw, RotateCcw, Search, Send, ShieldCheck, Sparkles, WandSparkles, Wrench } from 'lucide-react';
import './styles.css';

type Task = { id: string; title: string; service_category: string; current_step: number; total_steps: number; status: string; page_url: string; page_fingerprint: string };
type Intent = { intent: string; service_category: string; confidence: number; explanation: string; response: string; workflow: string[] };
type PortalState = { error?: string; portal?: boolean; propertyField?: boolean; wardField?: boolean; propertyFilled?: boolean; wardSelected?: boolean; duesVisible?: boolean; receiptVisible?: boolean };
const API = 'http://localhost:8000/api';
const PROPERTY_WORKFLOW = ['Find your property', 'Enter Property ID', 'Review outstanding dues', 'Review payment details', 'Complete simulated payment', 'Verify receipt'];
const OTHER_WORKFLOWS: Record<string, string[]> = { pension_status: ['Choose pension service', 'Enter application reference', 'Review status'], certificate_services: ['Choose certificate', 'Review required documents', 'Track application'], general_government: ['Identify the service', 'Review requirements', 'Continue on the official portal'] };
const WARDS = ['Jayanagar', 'Basavanagudi', 'Indiranagar'];

async function call(path: string, init?: RequestInit) {
  const response = await fetch(API + path, { headers: { 'Content-Type': 'application/json' }, ...init });
  if (!response.ok) {
    let detail = 'Service unavailable';
    try { detail = (await response.json()).detail || detail; } catch { /* keep local message */ }
    throw new Error(detail);
  }
  return response.json();
}
function sendToTab<T = any>(type: string, data: Record<string, unknown> = {}): Promise<T> {
  return new Promise(resolve => {
    const api = (window as any).chrome;
    if (!api?.runtime?.sendMessage) return resolve({ error: 'Open this view in the UAL Chrome side panel.' } as T);
    api.tabs.query({ active: true, lastFocusedWindow: true }, (tabs: any[]) => {
      const tabError = api.runtime.lastError;
      const tabId = tabs?.[0]?.id;
      if (tabError || tabId === undefined) return resolve({ error: tabError?.message || 'No active browser tab is available.' } as T);
      let settled = false;
      const timer = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve({ error: 'UAL background did not respond within 18 seconds. Check the extension service worker and retry.' } as T);
      }, 18000);
      api.runtime.sendMessage({ channel: 'UAL_PAGE_REQUEST', requestId: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`, type, activeTabId: tabId, payload: data }, (response: any) => {
        if (settled) return;
        settled = true; window.clearTimeout(timer);
        const error = api.runtime.lastError;
        if (error) return resolve({ error: error.message || 'Could not communicate with the UAL background service worker.' } as T);
        if (!response) return resolve({ error: 'The UAL background service worker returned no response.', activeTabId: tabId } as T);
        if (type === 'UAL_DIAGNOSTICS') return resolve(response as T);
        if (!response.ok) return resolve(response as T);
        resolve({ ...response.data, activeTabId: response.activeTabId, activeTabUrl: response.activeTabUrl, hostPermission: response.hostPermission, contentScriptStatus: response.contentScriptStatus, injectionStatus: response.injectionStatus } as T);
      });
    });
  });
}

function App() {
  const portal = location.pathname === '/portal';
  const [request, setRequest] = useState('I want to check my property tax and understand how to pay it.');
  const [answer, setAnswer] = useState<Intent | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('assistant');
  const [page, setPage] = useState<any>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [task, setTask] = useState<Task | null>(null);
  const [workflowIndex, setWorkflowIndex] = useState(0);
  const [simplified, setSimplified] = useState(false);
  const [notice, setNotice] = useState('');
  const [propertyId, setPropertyId] = useState('');
  const [ward, setWard] = useState('');
  const [verification, setVerification] = useState('');
  const [diagnostics, setDiagnostics] = useState<any>(null);
  const [diagnosticsBusy, setDiagnosticsBusy] = useState(false);
  const [lastCommunicationError, setLastCommunicationError] = useState('');
  const [portalStep, setPortalStep] = useState(0);
  const [portalProperty, setPortalProperty] = useState('');
  const [portalWard, setPortalWard] = useState('');
  const [dues, setDues] = useState(false);
  const [receipt, setReceipt] = useState('');

  const isPropertyTask = answer?.intent === 'property_tax' || task?.service_category === 'property_tax';
  const steps = isPropertyTask ? PROPERTY_WORKFLOW : (answer?.workflow || OTHER_WORKFLOWS[task?.service_category || ''] || OTHER_WORKFLOWS.general_government);
  const currentStepLabel = steps[Math.min(workflowIndex, Math.max(0, steps.length - 1))] || 'Understand your request';
  const currentFieldName = workflowIndex <= 1 ? 'Property Identification Number' : workflowIndex === 2 ? 'Outstanding dues result' : workflowIndex === 3 ? 'Property tax amount' : workflowIndex === 4 ? 'Demo payment receipt' : 'Receipt reference';
  const currentInstruction = workflowIndex <= 1 ? 'Enter the Property Identification Number printed on your previous tax receipt.' : workflowIndex === 2 ? 'On the portal, select Check Dues yourself, then review the synthetic outstanding amount.' : workflowIndex === 3 ? 'Review the displayed property and payment details before proceeding.' : workflowIndex === 4 ? 'Initiate the simulated payment on the demo portal. UAL will not start it for you.' : 'Check the visible demo receipt and reference to verify this task.';

  async function refreshTasks() {
    try { setTasks(await call('/tasks')); }
    catch (e: any) { setError(`Citizen Memory is unavailable: ${e.message}`); }
  }
  async function inspectPage() {
    const result = await sendToTab('ANALYZE');
    setPage(result);
    setLastCommunicationError(result.error || '');
    return result;
  }
  async function runConnectionTest() {
    setDiagnosticsBusy(true); setLastCommunicationError('');
    const pageCheck: any = await sendToTab('UAL_DIAGNOSTICS');
    let backendStatus = 'unavailable';
    try { await call('/health'); backendStatus = 'available'; } catch { /* diagnostics reports service status */ }
    const result = { ...pageCheck, backendStatus, lastCommunicationError: pageCheck.lastCommunicationError || pageCheck.error || '' };
    setDiagnostics(result);
    setLastCommunicationError(result.lastCommunicationError);
    setDiagnosticsBusy(false);
  }
  useEffect(() => {
    if (!portal) {
      void refreshTasks();
      void inspectPage();
    }
  }, [portal]);

  async function askAssistant() {
    setBusy(true); setError(''); setNotice('');
    try {
      const result: Intent = await call('/assistant', { method: 'POST', body: JSON.stringify({ message: request }) });
      setAnswer(result);
      if (result.intent === 'property_tax') {
        setWorkflowIndex(1);
        setTab('assistant');
        setNotice('Property Tax Assistance identified. Enter the synthetic demo details below to continue.');
      }
    } catch (e: any) { setError(`Assistant service unavailable: ${e.message}`); }
    finally { setBusy(false); }
  }

  async function persistStep(step: number, status = 'in_progress') {
    setWorkflowIndex(step);
    if (task) {
      try {
        await call(`/tasks/${task.id}`, { method: 'PUT', body: JSON.stringify({ current_step: step, status, page_url: page?.url || task.page_url, page_fingerprint: page?.fingerprint || task.page_fingerprint }) });
        setTask({ ...task, current_step: step, status });
        await refreshTasks();
      } catch (e: any) { setError(`Could not save this checkpoint: ${e.message}`); }
      return;
    }
    if (answer) await saveTask(step, status);
  }

  async function saveTask(current = workflowIndex, status = 'in_progress') {
    const intent = answer?.intent || task?.service_category || 'property_tax';
    const total = intent === 'property_tax' ? PROPERTY_WORKFLOW.length : (answer?.workflow.length || task?.total_steps || 4);
    try {
      if (task) {
        await call(`/tasks/${task.id}`, { method: 'PUT', body: JSON.stringify({ current_step: current, status, page_url: page?.url || task.page_url, page_fingerprint: page?.fingerprint || task.page_fingerprint }) });
        setTask({ ...task, current_step: current, status });
      } else {
        const data = await call('/tasks', { method: 'POST', body: JSON.stringify({ title: answer?.service_category || 'Property Tax Assistance', service_category: intent, current_step: current, total_steps: total, status, page_url: page?.url || '', page_fingerprint: page?.fingerprint || '' }) });
        setTask({ id: data.id, title: answer?.service_category || 'Property Tax Assistance', service_category: intent, current_step: current, total_steps: total, status, page_url: page?.url || '', page_fingerprint: page?.fingerprint || '' });
      }
      await refreshTasks();
      setNotice('Workflow checkpoint saved. The property details themselves are not stored.');
    } catch (e: any) { setError(`Could not save progress: ${e.message}`); }
  }

  async function fillPortalFields() {
    setError(''); setNotice('');
    const value = propertyId.trim().toUpperCase();
    if (!/^BBMP-\d{4}$/.test(value)) { setError('For this synthetic demo, enter a Property ID in the format BBMP-2048.'); return; }
    if (!WARDS.includes(ward)) { setError('Select a demo ward before filling the portal.'); return; }
    let result: any = await sendToTab('FILL_DEMO_FIELDS', { propertyId: value, ward });
    if (result.error) { setError(result.error); return; }
    if (result.confirmation_required) {
      const proceed = window.confirm(`${result.conflictFields.join(' and ')} already contain different values on the portal. Replace them with the values you entered in UAL?`);
      if (!proceed) { setNotice('Portal fields were left unchanged.'); return; }
      result = await sendToTab('FILL_DEMO_FIELDS', { propertyId: value, ward, allowOverwrite: true });
    }
    if (result.error || !result.populated) { setError(result.error || result.message || 'UAL could not confirm that both portal fields were populated.'); return; }
    setNotice('Property ID and ward were filled and confirmed. Review them, then click Check Dues on the portal yourself.');
    await persistStep(2);
  }

  async function highlightPropertyField() {
    if (workflowIndex > 1) { setError('There is no Property ID field to highlight at this workflow step.'); return; }
    const result: any = await sendToTab('HIGHLIGHT_PROPERTY_FIELD', { field: 'property_id' });
    if (result.error || !result.found) { setError(result.error || result.message || 'Property ID field was not found on this page.'); return; }
    setNotice('Property Identification Number highlighted. The field was focused without changing its value.');
  }

  async function setReadingMode(enabled: boolean) {
    const result: any = await sendToTab('SIMPLIFY', { enabled });
    if (result.error || !result.ok) { setError(`Unable to simplify this page. ${result.error || result.message || ''}`); return; }
    setSimplified(enabled);
    setNotice(enabled ? 'Simplification enabled.' : 'Original website restored.');
  }

  async function getPortalState(): Promise<PortalState> {
    return await sendToTab('GET_DEMO_STATE');
  }

  async function verifyReceipt() {
    setError('');
    const evidence: any = await sendToTab('VISIBLE_TEXT');
    if (evidence.error) { setVerification('awaiting_confirmation'); setError(evidence.error); return false; }
    try {
      const result = await call('/verify', { method: 'POST', body: JSON.stringify({ receipt_reference: evidence.receipt_reference || null, demo_marker: evidence.demo_marker === true }) });
      setVerification(result.status);
      setNotice(`Verification ${result.status.replaceAll('_', ' ')}: ${result.message}`);
      return !!result.verified;
    } catch (e: any) { setError(`Receipt verifier unavailable: ${e.message}`); return false; }
  }

  async function nextWorkflowStep() {
    setError('');
    if (!isPropertyTask) {
      await persistStep(Math.min(workflowIndex + 1, steps.length));
      return;
    }
    if (workflowIndex <= 1) {
      const state = await getPortalState();
      if (state.error) { setError(state.error); return; }
      if (!state.portal) { setError('Open the UAL demo portal tab to continue this property-tax step.'); return; }
      if (!state.propertyFilled || !state.wardSelected) { setError('Fill and review the Property ID and Ward fields before continuing.'); return; }
      await persistStep(2); setNotice('Property fields confirmed. Next, click Check Dues on the portal.'); return;
    }
    if (workflowIndex === 2) {
      const state = await getPortalState();
      if (state.error) { setError(state.error); return; }
      if (!state.duesVisible) { setError('Review dues first: click Check Dues on the demo portal.'); return; }
      await persistStep(3); setNotice('Synthetic dues are visible. Review the amount before moving to payment details.'); return;
    }
    if (workflowIndex === 3) {
      const state = await getPortalState();
      if (state.error) { setError(state.error); return; }
      if (!state.duesVisible) { setError('The property tax details are not visible yet. Check dues on the portal first.'); return; }
      await persistStep(4); setNotice('Payment details reviewed. The next action remains on the demo portal.'); return;
    }
    if (workflowIndex === 4) {
      const state = await getPortalState();
      if (state.error) { setError(state.error); return; }
      if (!state.receiptVisible) { setError('Start the simulated payment from the demo portal. UAL will not initiate it for you.'); return; }
      await persistStep(5); setNotice('Demo receipt found. Verify it to complete this workflow.'); return;
    }
    if (workflowIndex >= 5) {
      const verified = await verifyReceipt();
      if (verified) await persistStep(6, 'completed');
    }
  }

  async function resumeTask(saved: Task) {
    let latest: Task;
    try { latest = await call(`/tasks/${saved.id}`); }
    catch (e: any) { setError(`Could not recover this task: ${e.message}`); return; }
    setTask(latest);
    setAnswer(null);
    setWorkflowIndex(Math.min(latest.current_step, latest.total_steps));
    setTab('workflow');
    const inspected = await inspectPage();
    if (latest.page_url && inspected?.url && (latest.page_url !== inspected.url || (latest.page_fingerprint && latest.page_fingerprint !== inspected.fingerprint))) {
      setNotice('Task recovered. The active page or its structure changed; review the reanalysed page before continuing.');
    } else setNotice('Task recovered from the saved checkpoint.');
  }

  function portalCheck() {
    setDues(portalProperty.trim().toUpperCase() === 'BBMP-2048' && WARDS.includes(portalWard));
    setPortalStep(2);
  }
  function simulatePayment() {
    const ref = 'UAL-DEMO-' + Math.random().toString(36).slice(2, 8).toUpperCase();
    setReceipt(ref); setPortalStep(3);
  }

  if (portal) return <div className="portal">
    <div className="demo-banner">DEMO ONLY · Synthetic data · No real government service or payment</div>
    <header className="govhead"><div className="seal">K</div><div><strong>KARNATAKA MUNICIPAL SERVICES</strong><small>Bruhat Bengaluru Mahanagara Palike · Citizen Services</small></div><button className="lang">ಕನ್ನಡ | English</button></header>
    <nav className="govnav">Home　 /　 Citizen Services　 /　 Property Tax</nav>
    <main className="govmain"><p className="eyebrow">PROPERTY TAX SERVICES</p><h1>Check your property tax</h1><p className="muted">Look up outstanding property tax dues and view payment details.</p>
      <div className="portal-card"><h2>{portalStep < 2 ? 'Property lookup' : 'Property tax details'}</h2><p>Enter the property identification details as shown on your previous tax receipt.</p>
        <div className="formrow"><label htmlFor="property-id">Property Identification Number</label><input id="property-id" name="propertyId" placeholder="Example: BBMP-2048" aria-label="Property Identification Number" value={portalProperty} onChange={e => setPortalProperty(e.target.value)} /><small>Find this number on a previous property tax receipt.</small></div>
        {portalStep < 2 ? <><label htmlFor="ward">Ward</label><select id="ward" name="ward" aria-label="Ward" value={portalWard} onChange={e => setPortalWard(e.target.value)}><option value="">Select a ward</option>{WARDS.map(x => <option key={x} value={x}>{x}</option>)}</select><button className="primary" onClick={portalCheck}>Check Dues</button></> : dues ? <div className="dues"><h3>Property found</h3><p>Owner: <b>Asha Rao</b></p><p>Ward: <b>{portalWard}</b></p><p>Property ID: <b>{portalProperty.toUpperCase()}</b></p><div className="amount"><span>Outstanding property tax</span><b>₹1,250</b></div>{portalStep === 2 && <button className="primary" onClick={simulatePayment}>Pay demo tax</button>}{receipt && <div className="receipt"><CircleCheck/><h3>Demo payment recorded</h3><p>DEMO ONLY · No money was collected.</p><p>Reference: <b>{receipt}</b></p><p>Payment status: <b>Successful (simulation)</b></p></div>}</div> : <div className="notice">No matching demo property and ward found. Use BBMP-2048 and select a listed ward. <button className="outline" onClick={() => setPortalStep(1)}>Try again</button></div>}</div>
      <p className="fine">This is a demonstration portal. Do not enter real personal or financial information.</p>
    </main><a className="open-ext" href="#" onClick={e => { e.preventDefault(); alert('Open the UAL extension from the Chrome toolbar to use guided assistance.'); }}>Need help? Open UAL companion</a>
  </div>;

  return <div className="shell">
    <header className="top"><div className="brand"><div className="brand-icon"><ShieldCheck size={21}/></div><div><b>UAL</b><small>UNIVERSAL ACCESS LAYER</small></div></div><div className="connection"><i/> Local intelligence <span className="version">DEMO</span></div></header>
    <div className="welcome"><div><span className="eyebrow">YOUR GOVERNMENT SERVICES COMPANION</span><h1>Public services, <em>made clearer.</em></h1><p>Understand a service, get guided through the page, and pick up where you left off.</p></div><div className="hero-art"><Sparkles size={26}/><span>UNDERSTAND</span><span>→</span><span>SIMPLIFY</span></div></div>
    <nav className="tabs">{[['assistant','Assistant',Sparkles],['website','This page',Eye],['workflow','My steps',ChevronRight],['memory','Saved tasks',Brain],['diagnostics','Diagnostics',Wrench]].map(([id,label,Icon]: any) => <button className={tab === id ? 'active' : ''} onClick={() => setTab(id)} key={id}><Icon size={16}/>{label}</button>)}</nav>
    {error && <div className="error" role="alert"><AlertCircle size={17}/>{error}<button onClick={() => setError('')}>Dismiss</button></div>}
    {notice && <div className="noticebar" role="status">{notice}<button aria-label="Dismiss notice" onClick={() => setNotice('')}>×</button></div>}

    {tab === 'assistant' && <section className="content">
      <div className="section-title"><div><span className="eyebrow">01 · UNDERSTAND</span><h2>What would you like to do?</h2></div><span className="local"><i/>Private local demo</span></div>
      <div className="assistant-card"><div className="bot-avatar"><Sparkles size={19}/></div><div className="chat"><b>UAL Assistant</b><p>Tell me what you need help with. I’ll find the right service and lay out the next steps.</p>
        {answer && <div className="answer"><p>{answer.response}</p><div className="intent"><span className="intent-icon"><Search size={15}/></span><div><small>IDENTIFIED SERVICE</small><b>{answer.service_category}</b></div><strong>{Math.round(answer.confidence * 100)}% match</strong></div>
          <div className="plan"><b>Guided workflow</b>{(answer.intent === 'property_tax' ? PROPERTY_WORKFLOW : answer.workflow).map((item, i) => <div className="planrow" key={item}><span>{i + 1}</span>{item}</div>)}</div>
          {answer.intent === 'property_tax' && <PropertyGuidance propertyId={propertyId} setPropertyId={setPropertyId} ward={ward} setWard={setWard} onFill={fillPortalFields} onHighlight={highlightPropertyField} canHighlight={workflowIndex <= 1} simplified={simplified} onSimplify={() => setReadingMode(true)} onRestore={() => setReadingMode(false)} currentStep={currentStepLabel} currentFieldName={currentFieldName} currentInstruction={currentInstruction} workflowIndex={workflowIndex} onNext={nextWorkflowStep} onSave={() => saveTask()} verification={verification}/>}
          <button className="outline save-task" onClick={() => saveTask()}><Bookmark size={15}/>{task ? 'Save progress' : 'Save this task'}</button>
        </div>}
        <div className="inputbox"><textarea value={request} onChange={e => setRequest(e.target.value)} aria-label="Describe the government service you need" onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void askAssistant(); } }}/><button className="send" disabled={busy || request.length < 3} onClick={() => void askAssistant()} aria-label="Send request">{busy ? <RefreshCw className="spin" size={18}/> : <Send size={17}/>}</button></div>
        <div className="suggestions"><span>Try:</span>{['Check property tax','Track pension status','Apply for a certificate'].map(x => <button key={x} onClick={() => setRequest(x)}>{x}</button>)}</div>
      </div></div>
    </section>}

    {tab === 'website' && <section className="content"><div className="section-title"><div><span className="eyebrow">02 · TRANSFORM</span><h2>Current website</h2></div><button className="outline" onClick={() => void inspectPage()}><RefreshCw size={15}/> Reanalyse</button></div>
      <div className="feature-grid"><article className="card wide"><div className="card-head"><Globe2/><div><b>Page intelligence</b><small>On-demand page inspection</small></div></div>{page?.error ? <p className="muted">{page.error}</p> : page ? <><h3>{page.title}</h3><p className="url">{page.url}</p><div className="stats"><span><b>{page.headings?.length || 0}</b> headings</span><span><b>{page.fields?.length || 0}</b> controls</span></div><div className="chips">{[...new Set(page.fields?.map((f: any) => f.category) || [])].map((x: any) => <span key={x}>{x.replaceAll('_',' ')}</span>)}</div></> : <p className="muted">Inspect the active tab to understand its headings and safe form controls.</p>}</article>
        <AdaptiveControls simplified={simplified} onSimplify={() => setReadingMode(true)} onRestore={() => setReadingMode(false)} />
        <article className="card"><div className="card-head"><MapPin/><div><b>AI Cursor Companion</b><small>Property Tax · Enter Property ID</small></div></div><p className="muted">Locate the demo portal’s labeled Property Identification Number field.</p><button className="outline" onClick={() => void highlightPropertyField()}><MapPin size={15}/> Highlight This Field</button></article>
      </div><p className="privacy"><ShieldCheck size={15}/> Passwords, OTPs, Aadhaar, PAN and payment credential fields are excluded from inspected field details.</p>
    </section>}

    {tab === 'workflow' && <section className="content"><div className="section-title"><div><span className="eyebrow">03 · ASSIST</span><h2>Guided workflow</h2></div></div>
      {!task ? <div className="empty"><FileText size={24}/><b>No active task yet</b><p>Ask the assistant to create a service plan, then save it here.</p><button className="outline" onClick={() => setTab('assistant')}>Start with assistant</button></div> : <>
        <div className="workflow"><div className="workflow-head"><div className="intent-icon"><FileText/></div><div><span className="eyebrow">{task.service_category.replaceAll('_',' ').toUpperCase()}</span><h3>{task.title}</h3></div><span className={'status ' + task.status}>{task.status.replaceAll('_',' ')}</span></div>
          {steps.map((item, i) => <div className={'step ' + (i < workflowIndex ? 'done' : i === workflowIndex ? 'current' : '')} key={item}><span>{i < workflowIndex ? <CircleCheck size={18}/> : i + 1}</span><div><b>{item}</b>{i === workflowIndex && <small>Current checkpoint</small>}</div></div>)}
          <div className="bar"><i style={{ width: `${Math.min(100, Math.round(workflowIndex / steps.length * 100))}%` }}/></div>
          <button className="primary workflow-next" onClick={() => void nextWorkflowStep()}>{isPropertyTask && workflowIndex >= 5 ? 'Verify receipt' : 'Next Step'} <ChevronRight size={15}/></button>
        </div>
        {isPropertyTask && <><section className="card companion-card"><span className="eyebrow">AI CURSOR COMPANION</span><h3>Current step: {currentStepLabel}</h3><b className="field-name">Field: {currentFieldName}</b><p className="muted">Instruction: “{currentInstruction}”</p><button className="outline" disabled={workflowIndex > 1} onClick={() => void highlightPropertyField()}><MapPin size={15}/> Highlight Next Field</button> <button className="primary" onClick={() => void nextWorkflowStep()}>Next Step <ChevronRight size={15}/></button></section>
        <PropertyInputs propertyId={propertyId} setPropertyId={setPropertyId} ward={ward} setWard={setWard} onFill={fillPortalFields}/></>}
        <AdaptiveControls simplified={simplified} onSimplify={() => setReadingMode(true)} onRestore={() => setReadingMode(false)} />
        {verification && <p className={'verification-status ' + verification}>Verification status: {verification.replaceAll('_',' ')}</p>}
        <button className="outline save-task" onClick={() => saveTask()}><Bookmark size={15}/> Save progress</button>
      </>}
    </section>}

    {tab === 'memory' && <section className="content"><div className="section-title"><div><span className="eyebrow">04 · REMEMBER</span><h2>Saved tasks</h2></div><button className="outline" onClick={() => void refreshTasks()}><RefreshCw size={15}/> Refresh</button></div>
      {tasks.length === 0 ? <div className="empty"><Brain size={24}/><b>Your saved tasks will appear here</b><p>Progress is stored in the local prototype database. Property details are not saved.</p><button className="outline" onClick={() => setTab('assistant')}>Create a task</button></div> : <div className="tasklist">{tasks.map(saved => <article className="taskcard" key={saved.id}><div className="taskico"><FileText size={18}/></div><div className="taskbody"><b>{saved.title}</b><small>{saved.service_category.replaceAll('_',' ')} · checkpoint {saved.current_step} of {saved.total_steps}</small><div className="bar"><i style={{ width: `${Math.round(saved.current_step / saved.total_steps * 100)}%` }}/></div></div><span className={'status ' + saved.status}>{saved.status.replaceAll('_',' ')}</span><button className="outline" onClick={() => void resumeTask(saved)}><RefreshCw size={14}/> Resume</button></article>)}</div>}
      <div className="recovery-note"><ShieldCheck size={17}/><span><b>Task recovery</b><br/>Checkpoints keep the workflow step and page fingerprint, never the entered Property ID.</span></div>
    </section>}
    {tab === 'diagnostics' && <section className="content diagnostics-page"><div className="section-title"><div><span className="eyebrow">05 · CONNECTION</span><h2>Connection diagnostics</h2></div></div>
      <p className="muted">Check active-tab access, content-script messaging, page analysis, and the local API. Site access is limited to localhost development pages.</p>
      <button className="primary" disabled={diagnosticsBusy} onClick={() => void runConnectionTest()}><RefreshCw className={diagnosticsBusy ? 'spin' : ''} size={15}/> Run Connection Test</button>
      {!diagnostics ? <div className="empty diag-empty"><Wrench size={23}/><b>Diagnostics have not run yet</b><p>Run the connection test while the demo portal tab is active.</p></div> : <div className="diagnostic-list">
        <Diagnostic label="Active tab URL" value={diagnostics.activeTabUrl || 'Unavailable'} detail={diagnostics.activeTabId === undefined ? '' : `Tab ID ${diagnostics.activeTabId}`} ok={!!diagnostics.activeTabUrl}/>
        <Diagnostic label="Localhost host permission / activeTab" value={diagnostics.hostPermission === 'granted' ? 'Granted' : diagnostics.hostPermission === 'activeTab' ? 'Temporary activeTab access' : diagnostics.hostPermission === 'missing' ? 'Missing' : diagnostics.hostPermission || 'Not applicable'} ok={['granted','activeTab'].includes(diagnostics.hostPermission)}/>
        <Diagnostic label="Content script" value={diagnostics.contentScriptStatus || 'Unavailable'} ok={diagnostics.contentScriptStatus === 'available'}/>
        <Diagnostic label="Injection status" value={diagnostics.injectionStatus || 'Not attempted'} ok={['already_available','injected'].includes(diagnostics.injectionStatus)}/>
        <Diagnostic label="Page analysis round-trip" value={diagnostics.pageAnalysisStatus || 'Failed'} ok={diagnostics.pageAnalysisStatus === 'success'}/>
        <Diagnostic label="Background service worker" value={diagnostics.backgroundStatus || (diagnostics.error ? 'No response' : 'Unknown')} ok={diagnostics.backgroundStatus === 'running'}/>
        <Diagnostic label="FastAPI backend" value={diagnostics.backendStatus || 'Unavailable'} ok={diagnostics.backendStatus === 'available'}/>
        <div className="diagnostic-error"><b>Last communication error</b><p>{lastCommunicationError || diagnostics.lastCommunicationError || 'None'}</p></div>
      </div>}
    </section>}
    <footer><span><ShieldCheck size={14}/> Synthetic demo · No real government connection</span><a href="http://localhost:5173/portal" target="_blank" rel="noreferrer">Open demo tax portal ↗</a></footer>
  </div>;
}

function PropertyInputs({ propertyId, setPropertyId, ward, setWard, onFill }: any) {
  return <div className="card citizen-input-card"><div className="card-head"><FileText/><div><b>Citizen Input</b><small>Use synthetic demonstration details only</small></div></div><label htmlFor="ual-property-id">Property Identification Number</label><input id="ual-property-id" value={propertyId} maxLength={9} placeholder="Enter Property ID · e.g. BBMP-2048" onChange={e => setPropertyId(e.target.value.toUpperCase())}/><label htmlFor="ual-ward">Ward</label><select id="ual-ward" value={ward} onChange={e => setWard(e.target.value)}><option value="">Select Ward</option>{WARDS.map(x => <option key={x}>{x}</option>)}</select><button className="primary" onClick={onFill}><Check size={15}/> Fill Portal Fields</button></div>;
}
function PropertyGuidance(props: any) {
  return <div className="property-guidance"><PropertyInputs {...props}/><div className="guidance-tools"><div className="card-head"><WandSparkles/><div><b>Adaptive Website Controls</b><small>Change and restore the active page</small></div></div><AdaptiveButtons {...props}/><div className="card-head cursor-head"><MapPin/><div><b>AI Cursor Companion</b><small>Current step: {props.currentStep}</small></div></div><b className="field-name">Field: {props.currentFieldName}</b><p className="instruction">{props.currentInstruction}</p><button className="outline" disabled={!props.canHighlight} onClick={props.onHighlight}><MapPin size={15}/> Highlight This Field</button><button className="primary" onClick={props.onNext}>Next Step <ChevronRight size={15}/></button>{props.verification && <p className={'verification-status ' + props.verification}>Verification: {props.verification.replaceAll('_',' ')}</p>}</div></div>;
}
function AdaptiveButtons({ simplified, onSimplify, onRestore }: any) {
  return <div className="adaptive-buttons"><button className="primary" disabled={simplified} onClick={onSimplify}><Sparkles size={15}/> Simplify This Website</button><button className="outline" onClick={onRestore}><RotateCcw size={15}/> Restore Original Website</button></div>;
}
function AdaptiveControls(props: any) {
  return <article className="card adaptive-card"><div className="card-head"><Eye/><div><b>Adaptive Website Controls</b><small>Improve the current page while preserving its controls</small></div></div><AdaptiveButtons {...props}/></article>;
}
function Diagnostic({ label, value, detail, ok }: { label: string; value: string; detail?: string; ok: boolean }) {
  return <div className="diagnostic-row"><span className={'diagnostic-dot ' + (ok ? 'ok' : 'bad')}/><div><b>{label}</b>{detail && <small>{detail}</small>}</div><strong className={ok ? 'ok-text' : 'bad-text'}>{value}</strong></div>;
}

createRoot(document.getElementById('root')!).render(<App/>);
