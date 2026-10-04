"""Quick sandbox check (server must be running): python run_cli.py "task" """
import sys, uuid, time, db
from agent import controller
db.init(); rid = uuid.uuid4().hex[:8]; task = sys.argv[1]
import portal; portal.FLAKY["left"] = 1
db.x("INSERT INTO runs VALUES(?,?,?,?,?)", (rid, task, "running", None, time.strftime("%F %T")))
controller.run_agent(rid, task, headless=False)
for e in db.q("SELECT ts,kind,message FROM events WHERE run_id=?", (rid,)): print(e["ts"], e["kind"].upper(), e["message"][:150])
