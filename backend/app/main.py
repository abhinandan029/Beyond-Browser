from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from pathlib import Path
import sqlite3, uuid, json, re
from contextlib import contextmanager

DB = Path(__file__).resolve().parent.parent / "ual.sqlite3"
app = FastAPI(title="Universal Access Layer API", version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
WORKFLOWS = {
 "property_tax": ["Find your property", "Enter Property ID", "Review outstanding dues", "Review payment details", "Complete simulated payment", "Verify receipt"],
 "pension_status": ["Choose pension service", "Enter application reference", "Review status"],
 "certificate_services": ["Choose certificate", "Review required documents", "Track application"],
 "general_government": ["Identify the service", "Review requirements", "Continue on the official portal"]
}
class Ask(BaseModel): message: str = Field(min_length=3, max_length=1000)
class TaskIn(BaseModel): title: str; service_category: str; current_step: int = 0; total_steps: int = 4; status: str = "in_progress"; page_url: str = ""; page_fingerprint: str = ""; notes: str = ""
class Progress(BaseModel): current_step: int; status: str = "in_progress"; page_url: str = ""; page_fingerprint: str = ""; notes: str = ""
@contextmanager
def db():
 c=sqlite3.connect(DB); c.row_factory=sqlite3.Row
 try:
  yield c
  c.commit()
 except Exception:
  c.rollback()
  raise
 finally: c.close()
with db() as c: c.execute("CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY,title TEXT,service_category TEXT,current_step INTEGER,total_steps INTEGER,status TEXT,page_url TEXT,page_fingerprint TEXT,notes TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP)")
def classify(s):
 t=s.lower()
 if any(x in t for x in ["property tax","property id","tax dues","house tax"]): return "property_tax", .97, "Your request mentions property tax or property dues."
 if any(x in t for x in ["pension","retirement benefit"]): return "pension_status", .94, "Your request is about a pension service."
 if any(x in t for x in ["certificate","birth certificate","income certificate","caste certificate"]): return "certificate_services", .91, "Your request is about obtaining or tracking a certificate."
 return "general_government", .68, "I’ll help identify the government service and its next steps."
@app.get("/api/health")
def health(): return {"status":"ok","service":"ual-api"}
@app.post("/api/assistant")
def assistant(q: Ask):
 category, confidence, explanation=classify(q.message)
 names={"property_tax":"Property Tax Assistance","pension_status":"Pension Status","certificate_services":"Certificate Services","general_government":"Government Services"}
 intro=("I understand that you want to check your property tax. I’ll help you find your property details, review outstanding dues and guide you through the demonstration process." if category=="property_tax" else f"{explanation} I’ll guide you through the {names[category].lower()} workflow.")
 return {"intent":category,"service_category":names[category],"confidence":confidence,"explanation":explanation,"response":intro,"workflow":WORKFLOWS[category],"adapter":"local_rules"}
SENSITIVE=re.compile(r"password|otp|one.?time|aadhaar|aadhar|pan(?!el)|card number|cvv|pin code|payment credential",re.I)
def clean_notes(s):
 s=re.sub(r"(?i)\b(password|passcode|otp|one.?time.?code|aadhaar|aadhar|pan(?: number)?|cvv|card number|payment credential)\b\s*[:=]?\s*[^,;\s]*", "[redacted]", s)
 s=re.sub(r"\b\d{12}\b|\b[A-Z]{5}\d{4}[A-Z]\b", "[redacted]", s, flags=re.I)
 return s[:500]
@app.get("/api/tasks")
def tasks():
 with db() as c: return [dict(r) for r in c.execute("SELECT * FROM tasks ORDER BY updated_at DESC")]
@app.get("/api/tasks/{task_id}")
def get_task(task_id:str):
 with db() as c: row=c.execute("SELECT * FROM tasks WHERE id=?",(task_id,)).fetchone()
 if not row: raise HTTPException(404,"Task not found")
 return dict(row)
@app.post("/api/tasks")
def save_task(t:TaskIn):
 task_id=str(uuid.uuid4())
 with db() as c: c.execute("INSERT INTO tasks(id,title,service_category,current_step,total_steps,status,page_url,page_fingerprint,notes) VALUES(?,?,?,?,?,?,?,?,?)",(task_id,t.title,t.service_category,t.current_step,t.total_steps,t.status,t.page_url,t.page_fingerprint,clean_notes(t.notes)))
 return {"id":task_id,"saved":True}
@app.put("/api/tasks/{task_id}")
def update_task(task_id:str,p:Progress):
 with db() as c:
  cur=c.execute("UPDATE tasks SET current_step=?,status=?,page_url=?,page_fingerprint=?,notes=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",(p.current_step,p.status,p.page_url,p.page_fingerprint,clean_notes(p.notes),task_id))
  if not cur.rowcount: raise HTTPException(404,"Task not found")
 return {"id":task_id,"saved":True}
@app.delete("/api/tasks/{task_id}")
def delete_task(task_id:str):
 with db() as c: c.execute("DELETE FROM tasks WHERE id=?",(task_id,))
 return {"deleted":True}
@app.post("/api/verify")
def verify(payload:dict):
 reference=re.fullmatch(r"UAL-DEMO-[A-Z0-9-]+",str(payload.get("receipt_reference") or ""))
 marker=payload.get("demo_marker") is True
 verified=bool(reference and marker)
 status="completed" if verified else ("verification_failed" if marker and payload.get("receipt_reference") else "awaiting_confirmation")
 message="A demo receipt and reference were found." if verified else ("The visible demo marker did not include a valid receipt reference." if status=="verification_failed" else "No verifiable demo receipt is visible yet.")
 return {"verified":verified,"status":status,"reference":reference.group(0) if reference else None,"message":message}
