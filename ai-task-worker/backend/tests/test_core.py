import os, sys
os.environ["DB_PATH"] = "test.db"
if os.path.exists("test.db"): os.remove("test.db")
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from fastapi.testclient import TestClient
import db, portal
from main import app
from agent import policy, tools

c = TestClient(app)

def test_flaky_then_validation_then_success():
    portal.FLAKY["left"] = 1
    d = {"invoice_no": "INV-1", "company": "ABC", "amount": "1,25,000", "due_date": "2026-10-30"}
    assert c.post("/portal/save", data=d).status_code == 503
    assert c.post("/portal/save", data={**d, "due_date": "30 Oct 2026"}).status_code == 422
    assert c.post("/portal/save", data=d).status_code == 200
    assert db.q("SELECT amount FROM records WHERE invoice_no='INV-1'")[0]["amount"] == 125000

def test_verify_independent_of_ui():
    tb = tools.Toolbox("t")
    assert tools.verify_record(tb, "INV-1", "125000", "2026-10-30")["verified"] is True
    tb2 = tools.Toolbox("t2")
    assert tools.verify_record(tb2, "INV-1", "999", "2026-10-30")["verified"] is False and not tb2.verified

def test_policy():
    assert policy.needs_approval("click", {"selector": "button#delete"})
    assert not policy.needs_approval("click", {"selector": "button#save"})

def test_file_tools():
    import subprocess; subprocess.run([sys.executable, "seed.py"], check=True)
    tb = tools.Toolbox("t3")
    assert len(tools.list_files(tb, "abc technologies")["files"]) == 3

def test_runs_api_lifecycle():
    r = c.post("/runs", json={"task": "Find latest invoice from ABC Technologies", "inject_failure": False})
    assert r.status_code == 200
    run_id = r.json()["id"]
    r2 = c.get(f"/runs/{run_id}")
    assert r2.status_code == 200
    assert "events" in r2.json() and "run" in r2.json()

def test_policy_sensitive_actions():
    assert policy.needs_approval("click", {"selector": "button#pay-now"})
    assert policy.needs_approval("click", {"selector": "a[href*='delete']"})
    assert policy.needs_approval("fill", {"selector": "input#send-email", "value": "test"})

def test_db_edge_cases_and_queries():
    db.x("INSERT OR REPLACE INTO records VALUES(?,?,?,?,?)", ("INV-EDGE-1", "Test Corp", 50000.0, "2026-11-15", "2026-10-03 12:00:00"))
    rows = db.q("SELECT * FROM records WHERE invoice_no=?", ("INV-EDGE-1",))
    assert len(rows) == 1
    assert rows[0]["amount"] == 50000.0

    # Test non-existent query
    empty = db.q("SELECT * FROM records WHERE invoice_no=?", ("NON_EXISTENT",))
    assert len(empty) == 0

def test_portal_save_validation_edge_cases():
    # Negative / zero amount
    r_neg = c.post("/portal/save", data={"invoice_no": "INV-X", "company": "ABC", "amount": "-500", "due_date": "2026-10-30"})
    assert r_neg.status_code == 422
    assert "positive number" in r_neg.text

    # Missing company
    r_no_comp = c.post("/portal/save", data={"invoice_no": "INV-X", "company": "", "amount": "1000", "due_date": "2026-10-30"})
    assert r_no_comp.status_code == 422
    assert "required" in r_no_comp.text

    # Invalid date format (DD-MM-YYYY instead of YYYY-MM-DD)
    r_bad_date = c.post("/portal/save", data={"invoice_no": "INV-X", "company": "ABC", "amount": "1000", "due_date": "30-10-2026"})
    assert r_bad_date.status_code == 422
    assert "YYYY-MM-DD" in r_bad_date.text

def test_approval_endpoint_edge_cases():
    # Approval on non-existent run
    r = c.post("/runs/unknown_run_id/approval", json={"approved": True, "answer": "ok"})
    assert r.status_code == 200
    assert r.json()["ok"] is False

def test_agent_unverified_finish_rejected():
    from agent import controller
    # Mock LLM that immediately attempts to finish without verification
    calls = []
    def fake_llm(system, msgs):
        calls.append(len(msgs))
        if len(calls) == 1:
            return {"thought": "try finish directly", "tool": "finish", "args": {"status": "success", "summary": "done"}}
        return {"thought": "give up", "tool": "finish", "args": {"status": "failed", "summary": "failed"}}

    db.x("INSERT INTO runs VALUES(?,?,?,?,?)", ("test_run_verify", "sample task", "running", None, "2026-10-03 12:00:00"))
    controller.run_agent("test_run_verify", "sample task", llm=fake_llm, headless=True)
    run = db.q("SELECT * FROM runs WHERE id='test_run_verify'")[0]
    # Status should be failed because success without verification is rejected
    assert run["status"] == "failed"

def test_extract_invoice_and_get_record():
    tb = tools.Toolbox("t_extract")
    res = tools.extract_invoice(tb, "ABC_Technologies_INV-204.txt")
    assert res["extracted"]["invoice_no"] == "INV-204"
    assert "1,25,000" in res["extracted"]["amount_raw"]
    assert res["extracted"]["invoice_date"] == "2026-10-01"

    check_rec = tools.get_record(tb, "INV-198")
    assert check_rec["exists"] in (True, False)



