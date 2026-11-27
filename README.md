# Universal Access Layer (UAL)

A working prototype for an accessible browser companion. The demo uses synthetic property tax information and local deterministic intent recognition; it does not connect to government systems or payment providers.

## Stack

- React, TypeScript and Vite for the responsive interface and demo portal
- Chrome Manifest V3 side panel, content script and service worker
- FastAPI/Pydantic REST API with SQLite persistence
- Explainable local intent and DOM classification heuristics; no paid API key

## Requirements

Windows 10/11, Python 3.11+, Node.js 20.19+ or 22.12+, Chrome. Run commands from the repository root in PowerShell.

## Run the backend

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python -m uvicorn backend.app.main:app --reload --port 8000
```

Health check: http://localhost:8000/api/health

Run backend tests from the repository root with `python -m unittest discover -s backend/tests`. Run extension message and DOM interaction tests with `cd frontend; npm run test:extension`.

## Build the web interface and extension

Run the build helper from the repository root (after `npm install` in `frontend`):

```powershell
cd frontend
npm install
cd ..
.\scripts\build-extension.ps1
```

The demo portal is available at http://localhost:5173/portal (start it with `cd frontend` then `npm run dev` in a separate terminal). The packaged side panel opens from the Chrome toolbar action.

## Load the Chrome extension

1. Complete the extension build copy steps above.
2. Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select this repository's `extension` folder.
3. Start the API on port 8000 and open `http://localhost:5173/portal` in a regular Chrome tab.
4. After reloading the unpacked extension, open **Details → Site access** and allow the two declared development hosts (`localhost` and `127.0.0.1`) if Chrome asks. Reload the portal tab afterward so the content script attaches.
5. Click the UAL toolbar icon. The panel opens. Use **Diagnostics → Run Connection Test** to check tab access, content-script messaging, and backend availability.
6. In the assistant, request Property Tax Assistance; use the embedded inputs to fill the portal, then manually click **Check Dues**. The portal uses synthetic data only.

The development extension intentionally has access only to `http://localhost/*` and `http://127.0.0.1/*` (all ports on those hosts). Chrome internal pages, the Web Store, and other websites are unsupported. The API needs to remain available on localhost for connected assistant, memory and verification features; page guidance remains available when the API is down.

## Demo flow

Ask “I want to check my property tax and understand how to pay it.” The API identifies Property Tax Assistance and returns a six-step plan. Enter `BBMP-2048` and choose a ward in the side panel; select **Fill Portal Fields** to populate the demo portal, then click **Check Dues** yourself. Review the synthetic amount and initiate the simulated payment from the portal. The receipt includes a unique `UAL-DEMO-*` reference. Continue in the panel to verify it and save/recover checkpoints. The content script sends only the extracted receipt reference and a boolean demo marker to the verifier, not raw page text.

## API

- `GET /api/health`
- `POST /api/assistant` — local intent and workflow prediction
- `GET/POST /api/tasks`, `PUT/DELETE /api/tasks/{id}` — checkpoint memory
- `POST /api/verify` — synthetic receipt verification

Interactive API docs are at `/docs`.

## Security and privacy

All portal records are synthetic. The content script excludes password, OTP, Aadhaar, PAN and payment credential fields from inspection. Citizen notes are scrubbed for common sensitive terms before persistence. DOM inspection is initiated from the extension UI and avoids sending page contents to the API. This is a hackathon prototype, not a security-audited product. It does not automatically submit government forms or perform real payments.

## Architecture and roadmap

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/ROADMAP.md](docs/ROADMAP.md), [docs/API_DOCUMENTATION.md](docs/API_DOCUMENTATION.md), [docs/SECURITY.md](docs/SECURITY.md), and [docs/DEMO_GUIDE.md](docs/DEMO_GUIDE.md). Agent interfaces and the orchestration boundary are kept modular so LangGraph can later coordinate intent, workflow, browser, DOM, UI, memory, recovery, verification and accessibility/language specialists. No MCP components are used. A trained DOM model, broad multi-portal support, regional languages, voice, OCR and secure automation remain planned.



