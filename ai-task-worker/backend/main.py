import os, uuid, json, threading, time, re
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import db, portal
from agent import controller

os.makedirs("screenshots", exist_ok=True)
db.init()
app = FastAPI(title="AI Task Worker")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
app.include_router(portal.router)
app.mount("/screenshots", StaticFiles(directory="screenshots"), name="shots")

class RunReq(BaseModel):
    task: str
    inject_failure: bool = True
    headless: bool = True

class Approval(BaseModel):
    approved: bool
    answer: str = ""

@app.post("/runs")
def start(req: RunReq):
    rid = uuid.uuid4().hex[:8]
    portal.FLAKY["left"] = 1 if req.inject_failure else 0
    db.x("INSERT INTO runs VALUES(?,?,?,?,?)", (rid, req.task, "running", None, time.strftime("%F %T")))
    threading.Thread(target=controller.run_agent, args=(rid, req.task), kwargs={"headless": req.headless}, daemon=True).start()
    return {"id": rid}

@app.get("/runs/{rid}")
def get(rid: str):
    run = (db.q("SELECT * FROM runs WHERE id=?", (rid,)) or [{}])[0]
    if run.get("result"): run["result"] = json.loads(run["result"])
    ev = db.q("SELECT * FROM events WHERE run_id=? ORDER BY id", (rid,))
    for e in ev: e["data"] = json.loads(e["data"]) if e["data"] else None
    return {"run": run, "events": ev}

@app.post("/runs/{rid}/approval")
def approve(rid: str, a: Approval):
    p = controller.PENDING.get(rid)
    if not p: return {"ok": False}
    p.update(approved=a.approved, answer=a.answer); p["event"].set(); return {"ok": True}

@app.post("/reset")
def reset():
    db.x("DELETE FROM records"); return {"ok": True}

@app.get("/api/records")
def get_records():
    return {"records": db.q("SELECT * FROM records ORDER BY updated_at DESC")}

@app.get("/api/runs")
def get_all_runs():
    runs = db.q("SELECT * FROM runs ORDER BY created_at DESC")
    for r in runs:
        if r.get("result"):
            try:
                r["result"] = json.loads(r["result"])
            except Exception:
                pass
    return {"runs": runs}

@app.post("/api/seed-records")
def seed_all_records():
    inv_dir = "data/invoices"
    count = 0
    if os.path.exists(inv_dir):
        for fname in sorted(os.listdir(inv_dir)):
            if fname.endswith(".txt"):
                content = open(os.path.join(inv_dir, fname), encoding="utf-8").read()
                inv_no = re.search(r"Invoice Number:\s*([A-Z0-9_\-]+)", content, re.I)
                vendor = re.search(r"Vendor:\s*([^\n\r]+)", content, re.I)
                tot_amt = re.search(r"Total Amount Due:\s*([^\n\r]+)", content, re.I) or re.search(r"Amount:\s*([^\n\r]+)", content, re.I)
                due_date = re.search(r"Due Date:\s*([^\n\r]+)", content, re.I)
                
                if inv_no:
                    ino = inv_no.group(1).strip()
                    comp = vendor.group(1).strip() if vendor else "Unknown"
                    amt = 0.0
                    if tot_amt:
                        nums = re.findall(r"[0-9,]+(?:\.[0-9]+)?", tot_amt.group(1))
                        if nums: amt = float(nums[0].replace(",", ""))
                    dd = "2026-10-31"
                    if due_date:
                        dd = due_date.group(1).strip()
                    db.x("INSERT OR REPLACE INTO records(invoice_no, company, amount, due_date, updated_at) VALUES(?,?,?,?,?)",
                         (ino, comp, amt, dd, time.strftime("%F %T")))
                    count += 1
    return {"ok": True, "seeded": count, "records": db.q("SELECT * FROM records ORDER BY updated_at DESC")}

@app.get("/api/stats")
def get_stats():
    records_count = (db.q("SELECT COUNT(*) as c FROM records") or [{"c": 0}])[0]["c"]
    runs_count = (db.q("SELECT COUNT(*) as c FROM runs") or [{"c": 0}])[0]["c"]
    events_count = (db.q("SELECT COUNT(*) as c FROM events") or [{"c": 0}])[0]["c"]
    return {
        "records_count": records_count,
        "runs_count": runs_count,
        "events_count": events_count
    }



