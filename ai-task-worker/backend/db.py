import sqlite3, os
from dotenv import load_dotenv
load_dotenv()
DB = os.getenv("DB_PATH", "worker.db")


def conn():
    c = sqlite3.connect(DB, check_same_thread=False)
    c.row_factory = sqlite3.Row
    return c

def init():
    c = conn()
    c.executescript("""
    CREATE TABLE IF NOT EXISTS records(invoice_no TEXT PRIMARY KEY, company TEXT, amount REAL, due_date TEXT, updated_at TEXT);
    CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY, task TEXT, status TEXT, result TEXT, created_at TEXT);
    CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT, ts TEXT, kind TEXT, message TEXT, data TEXT);
    """)
    c.commit(); c.close()

def q(sql, args=()):
    c = conn(); rows = [dict(r) for r in c.execute(sql, args).fetchall()]; c.close(); return rows

def x(sql, args=()):
    c = conn(); c.execute(sql, args); c.commit(); c.close()
