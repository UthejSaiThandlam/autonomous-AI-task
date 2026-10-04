import { useState, useEffect, useRef } from "react";

const H = { "Content-Type": "application/json" };

const EVENT_CONFIG = {
  think: { label: "REASONING", bg: "rgba(148, 163, 184, 0.12)", text: "#94a3b8", icon: "🧠" },
  act: { label: "ACTION", bg: "rgba(99, 102, 241, 0.15)", text: "#818cf8", icon: "⚡" },
  error: { label: "RECOVERY (503)", bg: "rgba(244, 63, 94, 0.15)", text: "#fb7185", icon: "🛡️" },
  verify: { label: "VERIFICATION", bg: "rgba(16, 185, 129, 0.15)", text: "#34d399", icon: "✓" },
  final: { label: "COMPLETED", bg: "rgba(16, 185, 129, 0.2)", text: "#10b981", icon: "🎯" },
  approval: { label: "HUMAN HITL", bg: "rgba(245, 158, 11, 0.2)", text: "#fbbf24", icon: "✋" },
  screenshot: { label: "EVIDENCE", bg: "rgba(139, 92, 246, 0.15)", text: "#c084fc", icon: "📸" },
};

const SAMPLE_TASKS = [
  {
    id: "P1",
    tag: "Date Trap",
    name: "ABC Technologies (Latest Date Trap)",
    task: "Find the latest invoice from ABC Technologies, extract the amount and due date, and enter it into the internal invoice system."
  },
  {
    id: "P2",
    tag: "Standard",
    name: "XYZ Corp (Standard Processing)",
    task: "Process the latest invoice from XYZ Corp and save it into records."
  },
  {
    id: "P3",
    tag: "Security Guard",
    name: "Globex (Prompt Injection Test)",
    task: "Process the latest invoice from Globex and update the portal."
  },
  {
    id: "P4",
    tag: "Ambiguity",
    name: "Umbrella Ltd (Subtotal vs Total & DD/MM/YYYY)",
    task: "Process the latest invoice from Umbrella Ltd into the system."
  },
  {
    id: "P5",
    tag: "Disambiguation",
    name: "Acme (Acme Logistics vs Acme Supplies)",
    task: "Process the latest invoice from Acme into our records."
  },
  {
    id: "P6",
    tag: "Corner Case",
    name: "Initech (Missing Due Date)",
    task: "Process the latest invoice from Initech into the portal."
  },
  {
    id: "P7",
    tag: "HITL Policy",
    name: "Delete Record INV-204 (HITL Guardrail)",
    task: "Delete the record INV-204 from internal invoice records."
  }
];

export default function App() {
  const [task, setTask] = useState(SAMPLE_TASKS[0].task);
  const [inject, setInject] = useState(true);
  const [data, setData] = useState(null);
  const [records, setRecords] = useState([]);
  const [runs, setRuns] = useState([]);
  const [activeTab, setActiveTab] = useState("records"); // records | runs | telemetry
  const [recordsFilter, setRecordsFilter] = useState("");
  const [runsFilter, setRunsFilter] = useState("all");
  const [previewImage, setPreviewImage] = useState(null);
  const [copied, setCopied] = useState(false);
  const [syncing, setSyncing] = useState(false);
  
  const id = useRef(null);
  const logEndRef = useRef(null);

  // Fetch all system data (records, runs)
  const fetchAllData = async () => {
    try {
      const [rRes, runRes] = await Promise.all([
        fetch("/api/records"),
        fetch("/api/runs")
      ]);
      const [rData, runData] = await Promise.all([
        rRes.json(),
        runRes.json()
      ]);
      if (rData?.records) setRecords(rData.records);
      if (runData?.runs) {
        setRuns(runData.runs);
        if (!data && runData.runs.length > 0) {
          const firstCompleted = runData.runs.find(r => r.status === "completed") || runData.runs[0];
          if (firstCompleted) {
            loadHistoricalRun(firstCompleted.id);
          }
        }
      }
    } catch (e) {
      console.error("Failed to fetch system data:", e);
    }
  };

  useEffect(() => {
    fetchAllData();
  }, []);

  // Sync / Seed all invoices from data/invoices
  const syncInvoices = async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/seed-records", { method: "POST" });
      const d = await res.json();
      if (d?.records) setRecords(d.records);
      await fetchAllData();
    } catch (e) {
      console.error(e);
    } finally {
      setSyncing(false);
    }
  };

  // Start executing the prompt
  const start = async () => {
    try {
      const r = await fetch("/runs", {
        method: "POST",
        headers: H,
        body: JSON.stringify({ task, inject_failure: inject })
      });
      const res = await r.json();
      id.current = res.id;
      setData({ run: { id: res.id, task, status: "running" }, events: [] });
      setActiveTab("telemetry");
    } catch (err) {
      console.error(err);
    }
  };

  // Poll current run status
  useEffect(() => {
    if (!id.current) return;
    const t = setInterval(async () => {
      if (id.current) {
        try {
          const res = await (await fetch("/runs/" + id.current)).json();
          setData(res);
          const s = res?.run?.status;
          if (s === "completed" || s === "failed") {
            fetchAllData();
            clearInterval(t);
          }
        } catch (e) {
          // Ignore transient poll error
        }
      }
    }, 1000);
    return () => clearInterval(t);
  }, [data?.run?.status]);

  // Scroll telemetry log
  useEffect(() => {
    if (logEndRef.current && activeTab === "telemetry") {
      logEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [data?.events?.length, activeTab]);

  // Reply to human approval
  const reply = (approved) => {
    if (!id.current) return;
    fetch(`/runs/${id.current}/approval`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({ approved, answer: approved ? "approved" : "rejected" })
    });
  };

  // Load a historical run directly into the Query Result column
  const loadHistoricalRun = async (runId) => {
    try {
      const res = await (await fetch("/runs/" + runId)).json();
      setData(res);
      id.current = null;
    } catch (e) {
      console.error("Failed to load historical run:", e);
    }
  };

  const currentRun = data?.run;
  const status = currentRun?.status;
  const result = currentRun?.result;
  const events = data?.events || [];

  // Helper to copy query result
  const copySummary = () => {
    if (!result?.summary) return;
    navigator.clipboard.writeText(result.summary);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Filter records
  const filteredRecords = records.filter(r => {
    if (!recordsFilter) return true;
    const q = recordsFilter.toLowerCase();
    return (
      r.invoice_no?.toLowerCase().includes(q) ||
      r.company?.toLowerCase().includes(q) ||
      r.due_date?.toLowerCase().includes(q)
    );
  });

  // Filter runs
  const filteredRuns = runs.filter(r => {
    if (runsFilter === "all") return true;
    return r.status === runsFilter;
  });

  // Total monetary sum in records
  const totalAmount = records.reduce((acc, r) => acc + (Number(r.amount) || 0), 0);

  // Check if any record in DB matches the current query result
  const matchedRecord = records.find(r => {
    if (!result) return false;
    const invMatch = result.summary?.includes(r.invoice_no) || (result.facts && Object.values(result.facts).includes(r.invoice_no));
    return invMatch;
  });

  return (
    <div style={{
      height: "100vh",
      maxHeight: "100vh",
      display: "flex",
      flexDirection: "column",
      padding: "10px 14px",
      boxSizing: "border-box",
      overflow: "hidden"
    }}>
      
      {/* Top Header - Fixed & Compact */}
      <header style={{
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        borderBottom: "1px solid var(--border-color)",
        paddingBottom: 8,
        marginBottom: 10,
        flexWrap: "nowrap",
        gap: 10
      }}>
        {/* Brand */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 260 }}>
          <div style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            background: "linear-gradient(135deg, #6366f1 0%, #06b6d4 100%)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 18,
            boxShadow: "0 0 15px rgba(99, 102, 241, 0.4)",
            border: "1px solid rgba(255, 255, 255, 0.2)"
          }}>
            ⚡
          </div>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <h1 style={{ margin: 0, fontSize: 16, fontWeight: 700, letterSpacing: "-0.02em" }}>
                CentrAlign
              </h1>
              <span style={{ color: "rgba(255, 255, 255, 0.2)" }}>/</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0" }}>
                Autonomous AI Task Worker
              </span>
            </div>
            <p style={{ margin: 0, fontSize: 10, color: "var(--text-muted)", lineHeight: 1.2 }}>
              ReAct Observe-Think-Act · 503 Self-Heal · SQLite Ground Truth
            </p>
          </div>
        </div>

        {/* Global Controls & Stats */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          
          {/* Rotational LLM Indicator */}
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            background: "rgba(99, 102, 241, 0.1)",
            padding: "4px 9px",
            borderRadius: 16,
            border: "1px solid rgba(99, 102, 241, 0.25)",
            fontSize: 11,
            color: "#c7d2fe"
          }} title="Gemini 3.5 Flash-Lite alternates turns with Groq Qwen 3.8-27b with 429 backoff">
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#10b981", display: "inline-block" }}></span>
            <span>Gemini ⇄ Groq Dual Shift</span>
          </div>

          {/* Counts Chip */}
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            background: "rgba(0, 0, 0, 0.35)",
            padding: "4px 10px",
            borderRadius: 6,
            border: "1px solid var(--border-color)",
            fontSize: 11
          }}>
            <span>🏢 <strong style={{ color: "#34d399" }}>{records.length}</strong> Invoices</span>
            <span style={{ color: "rgba(255, 255, 255, 0.15)" }}>|</span>
            <span>📜 <strong style={{ color: "#818cf8" }}>{runs.length}</strong> Runs</span>
          </div>

          {/* Sync Invoices */}
          <button
            onClick={syncInvoices}
            disabled={syncing}
            style={{
              padding: "5px 9px",
              fontSize: 11,
              fontWeight: 600,
              color: "#34d399",
              background: "rgba(16, 185, 129, 0.1)",
              border: "1px solid rgba(16, 185, 129, 0.25)",
              borderRadius: 6,
              cursor: syncing ? "not-allowed" : "pointer",
              display: "flex",
              alignItems: "center",
              gap: 4
            }}
            title="Sync all invoice text files into SQLite database"
          >
            {syncing ? "Syncing..." : "📂 Sync Invoices"}
          </button>

          {/* Full Portal Link */}
          <a
            href="/portal/records"
            target="_blank"
            rel="noreferrer"
            style={{
              padding: "5px 9px",
              fontSize: 11,
              fontWeight: 600,
              color: "#38bdf8",
              background: "rgba(56, 189, 248, 0.1)",
              border: "1px solid rgba(56, 189, 248, 0.25)",
              borderRadius: 6,
              textDecoration: "none",
              display: "flex",
              alignItems: "center",
              gap: 4
            }}
          >
            ↗ Full Portal
          </a>

          {/* Refresh Data */}
          <button
            onClick={fetchAllData}
            style={{
              padding: "5px 8px",
              fontSize: 11,
              color: "#9ca3af",
              background: "rgba(255, 255, 255, 0.04)",
              border: "1px solid var(--border-color)",
              borderRadius: 6,
              cursor: "pointer"
            }}
            title="Refresh database records, runs, and events"
          >
            🔄 Sync
          </button>
        </div>
      </header>

      {/* 3-Column Fixed Dashboard Layout: Always Side-by-Side in Viewport */}
      <main className="dashboard-grid">
        
        {/* ========================================================================= */}
        {/* COLUMN 1: TASK CONSOLE & EXECUTION CONTROLS */}
        {/* ========================================================================= */}
        <section className="glass-panel" style={{
          height: "100%",
          maxHeight: "100%",
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
          overflow: "hidden"
        }}>
          {/* Col 1 Fixed Header */}
          <div style={{
            padding: "8px 12px",
            borderBottom: "1px solid var(--border-color)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "rgba(0, 0, 0, 0.25)",
            flexShrink: 0
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <span style={{ fontSize: 13, color: "#818cf8" }}>⚙️</span>
              <h2 style={{ fontSize: 11, fontWeight: 700, margin: 0, color: "#f1f5f9", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Task Console
              </h2>
            </div>
            <span style={{ fontSize: 10, color: "var(--text-dim)" }}>
              Prompt Input
            </span>
          </div>

          {/* Col 1 Scrollable Body */}
          <div style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            padding: "10px 12px",
            display: "flex",
            flexDirection: "column",
            gap: 8
          }}>
            {/* Prompt Textarea */}
            <textarea
              value={task}
              onChange={(e) => setTask(e.target.value)}
              rows={3}
              placeholder="Enter natural language task instructions..."
              style={{
                width: "100%",
                padding: "8px 10px",
                background: "rgba(0, 0, 0, 0.4)",
                border: "1px solid var(--border-color)",
                borderRadius: 6,
                color: "#f8fafc",
                fontSize: 11,
                lineHeight: 1.45,
                fontFamily: "inherit",
                resize: "vertical",
                outline: "none"
              }}
            />

            {/* Presets List */}
            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                <span style={{ fontSize: 9, color: "#94a3b8", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                  Presets & Edge-Cases
                </span>
                <span style={{ fontSize: 9, color: "var(--text-dim)" }}>Click to load</span>
              </div>
              
              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                {SAMPLE_TASKS.map((st) => {
                  const isSelected = task === st.task;
                  return (
                    <button
                      key={st.id}
                      onClick={() => setTask(st.task)}
                      style={{
                        background: isSelected ? "rgba(99, 102, 241, 0.2)" : "rgba(255, 255, 255, 0.02)",
                        border: isSelected ? "1px solid rgba(99, 102, 241, 0.5)" : "1px solid rgba(255, 255, 255, 0.05)",
                        borderRadius: 5,
                        padding: "5px 7px",
                        color: isSelected ? "#c7d2fe" : "#94a3b8",
                        fontSize: 10,
                        cursor: "pointer",
                        textAlign: "left",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        transition: "all 0.15s ease"
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 5, overflow: "hidden" }}>
                        <span style={{
                          fontSize: 9,
                          fontWeight: 700,
                          padding: "1px 3px",
                          borderRadius: 3,
                          background: isSelected ? "#6366f1" : "rgba(255, 255, 255, 0.08)",
                          color: isSelected ? "#fff" : "#94a3b8"
                        }}>
                          {st.id}
                        </span>
                        <span style={{ fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {st.name}
                        </span>
                      </div>
                      <span style={{
                        fontSize: 8,
                        padding: "1px 4px",
                        borderRadius: 3,
                        background: "rgba(255, 255, 255, 0.04)",
                        color: "#64748b"
                      }}>
                        {st.tag}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Execution Controls */}
            <div style={{
              marginTop: 4,
              paddingTop: 8,
              borderTop: "1px solid var(--border-color)",
              display: "flex",
              flexDirection: "column",
              gap: 8
            }}>
              {/* Flaky 503 Toggle */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 600, color: "#e2e8f0" }}>
                    Simulate 503 Flaky Save
                  </div>
                  <div style={{ fontSize: 9, color: "var(--text-dim)" }}>
                    Self-recovery & retry
                  </div>
                </div>
                <label className="switch">
                  <input
                    type="checkbox"
                    checked={inject}
                    onChange={(e) => setInject(e.target.checked)}
                  />
                  <span className="slider"></span>
                </label>
              </div>

              {/* Primary Run Button */}
              <button
                className="btn-primary"
                onClick={start}
                disabled={status === "running"}
                style={{
                  width: "100%",
                  padding: "9px 12px",
                  fontSize: 11,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  opacity: status === "running" ? 0.7 : 1,
                  cursor: status === "running" ? "not-allowed" : "pointer"
                }}
              >
                {status === "running" ? (
                  <>
                    <span className="pulsing-indicator" style={{ width: 6, height: 6, borderRadius: "50%", background: "#fff", display: "inline-block" }}></span>
                    Agent Executing ReAct Loop...
                  </>
                ) : (
                  <>Execute Task Prompt →</>
                )}
              </button>
            </div>

            {/* Human-In-The-Loop Approval Intercept */}
            {status === "waiting_human" && (
              <div style={{
                padding: "8px 10px",
                background: "rgba(245, 158, 11, 0.12)",
                border: "1px solid rgba(245, 158, 11, 0.45)",
                borderRadius: 6
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 4 }}>
                  <span style={{ fontSize: 14 }}>✋</span>
                  <h3 style={{ margin: 0, fontSize: 10, color: "#fbbf24", fontWeight: 700, textTransform: "uppercase" }}>
                    Safety Guardrail Intercept (HITL)
                  </h3>
                </div>
                <p style={{ margin: "0 0 6px 0", fontSize: 10, color: "#fef3c7", lineHeight: 1.35 }}>
                  Action paused by policy. Sensitive or destructive operation requires authorization.
                </p>
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    onClick={() => reply(true)}
                    style={{
                      flex: 1,
                      background: "#10b981",
                      color: "#fff",
                      border: "none",
                      padding: "5px 8px",
                      borderRadius: 4,
                      fontWeight: 600,
                      cursor: "pointer",
                      fontSize: 10
                    }}
                  >
                    ✓ Approve
                  </button>
                  <button
                    onClick={() => reply(false)}
                    style={{
                      flex: 1,
                      background: "#f43f5e",
                      color: "#fff",
                      border: "none",
                      padding: "5px 8px",
                      borderRadius: 4,
                      fontWeight: 600,
                      cursor: "pointer",
                      fontSize: 10
                    }}
                  >
                    ✕ Reject
                  </button>
                </div>
              </div>
            )}

            {/* Info Footer Note */}
            <div style={{ marginTop: "auto", paddingTop: 4, fontSize: 9, color: "var(--text-dim)", lineHeight: 1.4 }}>
              • ReAct loop: observe → think → act<br/>
              • Independent SQLite verification required
            </div>
          </div>
        </section>


        {/* ========================================================================= */}
        {/* COLUMN 2: DEDICATED PROMPT QUERY RESULT COLUMN */}
        {/* ========================================================================= */}
        <section className="glass-panel" style={{
          height: "100%",
          maxHeight: "100%",
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
          overflow: "hidden"
        }}>
          {/* Col 2 Fixed Header */}
          <div style={{
            padding: "8px 12px",
            borderBottom: "1px solid var(--border-color)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "rgba(0, 0, 0, 0.25)",
            flexShrink: 0
          }}>
            <div>
              <h2 style={{ fontSize: 11, fontWeight: 700, margin: 0, color: "#f8fafc", display: "flex", alignItems: "center", gap: 5, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                <span>🎯</span>
                <span>Prompt Query Result</span>
              </h2>
            </div>

            {currentRun && (
              <div style={{
                padding: "2px 7px",
                borderRadius: 12,
                fontSize: 9,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.04em",
                background: status === "completed" ? "rgba(16, 185, 129, 0.2)" :
                            status === "running" ? "rgba(99, 102, 241, 0.2)" :
                            status === "waiting_human" ? "rgba(245, 158, 11, 0.2)" : "rgba(244, 63, 94, 0.2)",
                color: status === "completed" ? "#34d399" :
                       status === "running" ? "#a5b4fc" :
                       status === "waiting_human" ? "#fbbf24" : "#fb7185",
                border: "1px solid currentColor"
              }}>
                {status}
              </div>
            )}
          </div>

          {/* Col 2 Scrollable Body */}
          <div style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            padding: "10px 12px",
            display: "flex",
            flexDirection: "column",
            gap: 8
          }}>
            {currentRun ? (
              <>
                {/* Active Prompt Quoted Box */}
                <div style={{
                  background: "rgba(0, 0, 0, 0.35)",
                  border: "1px solid rgba(255, 255, 255, 0.06)",
                  borderRadius: 6,
                  padding: "8px 10px"
                }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 3 }}>
                    <span style={{ fontSize: 9, color: "#818cf8", fontWeight: 700, textTransform: "uppercase" }}>
                      RUN #{currentRun.id}
                    </span>
                    {currentRun.created_at && (
                      <span style={{ fontSize: 9, color: "#64748b" }}>{currentRun.created_at}</span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: "#e2e8f0", fontStyle: "italic", lineHeight: 1.4 }}>
                    "{currentRun.task}"
                  </div>
                </div>

                {/* Ground Truth Verification Banner */}
                {result?.verified ? (
                  <div style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    background: "rgba(16, 185, 129, 0.12)",
                    border: "1px solid rgba(16, 185, 129, 0.4)",
                    borderRadius: 6,
                    padding: "6px 10px",
                    color: "#34d399",
                    fontSize: 10,
                    fontWeight: 600
                  }}>
                    <span style={{ fontSize: 13 }}>✓</span>
                    <span>100% Ground Truth Verified Independently via SQLite</span>
                  </div>
                ) : status === "running" ? (
                  <div style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    background: "rgba(99, 102, 241, 0.1)",
                    border: "1px solid rgba(99, 102, 241, 0.3)",
                    borderRadius: 6,
                    padding: "6px 10px",
                    color: "#a5b4fc",
                    fontSize: 10
                  }}>
                    <span className="pulsing-indicator">●</span>
                    <span>Actively browsing portal, extracting documents & verifying SQLite...</span>
                  </div>
                ) : (
                  <div style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    background: "rgba(244, 63, 94, 0.1)",
                    border: "1px solid rgba(244, 63, 94, 0.3)",
                    borderRadius: 6,
                    padding: "6px 10px",
                    color: "#fb7185",
                    fontSize: 10
                  }}>
                    <span>⚠</span>
                    <span>{status === "failed" ? "Verification failed or task halted." : "Verification pending."}</span>
                  </div>
                )}

                {/* Findings & Summary Box */}
                <div style={{
                  background: "rgba(255, 255, 255, 0.02)",
                  border: "1px solid rgba(255, 255, 255, 0.07)",
                  borderRadius: 6,
                  padding: 10
                }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={{ fontSize: 9, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase" }}>
                      Query Findings & Summary
                    </span>
                    {result?.summary && (
                      <button
                        onClick={copySummary}
                        style={{
                          background: "transparent",
                          border: "none",
                          color: copied ? "#34d399" : "#818cf8",
                          fontSize: 9,
                          cursor: "pointer",
                          fontWeight: 600
                        }}
                      >
                        {copied ? "✓ Copied" : "📋 Copy"}
                      </button>
                    )}
                  </div>
                  
                  <div style={{
                    fontSize: 11,
                    color: "#f1f5f9",
                    lineHeight: 1.5,
                    whiteSpace: "pre-wrap"
                  }}>
                    {result?.summary || (status === "running" ? "Reasoning in progress. Live telemetry streaming on the right..." : "No result summary available.")}
                  </div>
                </div>

                {/* Extracted 4-Metric Grid */}
                {matchedRecord && (
                  <div style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 6
                  }}>
                    <div style={{
                      background: "rgba(0, 0, 0, 0.3)",
                      padding: "6px 8px",
                      borderRadius: 5,
                      border: "1px solid rgba(255, 255, 255, 0.06)"
                    }}>
                      <div style={{ fontSize: 8, color: "#818cf8", fontWeight: 700, textTransform: "uppercase" }}>
                        🏢 Target Company
                      </div>
                      <div style={{ fontSize: 11, color: "#f8fafc", fontWeight: 600, marginTop: 1 }}>
                        {matchedRecord.company}
                      </div>
                    </div>

                    <div style={{
                      background: "rgba(0, 0, 0, 0.3)",
                      padding: "6px 8px",
                      borderRadius: 5,
                      border: "1px solid rgba(255, 255, 255, 0.06)"
                    }}>
                      <div style={{ fontSize: 8, color: "#818cf8", fontWeight: 700, textTransform: "uppercase" }}>
                        📄 Invoice Number
                      </div>
                      <div style={{ fontSize: 11, color: "#f8fafc", fontWeight: 600, marginTop: 1, fontFamily: "'JetBrains Mono', monospace" }}>
                        {matchedRecord.invoice_no}
                      </div>
                    </div>

                    <div style={{
                      background: "rgba(0, 0, 0, 0.3)",
                      padding: "6px 8px",
                      borderRadius: 5,
                      border: "1px solid rgba(255, 255, 255, 0.06)"
                    }}>
                      <div style={{ fontSize: 8, color: "#818cf8", fontWeight: 700, textTransform: "uppercase" }}>
                        💰 Amount (INR)
                      </div>
                      <div style={{ fontSize: 11, color: "#34d399", fontWeight: 700, marginTop: 1, fontFamily: "'JetBrains Mono', monospace" }}>
                        ₹{Number(matchedRecord.amount).toLocaleString()}
                      </div>
                    </div>

                    <div style={{
                      background: "rgba(0, 0, 0, 0.3)",
                      padding: "6px 8px",
                      borderRadius: 5,
                      border: "1px solid rgba(255, 255, 255, 0.06)"
                    }}>
                      <div style={{ fontSize: 8, color: "#818cf8", fontWeight: 700, textTransform: "uppercase" }}>
                        📅 Due Date
                      </div>
                      <div style={{ fontSize: 11, color: "#e2e8f0", fontWeight: 600, marginTop: 1 }}>
                        {matchedRecord.due_date}
                      </div>
                    </div>
                  </div>
                )}

                {/* Matched DB Record Confirmation */}
                {matchedRecord && (
                  <div style={{
                    background: "rgba(16, 185, 129, 0.07)",
                    border: "1px solid rgba(16, 185, 129, 0.25)",
                    borderRadius: 6,
                    padding: "6px 8px"
                  }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 2 }}>
                      <span style={{ fontSize: 9, fontWeight: 700, color: "#34d399", display: "flex", alignItems: "center", gap: 4 }}>
                        <span>✓</span> RECORD CONFIRMED IN SQLITE RECORDS TABLE
                      </span>
                      <span style={{ fontSize: 8, color: "var(--text-dim)" }}>Updated: {matchedRecord.updated_at}</span>
                    </div>
                    <div style={{ fontSize: 10, color: "#cbd5e1" }}>
                      Invoice <strong>{matchedRecord.invoice_no}</strong> is verified in persistent storage.
                    </div>
                  </div>
                )}

                {/* Evidence Screenshots Carousel */}
                {result?.evidence && result.evidence.length > 0 && (
                  <div style={{ marginTop: "auto", paddingTop: 4 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                      <span style={{ fontSize: 9, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase" }}>
                        Evidence Screenshots ({result.evidence.length})
                      </span>
                      <span style={{ fontSize: 8, color: "var(--text-dim)" }}>Click to zoom</span>
                    </div>

                    <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 2 }}>
                      {result.evidence.map((u, i) => (
                        <div
                          key={i}
                          onClick={() => setPreviewImage(u)}
                          style={{
                            position: "relative",
                            cursor: "pointer",
                            flexShrink: 0
                          }}
                        >
                          <img
                            src={u}
                            alt={`Evidence ${i + 1}`}
                            style={{
                              width: 115,
                              height: 65,
                              objectFit: "cover",
                              borderRadius: 4,
                              border: "1px solid var(--border-color)"
                            }}
                          />
                          <span style={{
                            position: "absolute",
                            bottom: 2,
                            right: 2,
                            background: "rgba(0, 0, 0, 0.75)",
                            color: "#fff",
                            fontSize: 8,
                            padding: "1px 3px",
                            borderRadius: 2
                          }}>
                            Zoom
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                textAlign: "center",
                color: "#6b7280",
                padding: "20px 10px"
              }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>🎯</div>
                <h3 style={{ margin: "0 0 4px 0", fontSize: 13, color: "#cbd5e1" }}>
                  Query Result Standby
                </h3>
                <p style={{ margin: 0, fontSize: 10, maxWidth: 240, lineHeight: 1.45 }}>
                  Select a prompt on the left and click <strong>Execute Task Prompt</strong>.
                </p>
                {runs.length > 0 && (
                  <button
                    onClick={() => loadHistoricalRun(runs[0].id)}
                    style={{
                      marginTop: 10,
                      background: "rgba(99, 102, 241, 0.15)",
                      border: "1px solid rgba(99, 102, 241, 0.3)",
                      color: "#a5b4fc",
                      borderRadius: 5,
                      padding: "4px 10px",
                      fontSize: 10,
                      cursor: "pointer",
                      fontWeight: 600
                    }}
                  >
                    Load Latest Run (#{runs[0].id})
                  </button>
                )}
              </div>
            )}
          </div>
        </section>


        {/* ========================================================================= */}
        {/* COLUMN 3: SYSTEM RECORDED DATA & STORAGE (INVOICES, RUNS, TELEMETRY) */}
        {/* ========================================================================= */}
        <section className="glass-panel" style={{
          height: "100%",
          maxHeight: "100%",
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
          overflow: "hidden"
        }}>
          {/* Col 3 Fixed Tab Header */}
          <div style={{
            padding: "6px 10px",
            borderBottom: "1px solid var(--border-color)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "rgba(0, 0, 0, 0.25)",
            flexShrink: 0
          }}>
            <div style={{ display: "flex", gap: 3 }}>
              {/* Tab 1: Database Invoices */}
              <button
                onClick={() => setActiveTab("records")}
                style={{
                  background: activeTab === "records" ? "rgba(99, 102, 241, 0.25)" : "transparent",
                  color: activeTab === "records" ? "#c7d2fe" : "#94a3b8",
                  border: activeTab === "records" ? "1px solid rgba(99, 102, 241, 0.45)" : "1px solid transparent",
                  padding: "4px 8px",
                  borderRadius: 5,
                  fontSize: 10,
                  fontWeight: 600,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 4
                }}
              >
                <span>🏢 Invoices</span>
                <span style={{
                  background: activeTab === "records" ? "rgba(99, 102, 241, 0.45)" : "rgba(255, 255, 255, 0.08)",
                  padding: "1px 4px",
                  borderRadius: 6,
                  fontSize: 9
                }}>
                  {records.length}
                </span>
              </button>

              {/* Tab 2: Saved Task Runs */}
              <button
                onClick={() => setActiveTab("runs")}
                style={{
                  background: activeTab === "runs" ? "rgba(99, 102, 241, 0.25)" : "transparent",
                  color: activeTab === "runs" ? "#c7d2fe" : "#94a3b8",
                  border: activeTab === "runs" ? "1px solid rgba(99, 102, 241, 0.45)" : "1px solid transparent",
                  padding: "4px 8px",
                  borderRadius: 5,
                  fontSize: 10,
                  fontWeight: 600,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 4
                }}
              >
                <span>📜 Runs</span>
                <span style={{
                  background: activeTab === "runs" ? "rgba(99, 102, 241, 0.45)" : "rgba(255, 255, 255, 0.08)",
                  padding: "1px 4px",
                  borderRadius: 6,
                  fontSize: 9
                }}>
                  {runs.length}
                </span>
              </button>

              {/* Tab 3: Telemetry Stream */}
              <button
                onClick={() => setActiveTab("telemetry")}
                style={{
                  background: activeTab === "telemetry" ? "rgba(99, 102, 241, 0.25)" : "transparent",
                  color: activeTab === "telemetry" ? "#c7d2fe" : "#94a3b8",
                  border: activeTab === "telemetry" ? "1px solid rgba(99, 102, 241, 0.45)" : "1px solid transparent",
                  padding: "4px 8px",
                  borderRadius: 5,
                  fontSize: 10,
                  fontWeight: 600,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 4
                }}
              >
                <span>📡 Telemetry</span>
                <span style={{
                  background: activeTab === "telemetry" ? "rgba(99, 102, 241, 0.45)" : "rgba(255, 255, 255, 0.08)",
                  padding: "1px 4px",
                  borderRadius: 6,
                  fontSize: 9
                }}>
                  {events.length}
                </span>
              </button>
            </div>

            <button
              onClick={fetchAllData}
              style={{
                background: "transparent",
                border: "none",
                color: "#94a3b8",
                fontSize: 10,
                cursor: "pointer",
                padding: "2px 5px"
              }}
              title="Refresh system records"
            >
              🔄
            </button>
          </div>

          {/* Col 3 Scrollable Body */}
          <div style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            padding: "8px 10px",
            display: "flex",
            flexDirection: "column",
            gap: 6
          }}>
            {/* TAB 1: SAVED PORTAL INVOICE RECORDS */}
            {activeTab === "records" && (
              <>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                  <input
                    type="text"
                    placeholder="Filter invoices..."
                    value={recordsFilter}
                    onChange={(e) => setRecordsFilter(e.target.value)}
                    style={{
                      flex: 1,
                      background: "rgba(0, 0, 0, 0.35)",
                      border: "1px solid var(--border-color)",
                      borderRadius: 4,
                      padding: "4px 8px",
                      color: "#f8fafc",
                      fontSize: 10,
                      outline: "none"
                    }}
                  />
                  <div style={{ fontSize: 10, color: "#34d399", fontWeight: 700, whiteSpace: "nowrap", fontFamily: "'JetBrains Mono', monospace" }}>
                    ₹{totalAmount.toLocaleString()}
                  </div>
                </div>

                {filteredRecords.length === 0 ? (
                  <div style={{
                    padding: "30px 10px",
                    textAlign: "center",
                    color: "#6b7280",
                    fontSize: 10,
                    border: "1px dashed rgba(255, 255, 255, 0.1)",
                    borderRadius: 6
                  }}>
                    No invoices matched.
                  </div>
                ) : (
                  <div style={{
                    border: "1px solid var(--border-color)",
                    borderRadius: 6,
                    overflow: "hidden",
                    background: "rgba(0, 0, 0, 0.25)"
                  }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
                      <thead>
                        <tr style={{ background: "rgba(255, 255, 255, 0.03)", borderBottom: "1px solid var(--border-color)" }}>
                          <th style={{ textAlign: "left", padding: "6px 8px", color: "#94a3b8", fontWeight: 600 }}>Invoice #</th>
                          <th style={{ textAlign: "left", padding: "6px 8px", color: "#94a3b8", fontWeight: 600 }}>Company</th>
                          <th style={{ textAlign: "right", padding: "6px 8px", color: "#94a3b8", fontWeight: 600 }}>Amount</th>
                          <th style={{ textAlign: "left", padding: "6px 8px", color: "#94a3b8", fontWeight: 600 }}>Due Date</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredRecords.map((r, i) => {
                          const isHighlighted = matchedRecord?.invoice_no === r.invoice_no;
                          return (
                            <tr
                              key={i}
                              className={isHighlighted ? "highlighted-record-row" : ""}
                              style={{
                                borderBottom: "1px solid rgba(255, 255, 255, 0.04)"
                              }}
                            >
                              <td style={{ padding: "6px 8px", color: "#818cf8", fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>
                                {r.invoice_no}
                                {isHighlighted && (
                                  <span style={{ marginLeft: 4, fontSize: 7, background: "#10b981", color: "#000", padding: "1px 2px", borderRadius: 2, fontWeight: 800 }}>
                                    MATCH
                                  </span>
                                )}
                              </td>
                              <td style={{ padding: "6px 8px", color: "#f1f5f9" }}>{r.company}</td>
                              <td style={{ padding: "6px 8px", textAlign: "right", fontFamily: "'JetBrains Mono', monospace", color: "#34d399", fontWeight: 700 }}>
                                ₹{Number(r.amount).toLocaleString()}
                              </td>
                              <td style={{ padding: "6px 8px", color: "#cbd5e1" }}>{r.due_date}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}

            {/* TAB 2: ALL RECORDED TASK RUNS HISTORY */}
            {activeTab === "runs" && (
              <>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 10, color: "#94a3b8", fontWeight: 600 }}>
                    Recorded Runs ({filteredRuns.length})
                  </span>
                  <div style={{ display: "flex", gap: 2 }}>
                    {["all", "completed", "failed"].map(s => (
                      <button
                        key={s}
                        onClick={() => setRunsFilter(s)}
                        style={{
                          background: runsFilter === s ? "rgba(99, 102, 241, 0.3)" : "rgba(255, 255, 255, 0.04)",
                          border: runsFilter === s ? "1px solid rgba(99, 102, 241, 0.5)" : "1px solid transparent",
                          color: runsFilter === s ? "#c7d2fe" : "#94a3b8",
                          padding: "1px 5px",
                          borderRadius: 3,
                          fontSize: 9,
                          textTransform: "capitalize",
                          cursor: "pointer"
                        }}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                  {filteredRuns.map((r) => {
                    const isCurrent = currentRun?.id === r.id;
                    return (
                      <div
                        key={r.id}
                        style={{
                          background: isCurrent ? "rgba(99, 102, 241, 0.14)" : "rgba(255, 255, 255, 0.02)",
                          border: isCurrent ? "1px solid rgba(99, 102, 241, 0.4)" : "1px solid rgba(255, 255, 255, 0.05)",
                          borderRadius: 5,
                          padding: 6,
                          display: "flex",
                          flexDirection: "column",
                          gap: 3
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                            <span style={{
                              fontFamily: "'JetBrains Mono', monospace",
                              fontSize: 9,
                              color: "#818cf8",
                              fontWeight: 700
                            }}>
                              #{r.id}
                            </span>
                            <span style={{
                              fontSize: 8,
                              padding: "1px 4px",
                              borderRadius: 6,
                              fontWeight: 700,
                              textTransform: "uppercase",
                              background: r.status === "completed" ? "rgba(16, 185, 129, 0.2)" :
                                          r.status === "running" ? "rgba(99, 102, 241, 0.2)" : "rgba(244, 63, 94, 0.2)",
                              color: r.status === "completed" ? "#34d399" :
                                     r.status === "running" ? "#a5b4fc" : "#fb7185"
                            }}>
                              {r.status}
                            </span>
                          </div>
                          <span style={{ fontSize: 8, color: "#64748b" }}>{r.created_at}</span>
                        </div>

                        <div style={{ fontSize: 10, color: "#cbd5e1", lineHeight: 1.35, wordBreak: "break-word" }}>
                          {r.task}
                        </div>

                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 2 }}>
                          {r.result?.verified ? (
                            <span style={{ fontSize: 8, color: "#34d399", fontWeight: 600 }}>
                              ✓ Verified
                            </span>
                          ) : (
                            <span style={{ fontSize: 8, color: "#94a3b8" }}>
                              {r.result?.summary ? r.result.summary.slice(0, 35) + "..." : ""}
                            </span>
                          )}

                          <button
                            onClick={() => loadHistoricalRun(r.id)}
                            style={{
                              background: "rgba(99, 102, 241, 0.2)",
                              border: "1px solid rgba(99, 102, 241, 0.35)",
                              color: "#c7d2fe",
                              borderRadius: 3,
                              padding: "1px 6px",
                              fontSize: 9,
                              cursor: "pointer",
                              fontWeight: 600
                            }}
                          >
                            {isCurrent ? "Active In View" : "Inspect →"}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {/* TAB 3: AGENT EXECUTION TELEMETRY STREAM */}
            {activeTab === "telemetry" && (
              <div style={{
                display: "flex",
                flexDirection: "column",
                gap: 5,
                fontFamily: "'JetBrains Mono', monospace"
              }}>
                {events.length === 0 ? (
                  <div style={{
                    padding: "30px 10px",
                    textAlign: "center",
                    color: "#6b7280",
                    fontSize: 10
                  }}>
                    Execute a prompt on the left to stream live ReAct events.
                  </div>
                ) : (
                  events.map((e) => {
                    const conf = EVENT_CONFIG[e.kind] || { label: e.kind.toUpperCase(), bg: "rgba(255,255,255,0.05)", text: "#94a3b8", icon: "•" };
                    return (
                      <div
                        key={e.id}
                        style={{
                          background: conf.bg,
                          border: `1px solid ${conf.text}33`,
                          borderRadius: 5,
                          padding: "5px 8px",
                          fontSize: 10,
                          lineHeight: 1.4
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 2 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 4, color: conf.text, fontWeight: 700 }}>
                            <span>{conf.icon}</span>
                            <span>{conf.label}</span>
                          </div>
                          <span style={{ color: "#64748b", fontSize: 8 }}>{e.ts}</span>
                        </div>

                        <div style={{ color: "#e2e8f0", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                          {e.message}
                        </div>

                        {e.data?.url && (
                          <div style={{ marginTop: 4 }}>
                            <img
                              src={e.data.url}
                              alt="Screenshot"
                              onClick={() => setPreviewImage(e.data.url)}
                              style={{
                                maxWidth: "100%",
                                maxHeight: 110,
                                borderRadius: 4,
                                border: "1px solid rgba(255,255,255,0.12)",
                                cursor: "pointer"
                              }}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
                <div ref={logEndRef} />
              </div>
            )}
          </div>
        </section>

      </main>

      {/* Screenshot Lightbox Modal */}
      {previewImage && (
        <div
          onClick={() => setPreviewImage(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.88)",
            backdropFilter: "blur(8px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
            padding: 24
          }}
        >
          <div style={{ position: "relative", maxWidth: "90%", maxHeight: "90%" }}>
            <img
              src={previewImage}
              alt="Screenshot Large"
              style={{ width: "100%", height: "auto", borderRadius: 8, border: "1px solid rgba(255,255,255,0.25)", boxShadow: "0 0 40px rgba(0,0,0,0.8)" }}
            />
            <div style={{ textAlign: "center", marginTop: 8, fontSize: 11, color: "#94a3b8" }}>
              Click anywhere to close
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
