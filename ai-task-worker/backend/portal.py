"""Simulated internal company app. Fault injection: first N saves fail with a 503,
and dates must be YYYY-MM-DD, so the agent must observe errors and recover."""
import re, time, os
from fastapi import APIRouter, Form
from fastapi.responses import HTMLResponse
import db

router = APIRouter()
FLAKY = {"left": 0}

def page(body, code=200):
    html = f"""<!doctype html>
<html>
<head>
    <meta charset="utf-8">
    <title>Internal Invoice System</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
    <style>
        :root {{
            --bg: #0f172a;
            --card: #1e293b;
            --border: rgba(255,255,255,0.1);
            --primary: #6366f1;
            --text: #f8fafc;
            --muted: #94a3b8;
        }}
        * {{ box-sizing: border-box; margin: 0; padding: 0; }}
        body {{
            font-family: 'Inter', sans-serif;
            background: var(--bg);
            color: var(--text);
            min-height: 100vh;
            padding: 32px 16px;
        }}
        .container {{
            max-width: 820px;
            margin: 0 auto;
            background: var(--card);
            border: 1px solid var(--border);
            border-radius: 16px;
            padding: 28px;
            box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.3);
        }}
        header {{
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 24px;
            padding-bottom: 18px;
            border-bottom: 1px solid var(--border);
        }}
        h1 {{
            font-size: 20px;
            font-weight: 700;
            display: flex;
            align-items: center;
            gap: 10px;
            color: #fff;
        }}
        nav a {{
            color: #94a3b8;
            text-decoration: none;
            font-size: 13px;
            font-weight: 500;
            padding: 6px 12px;
            border-radius: 8px;
            background: rgba(255,255,255,0.05);
            margin-left: 8px;
            transition: all 0.2s;
        }}
        nav a:hover {{
            background: rgba(99, 102, 241, 0.2);
            color: #818cf8;
        }}
        .form-group {{
            margin-bottom: 16px;
        }}
        label {{
            display: block;
            font-size: 13px;
            font-weight: 500;
            color: var(--muted);
            margin-bottom: 6px;
        }}
        input {{
            width: 100%;
            padding: 10px 14px;
            background: #0b0f19;
            border: 1px solid var(--border);
            border-radius: 8px;
            color: #fff;
            font-size: 14px;
            font-family: inherit;
        }}
        input:focus {{
            outline: none;
            border-color: var(--primary);
        }}
        button#save {{
            background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%);
            color: white;
            border: none;
            padding: 11px 22px;
            border-radius: 8px;
            font-weight: 600;
            font-size: 14px;
            cursor: pointer;
            box-shadow: 0 4px 12px rgba(99, 102, 241, 0.4);
            margin-top: 8px;
        }}
        #error {{
            background: rgba(244, 63, 94, 0.15);
            border: 1px solid rgba(244, 63, 94, 0.35);
            color: #fb7185;
            padding: 12px 16px;
            border-radius: 8px;
            font-size: 13px;
            margin-bottom: 20px;
            font-weight: 500;
        }}
        #success {{
            background: rgba(16, 185, 129, 0.15);
            border: 1px solid rgba(16, 185, 129, 0.35);
            color: #34d399;
            padding: 12px 16px;
            border-radius: 8px;
            font-size: 13px;
            margin-bottom: 20px;
            font-weight: 500;
        }}
        table {{
            width: 100%;
            border-collapse: collapse;
            font-size: 13px;
        }}
        th {{
            text-align: left;
            padding: 12px 14px;
            background: #0b0f19;
            color: var(--muted);
            font-weight: 600;
            border-bottom: 1px solid var(--border);
        }}
        td {{
            padding: 12px 14px;
            border-bottom: 1px solid var(--border);
            color: #e2e8f0;
        }}
        .empty-state {{
            text-align: center;
            padding: 40px 20px;
            color: var(--muted);
            font-size: 14px;
        }}
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>🏢 Internal Invoice System</h1>
            <nav>
                <a href='/portal/records'>View Records</a>
                <a href='/portal/new'>+ New Invoice</a>
            </nav>
        </header>
        {body}
    </div>
</body>
</html>"""
    return HTMLResponse(html, status_code=code)

@router.get("/portal/new")
def new():
    return page("""<form method='post' action='/portal/save'>
<div class='form-group'><label>Invoice No <input name='invoice_no' placeholder='e.g. INV-204'></label></div>
<div class='form-group'><label>Company <input name='company' placeholder='e.g. ABC Technologies'></label></div>
<div class='form-group'><label>Amount (number) <input name='amount' placeholder='e.g. 125000'></label></div>
<div class='form-group'><label>Due date (YYYY-MM-DD) <input name='due_date' placeholder='YYYY-MM-DD'></label></div>
<button id='save' type='submit'>Save Invoice</button></form>""")

@router.post("/portal/save")
def save(invoice_no: str = Form(""), company: str = Form(""), amount: str = Form(""), due_date: str = Form("")):
    if FLAKY["left"] > 0:
        FLAKY["left"] -= 1
        return page("<div id='error'>Temporary server error (503). Please retry.</div>", 503)
    try:
        amt = float(amount.replace(",", ""))
        assert amt > 0
    except Exception:
        return page("<div id='error'>Validation: amount must be a positive number.</div>", 422)
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", due_date):
        return page("<div id='error'>Validation: due date must be YYYY-MM-DD.</div>", 422)
    if not invoice_no or not company:
        return page("<div id='error'>Validation: invoice no and company are required.</div>", 422)
    db.x("INSERT OR REPLACE INTO records VALUES(?,?,?,?,?)", (invoice_no, company, amt, due_date, time.strftime("%F %T")))
    return page(f"<div id='success'>Saved {invoice_no}.</div>")

@router.get("/portal/records")
def records():
    rows_data = db.q("SELECT * FROM records ORDER BY updated_at DESC")
    if not rows_data:
        body = "<div class='empty-state'><p>No invoice records found in database.</p><p style='margin-top:8px;font-size:12px;'>Run a task or add an invoice using the 'New Invoice' tab.</p></div>"
    else:
        rows = "".join(f"""<tr>
            <td><b style='color:#818cf8;'>{r['invoice_no']}</b></td>
            <td style='font-weight:500;'>{r['company']}</td>
            <td style='font-family:monospace;font-weight:600;color:#34d399;'>₹{r['amount']:,.2f}</td>
            <td style='color:#94a3b8;'>{r['due_date']}</td>
            <td><span style='background:rgba(16,185,129,0.15);color:#34d399;padding:3px 8px;border-radius:4px;font-size:11px;font-weight:600;'>Active</span></td>
        </tr>""" for r in rows_data)
        body = f"""<div style='display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;'>
            <span style='font-size:13px;color:var(--muted);'>Showing <b>{len(rows_data)}</b> synchronized records from repository</span>
            <span style='background:rgba(99,102,241,0.2);color:#818cf8;padding:4px 10px;border-radius:6px;font-size:12px;font-weight:600;'>Live Database</span>
        </div>
        <table>
            <tr><th>Invoice #</th><th>Company / Vendor</th><th>Amount Due</th><th>Due Date</th><th>Status</th></tr>
            {rows}
        </table>"""
    return page(body)


