import os, re, json
import db

INV_DIR = os.getenv("INVOICE_DIR", "data/invoices")
BASE = os.getenv("BASE_URL", "http://127.0.0.1:8000")
SHOTS = "screenshots"

def _norm(s): return re.sub(r"[\s_\-]", "", str(s)).lower()

class Toolbox:
    def __init__(self, run_id, headless=True):
        self.run_id, self.headless = run_id, headless
        self.facts, self.verified, self.shots = {}, False, []
        self.pw = self.browser = self.page = None

    def _page(self):
        if not self.page:
            from playwright.sync_api import sync_playwright
            self.pw = sync_playwright().start()
            self.browser = self.pw.chromium.launch(headless=self.headless)
            self.page = self.browser.new_page()
        return self.page

    def close(self):
        try:
            if self.browser: self.browser.close()
            if self.pw: self.pw.stop()
        except Exception: pass

    def shot(self, label="evidence"):
        try:
            os.makedirs(SHOTS, exist_ok=True)
            name = f"{self.run_id}_{len(self.shots)}_{label}.png"
            self._page().screenshot(path=f"{SHOTS}/{name}")
            self.shots.append(f"/screenshots/{name}")
            return self.shots[-1]
        except Exception:
            return None

    def observe(self):
        p = self._page()
        els = p.eval_on_selector_all("input,button,select,textarea,a",
            "els=>els.map(e=>({tag:e.tagName.toLowerCase(),id:e.id,name:e.name,text:(e.innerText||e.value||'').trim().slice(0,40)}))")
        o = {"url": p.url, "text": p.inner_text("body")[:1200], "elements": els[:25]}
        err = p.query_selector("#error")
        if err: o["page_error"] = err.inner_text()
        return o

# ---- tools (each returns a JSON-able observation) ----
def list_files(tb, query=""):
    q = _norm(query)
    return {"files": [f for f in sorted(os.listdir(INV_DIR)) if q in _norm(f)]}

def read_file(tb, name):
    path = os.path.join(INV_DIR, os.path.basename(name))
    return {"name": name, "content": open(path, encoding="utf-8").read()[:3000]}

def extract_invoice(tb, name):
    """Deterministic extraction fallback to cross-check extracted values."""
    path = os.path.join(INV_DIR, os.path.basename(name))
    text = open(path, encoding="utf-8").read()
    inv_no = re.search(r"Invoice Number:\s*([A-Z0-9_\-]+)", text, re.I)
    vendor = re.search(r"Vendor:\s*([^\n\r]+)", text, re.I)
    inv_date = re.search(r"Invoice Date:\s*([0-9]{4}-[0-9]{2}-[0-9]{2})", text, re.I)
    # Prefer Total Amount Due over Subtotal
    tot_amt = re.search(r"Total Amount Due:\s*([^\n\r]+)", text, re.I) or re.search(r"Amount:\s*([^\n\r]+)", text, re.I)
    due_date = re.search(r"Due Date:\s*([^\n\r]+)", text, re.I)

    res = {
        "invoice_no": inv_no.group(1).strip() if inv_no else None,
        "vendor": vendor.group(1).strip() if vendor else None,
        "invoice_date": inv_date.group(1).strip() if inv_date else None,
        "amount_raw": tot_amt.group(1).strip() if tot_amt else None,
        "due_date_raw": due_date.group(1).strip() if due_date else None,
    }
    return {"extracted": res}

def get_record(tb, invoice_no):
    """Check if an invoice record already exists in the database to prevent silent overwrite."""
    rows = db.q("SELECT * FROM records WHERE invoice_no=?", (invoice_no,))
    return {"exists": len(rows) > 0, "record": rows[0] if rows else None}

def goto(tb, url):
    target = url if url.startswith("http") else BASE + url
    p = tb._page()
    p.goto(target, timeout=5000)
    return tb.observe()

def fill(tb, selector, value):
    tb._page().fill(selector, str(value), timeout=3000); return {"ok": True, "filled": selector}

def click(tb, selector):
    p = tb._page(); p.click(selector, timeout=3000); p.wait_for_load_state(); return tb.observe()

def remember(tb, key, value):
    tb.facts[key] = value; return {"ok": True, "facts": tb.facts}

def verify_record(tb, invoice_no, amount, due_date):
    """Independent check against the database (not the form the agent just used)."""
    rows = db.q("SELECT * FROM records WHERE invoice_no=?", (invoice_no,))
    if not rows: return {"verified": False, "reason": "record not found"}
    r = rows[0]
    ok = abs(float(r["amount"]) - float(str(amount).replace(",", ""))) < 0.01 and r["due_date"] == due_date
    tb.verified = ok
    try:
        tb._page().goto(BASE + "/portal/records"); tb.shot("verify")
    except Exception: pass
    return {"verified": ok, "stored": r, "expected": {"amount": amount, "due_date": due_date}}

def verify_text(tb, url, expected):
    p = tb._page(); p.goto(url if url.startswith("http") else BASE + url)
    text = p.inner_text("body"); missing = [e for e in expected if str(e) not in text]
    tb.verified = not missing; tb.shot("verify")
    return {"verified": tb.verified, "missing": missing}

TOOLS = {f.__name__: f for f in [
    list_files, read_file, extract_invoice, get_record, goto, fill, click, remember, verify_record, verify_text
]}
