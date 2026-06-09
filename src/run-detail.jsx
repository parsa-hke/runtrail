/* global React, window */
const { useState: useStateRD, useEffect: useEffectRD, useMemo: useMemoRD } = React;

function RunDetail({ run, runs, project, navigateTo }) {
  const [tab, setTab] = useStateRD("overview");
  const [editingName, setEditingName] = useStateRD(false);
  const [name, setName] = useStateRD(run.name);
  const [note, setNote] = useStateRD(run.notes || "");

  useEffectRD(() => { setName(run.name); setNote(run.notes || ""); setTab("overview"); }, [run.id]);

  useEffectRD(() => {
    function onKey(e) {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
      const map = { "1": "overview", "2": "metrics", "3": "code", "4": "artifacts", "5": "resources", "6": "raw" };
      if (map[e.key]) { e.preventDefault(); setTab(map[e.key]); }
      if (e.key === "[" || e.key === "]") {
        const i = runs.findIndex(r => r.id === run.id);
        const next = e.key === "]" ? runs[i + 1] : runs[i - 1];
        if (next) navigateTo(next.status === "running" ? `#/live/${next.id}` : `#/runs/${next.id}`);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [run.id, runs, navigateTo]);

  const tabs = [
    ["overview",  "Overview",   "1"],
    ["metrics",   "Metrics",    "2"],
    ["code",      "Code & Env", "3"],
    ["artifacts", "Artifacts",  "4"],
    ["resources", "Resources",  "5"],
    ["raw",       "Raw",        "6"],
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, overflow: "hidden" }}>
      {/* Header */}
      <div style={{
        padding: "14px 24px 12px",
        borderBottom: "1px solid var(--border)",
        background: "var(--bg-2)",
      }}>
        <div style={{ fontSize: 11, color: "var(--fg-4)", marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
          <span onClick={() => navigateTo("#/")} className="linkish" style={{ color: "var(--fg-3)", cursor: "pointer" }}>{project.name}</span>
          <span>›</span>
          <span onClick={() => navigateTo("#/")} className="linkish" style={{ color: "var(--fg-3)", cursor: "pointer" }}>runs</span>
          <span>›</span>
          <span style={{ color: "var(--fg-2)" }}>{run.id}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {editingName ? (
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => setEditingName(false)}
              onKeyDown={(e) => { if (e.key === "Enter") setEditingName(false); }}
              style={{
                fontFamily: "var(--mono)", fontSize: 20, fontWeight: 600,
                background: "var(--surface-2)", color: "var(--fg)",
                border: "1px solid var(--accent)", borderRadius: 3,
                padding: "2px 8px", outline: "none", minWidth: 360,
              }}
            />
          ) : (
            <h1
              onClick={() => setEditingName(true)}
              style={{ margin: 0, fontFamily: "var(--mono)", fontSize: 20, fontWeight: 600, color: "var(--fg)", cursor: "text" }}
              title="Click to edit (e)"
            >
              {name}
            </h1>
          )}
          <StatusBadge status={run.status} pulse={run.status === "running"} />
          {run.pinned && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--accent)" }}>
              {I.pin} pinned
            </span>
          )}
          <span style={{ flex: 1 }} />
          <Btn icon={I.pin}>Pin</Btn>
          <Btn icon={I.tag}>Tag</Btn>
          <Btn icon={I.compare} onClick={() => navigateTo(`#/diff?ids=${run.id},run-a1f3`)}>Compare…</Btn>
          <Btn icon={I.download}>Export</Btn>
          <IconBtn icon={I.dot3} title="More" />
        </div>
        <div style={{ display: "flex", gap: 18, marginTop: 10, fontFamily: "var(--mono)", fontSize: 11.5, color: "var(--fg-3)" }}>
          <span><span style={{ color: "var(--fg-4)" }}>id</span> <span style={{ color: "var(--fg-2)" }}>{run.id}</span></span>
          <span><span style={{ color: "var(--fg-4)" }}>started</span> <span style={{ color: "var(--fg-2)" }}>{fmtTime(run.started)}</span></span>
          <span><span style={{ color: "var(--fg-4)" }}>ended</span> <span style={{ color: "var(--fg-2)" }}>{fmtTime(run.ended)}</span></span>
          <span><span style={{ color: "var(--fg-4)" }}>duration</span> <span style={{ color: "var(--fg-2)" }}>{fmtDuration(run.duration)}</span></span>
          <span><span style={{ color: "var(--fg-4)" }}>user</span> <span style={{ color: "var(--fg-2)" }}>{run.user}</span></span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>{I.branch} <span style={{ color: "var(--fg-2)" }}>{run.branch}</span></span>
          <span style={{ color: "var(--accent)" }}>{run.commit}</span>
          <span style={{ flex: 1 }} />
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--fg-4)" }}>
            {I.link} runtrail://{project.name}/{run.id}
          </span>
        </div>
      </div>

      {/* Tab bar */}
      <div style={{
        display: "flex", gap: 0,
        padding: "0 24px",
        borderBottom: "1px solid var(--border)",
        background: "var(--bg-2)",
      }}>
        {tabs.map(([k, label, kbd]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            style={{
              padding: "10px 14px",
              background: "transparent",
              border: "none",
              borderBottom: `2px solid ${tab === k ? "var(--accent)" : "transparent"}`,
              color: tab === k ? "var(--fg)" : "var(--fg-3)",
              fontFamily: "var(--mono)", fontSize: 12, fontWeight: tab === k ? 600 : 500,
              cursor: "pointer", marginBottom: -1,
              display: "inline-flex", alignItems: "center", gap: 8,
            }}
          >
            <span>{label}</span>
            <KBD>{kbd}</KBD>
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflow: "auto", padding: 24, background: "var(--bg)" }}>
        {tab === "overview"  && <OverviewTab run={run} note={note} setNote={setNote} />}
        {tab === "metrics"   && <MetricsTab run={run} />}
        {tab === "code"      && <CodeTab run={run} />}
        {tab === "artifacts" && <ArtifactsTab run={run} />}
        {tab === "resources" && <ResourcesTab run={run} />}
        {tab === "raw"       && <RawTab run={run} project={project} />}
      </div>
    </div>
  );
}

// ─── Overview ───────────────────────────────────────────────────────────────
function OverviewTab({ run, note, setNote }) {
  const headline = run.metrics?.val_loss || run.metrics?.train_loss;
  const headlineName = run.metrics?.val_loss ? "val_loss" : "train_loss";
  const baseline = window.RT_DATA.RUNS.find(r => r.id === "run-a1f3");

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 320px", gap: 16, alignItems: "start" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
        {/* Key metrics row */}
        <Panel title="Key metrics" padding={0}>
          <div style={{ display: "flex", overflow: "hidden" }}>
            <Stat label="val_acc" value={run.final?.val_acc != null ? fmtPct(run.final.val_acc, 2) : "—"} sub={run.final?.val_acc && baseline ? `${(((run.final.val_acc - baseline.final.val_acc) * 100)).toFixed(2)}pp vs baseline` : null} color={run.final?.val_acc && baseline && run.final.val_acc > baseline.final.val_acc ? "var(--success)" : undefined} />
            <Stat label="val_loss" value={run.final?.val_loss != null ? fmtNum(run.final.val_loss, 3) : "—"} sub={run.final?.val_loss ? `best ${fmtNum(run.metrics.val_loss?.best, 3)}` : null} />
            <Stat label="top-5" value={run.final?.top5 != null ? fmtPct(run.final.top5, 1) : "—"} />
            <Stat label="train_loss" value={run.metrics?.train_loss ? fmtNum(run.metrics.train_loss.last, 3) : "—"} sub={run.metrics?.train_loss ? `best ${fmtNum(run.metrics.train_loss.best, 3)}` : null} />
            <Stat label="duration" value={fmtDuration(run.duration)} sub={`${run.hardware?.count}× ${run.hardware?.gpu?.split(" ")[1] || "gpu"}`} />
            <div style={{ flex: 1 }} />
          </div>
        </Panel>

        {/* Headline chart */}
        <Panel
          title={`${headlineName} — primary metric`}
          action={
            <div style={{ display: "flex", gap: 6 }}>
              <span style={{ fontSize: 10.5, color: "var(--fg-4)" }}>smoothing</span>
              <span style={{ color: "var(--accent)" }}>0.6</span>
            </div>
          }
        >
          {headline ? (
            <LineChart
              overlay={[
                { data: headline.series, color: "var(--accent)", label: headlineName },
                ...(baseline && baseline.id !== run.id && baseline.metrics?.val_loss
                  ? [{ data: baseline.metrics.val_loss.series, color: "var(--fg-4)", label: "baseline" }]
                  : []),
              ]}
              smoothing={0.6}
              height={240}
            />
          ) : <div style={{ color: "var(--fg-3)", padding: 20 }}>No primary metric logged.</div>}
        </Panel>

        {/* Hyperparameters */}
        <Panel
          title="Hyperparameters"
          action={<Btn size="xs" kind="ghost" icon={I.copy} onClick={() => Toast.show("copied as yaml")}>copy</Btn>}
          padding={0}
        >
          <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "var(--mono)", fontSize: 12 }}>
            <tbody>
              {Object.entries(run.hparams || {}).map(([k, v], i) => (
                <tr key={k} style={{ borderBottom: i < Object.entries(run.hparams).length - 1 ? "1px solid var(--border)" : "none" }}>
                  <td style={{ padding: "6px 14px", color: "var(--fg-3)", width: 220 }}>{k}</td>
                  <td style={{ padding: "6px 14px", color: v == null ? "var(--fg-4)" : "var(--fg)" }}>
                    {v == null ? "null" :
                     typeof v === "boolean" ? <span style={{ color: v ? "var(--success)" : "var(--fg-4)" }}>{String(v)}</span> :
                     typeof v === "number" ? fmtNum(v, 4) :
                     String(v)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 16, position: "sticky", top: 0 }}>
        <Panel title="Tags" padding={12}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
            {(run.tags || []).map(t => <Tag key={t} removable>{t}</Tag>)}
            <button style={{
              padding: "2px 6px", height: 20,
              background: "transparent", color: "var(--fg-4)",
              border: "1px dashed var(--border-2)", borderRadius: 2,
              fontFamily: "var(--mono)", fontSize: 10.5, cursor: "pointer",
            }}>+ add tag</button>
          </div>
        </Panel>

        <Panel
          title="Notes (markdown)"
          action={<Btn size="xs" kind="ghost">edit</Btn>}
          padding={12}
        >
          {note ? (
            <div style={{ fontFamily: "var(--sans)", fontSize: 13, color: "var(--fg-2)", lineHeight: 1.55 }}>
              {note.split("\n").map((line, i) => (
                <div key={i} dangerouslySetInnerHTML={{ __html: line.replace(/\*\*([^*]+)\*\*/g, '<strong style="color:var(--fg);font-weight:600">$1</strong>') }} />
              ))}
            </div>
          ) : (
            <div style={{ color: "var(--fg-4)", fontFamily: "var(--mono)", fontSize: 11.5 }}>no notes yet — click edit</div>
          )}
        </Panel>

        <Panel title="Hardware" padding={12}>
          <KV label="gpu" value={`${run.hardware?.gpu || "—"} × ${run.hardware?.count || 1}`} />
          <KV label="cpu" value={run.hardware?.cpu || "—"} />
          <KV label="ram" value={run.hardware?.ram || "—"} />
          <KV label="os"  value={run.hardware?.os  || "—"} />
        </Panel>
      </div>
    </div>
  );
}

function KV({ label, value, mono = true }) {
  return (
    <div style={{ display: "flex", padding: "3px 0", fontFamily: "var(--mono)", fontSize: 11.5 }}>
      <span style={{ width: 80, color: "var(--fg-4)", flex: "0 0 80px" }}>{label}</span>
      <span style={{ color: "var(--fg)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={value}>{value}</span>
    </div>
  );
}

// ─── Metrics ────────────────────────────────────────────────────────────────
function MetricsTab({ run }) {
  const [smoothing, setSmoothing] = useStateRD(0.5);
  const [yLog, setYLog] = useStateRD(false);
  const [full, setFull] = useStateRD(null);

  const metrics = Object.entries(run.metrics || {});

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 14 }}>
        <span style={{ fontSize: 11, color: "var(--fg-3)", display: "inline-flex", alignItems: "center", gap: 8 }}>
          smoothing
          <Slider value={smoothing} onChange={setSmoothing} min={0} max={0.95} step={0.01} width={140} />
          <span style={{ color: "var(--fg)", fontFamily: "var(--mono)", width: 30 }}>{smoothing.toFixed(2)}</span>
        </span>
        <Btn size="xs" active={yLog} onClick={() => setYLog(y => !y)}>y: log</Btn>
        <Btn size="xs" kind="ghost">y: linear</Btn>
        <div style={{ flex: 1 }} />
        <Btn size="xs" kind="ghost" icon={I.plus}>add to overview</Btn>
        <Btn size="xs" kind="ghost" icon={I.download}>export csv</Btn>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(420px, 1fr))", gap: 14 }}>
        {metrics.map(([name, m]) => (
          <Panel
            key={name}
            title={name}
            action={
              <div style={{ display: "flex", alignItems: "center", gap: 10, color: "var(--fg-3)" }}>
                <span style={{ fontSize: 10.5 }}>last <span style={{ color: "var(--fg)" }}>{fmtNum(m.last, 4)}</span></span>
                <span style={{ fontSize: 10.5 }}>best <span style={{ color: "var(--accent)" }}>{fmtNum(m.best, 4)}</span></span>
                <IconBtn icon={I.arrowR} title="Fullscreen" onClick={() => setFull(name)} />
              </div>
            }
            padding={10}
          >
            <LineChart series={m.series} smoothing={smoothing} yLog={yLog && name.includes("lr")} height={170} />
          </Panel>
        ))}
      </div>

      {full && (
        <div onClick={() => setFull(null)} style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 100,
          display: "flex", alignItems: "center", justifyContent: "center", padding: 40,
        }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 1200 }}>
            <Panel title={full} action={<button onClick={() => setFull(null)} style={{ background: "none", border: "none", color: "var(--fg-3)", cursor: "pointer", fontSize: 14 }}>×</button>}>
              <LineChart series={run.metrics[full].series} smoothing={smoothing} yLog={yLog} height={500} />
            </Panel>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Code & Env ─────────────────────────────────────────────────────────────
function CodeTab({ run }) {
  const [selFile, setSelFile] = useStateRD("src/train.py");
  const [pkgQuery, setPkgQuery] = useStateRD("");

  const pkgs = window.RT_DATA.PACKAGES_B.filter(([n]) => n.includes(pkgQuery.toLowerCase()));

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1fr)", gap: 16, alignItems: "start" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
        <Panel title="Git" padding={12}>
          <div style={{ display: "grid", gridTemplateColumns: "100px 1fr auto", gap: 8, alignItems: "center", fontFamily: "var(--mono)", fontSize: 12 }}>
            <span style={{ color: "var(--fg-4)" }}>commit</span>
            <span style={{ color: "var(--accent)" }}>{run.commit} a91b002~1</span>
            <Btn size="xs" icon={I.copy} onClick={() => Toast.show("copied")}>copy</Btn>
            <span style={{ color: "var(--fg-4)" }}>branch</span>
            <span style={{ color: "var(--fg)" }}><span style={{ color: "var(--fg-3)", marginRight: 4 }}>{I.branch}</span>{run.branch}</span>
            <span></span>
            <span style={{ color: "var(--fg-4)" }}>dirty</span>
            <span style={{ color: run.commit === "DIRTY" ? "var(--danger)" : "var(--success)" }}>{run.commit === "DIRTY" ? "yes — uncommitted changes" : "clean"}</span>
            <span></span>
            <span style={{ color: "var(--fg-4)" }}>remote</span>
            <a href="#">github.com/lab/vision-bench/commit/{run.commit}</a>
            <span></span>
          </div>
        </Panel>

        <Panel
          title="Source snapshot"
          action={<span style={{ fontSize: 10.5, color: "var(--fg-4)" }}>{window.RT_DATA.FILE_TREE_B.filter(f => f.kind === "file").length} files</span>}
          padding={0}
        >
          <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", height: 340 }}>
            <div style={{ borderRight: "1px solid var(--border)", overflow: "auto", background: "var(--bg)", padding: "6px 0" }}>
              {window.RT_DATA.FILE_TREE_B.map(f => (
                <div
                  key={f.path}
                  onClick={() => f.kind === "file" && setSelFile(f.path)}
                  style={{
                    padding: "3px 12px 3px " + (f.path.split("/").length * 10 + "px"),
                    cursor: f.kind === "file" ? "pointer" : "default",
                    color: selFile === f.path ? "var(--accent)" : "var(--fg-2)",
                    background: selFile === f.path ? "var(--accent-soft)" : "transparent",
                    fontFamily: "var(--mono)", fontSize: 11.5,
                    display: "flex", alignItems: "center", gap: 4,
                  }}
                >
                  <span style={{ color: f.kind === "dir" ? "var(--fg-4)" : "var(--fg-3)" }}>{f.kind === "dir" ? I.folder : I.doc}</span>
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.path.split("/").pop() || f.path}</span>
                  {f.size && <span style={{ color: "var(--fg-4)", fontSize: 10 }}>{fmtBytes(f.size)}</span>}
                </div>
              ))}
            </div>
            <div style={{ overflow: "auto", background: "var(--surface)" }}>
              <CodeView text={window.RT_DATA.TRAIN_PY_SNIPPET} />
            </div>
          </div>
        </Panel>

        <Panel title="Uncommitted diff" padding={0}
          action={<span style={{ fontSize: 10.5, color: "var(--fg-4)" }}>1 file changed · <span style={{ color: "var(--success)" }}>+5</span> <span style={{ color: "var(--danger)" }}>−5</span></span>}
        >
          <DiffView text={window.RT_DATA.DIFF_HUNK} />
        </Panel>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <Panel title="Command line" padding={12}>
          <div style={{
            background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 3,
            padding: 10, fontFamily: "var(--mono)", fontSize: 11.5, color: "var(--fg-2)",
            whiteSpace: "pre-wrap", wordBreak: "break-word",
          }}>
            <span style={{ color: "var(--accent)" }}>$ </span>{run.cmd}
          </div>
          <div style={{ marginTop: 8 }}>
            <Btn size="xs" icon={I.copy}>copy</Btn>
          </div>
        </Panel>

        <Panel title="Hardware" padding={12}>
          <KV label="gpu"   value={`${run.hardware?.gpu || "—"} × ${run.hardware?.count || 1}`} />
          <KV label="cpu"   value={run.hardware?.cpu || "—"} />
          <KV label="ram"   value={run.hardware?.ram || "—"} />
          <KV label="os"    value={run.hardware?.os || "—"} />
          <KV label="cuda"  value={run.env?.cuda || "—"} />
        </Panel>

        <Panel
          title="Python environment"
          action={<span style={{ fontSize: 10.5, color: "var(--fg-4)" }}>{pkgs.length} packages</span>}
          padding={0}
        >
          <div style={{ padding: 10, borderBottom: "1px solid var(--border)" }}>
            <TextInput value={pkgQuery} onChange={setPkgQuery} placeholder="filter packages…" icon={I.search} />
          </div>
          <div style={{ maxHeight: 280, overflow: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "var(--mono)", fontSize: 11.5 }}>
              <tbody>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  <td style={{ padding: "5px 12px", color: "var(--fg-4)", width: 100 }}>python</td>
                  <td style={{ padding: "5px 12px", color: "var(--fg)" }}>{run.env?.python}</td>
                </tr>
                {pkgs.map(([n, v]) => (
                  <tr key={n} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "5px 12px", color: "var(--fg-2)" }}>{n}</td>
                    <td style={{ padding: "5px 12px", color: "var(--fg-3)" }}>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </div>
  );
}

function CodeView({ text }) {
  const lines = text.split("\n");
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "var(--mono)", fontSize: 11.5 }}>
      <tbody>
        {lines.map((ln, i) => (
          <tr key={i}>
            <td style={{ padding: "0 8px", textAlign: "right", color: "var(--fg-4)", width: 36, userSelect: "none", borderRight: "1px solid var(--border)", verticalAlign: "top" }}>{i + 1}</td>
            <td style={{ padding: "0 8px", color: "var(--fg)", whiteSpace: "pre" }}>{syntaxColor(ln)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function syntaxColor(line) {
  // very lightweight python-ish coloring
  const parts = [];
  const re = /(#.*$)|("[^"]*"|'[^']*')|\b(def|class|return|import|from|for|in|with|if|else|elif|while|try|except|None|True|False|self|as|lambda|yield|pass|raise|cuda|cfg)\b|\b(\d+\.?\d*|\.\d+|\d+e-?\d+)\b/g;
  let last = 0, m;
  while ((m = re.exec(line)) !== null) {
    if (m.index > last) parts.push(<span key={last}>{line.slice(last, m.index)}</span>);
    if (m[1]) parts.push(<span key={m.index} style={{ color: "var(--fg-4)", fontStyle: "italic" }}>{m[0]}</span>);
    else if (m[2]) parts.push(<span key={m.index} style={{ color: "var(--success)" }}>{m[0]}</span>);
    else if (m[3]) parts.push(<span key={m.index} style={{ color: "var(--purple)" }}>{m[0]}</span>);
    else if (m[4]) parts.push(<span key={m.index} style={{ color: "var(--accent)" }}>{m[0]}</span>);
    last = m.index + m[0].length;
  }
  if (last < line.length) parts.push(<span key={"end" + last}>{line.slice(last)}</span>);
  return parts;
}

function DiffView({ text }) {
  const lines = text.split("\n");
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "var(--mono)", fontSize: 11.5 }}>
      <tbody>
        {lines.map((ln, i) => {
          let bg = "transparent", color = "var(--fg-2)";
          if (ln.startsWith("+++") || ln.startsWith("---")) { color = "var(--fg-4)"; }
          else if (ln.startsWith("@@")) { color = "var(--info)"; bg = "var(--info-soft)"; }
          else if (ln.startsWith("+")) { bg = "var(--diff-add)"; color = "var(--success)"; }
          else if (ln.startsWith("-")) { bg = "var(--diff-del)"; color = "var(--danger)"; }
          return (
            <tr key={i} style={{ background: bg }}>
              <td style={{ padding: "0 8px", textAlign: "right", color: "var(--fg-4)", width: 36, userSelect: "none", verticalAlign: "top" }}>{i + 1}</td>
              <td style={{ padding: "0 8px", color, whiteSpace: "pre" }}>{ln || " "}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ─── Artifacts ──────────────────────────────────────────────────────────────
function ArtifactsTab({ run }) {
  const arts = window.RT_DATA.ARTIFACTS_B;
  const [sel, setSel] = useStateRD(arts[0].name);
  const selected = arts.find(a => a.name === sel);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.4fr)", gap: 16, alignItems: "start" }}>
      <Panel title={`Artifacts (${arts.length})`} padding={0}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "var(--mono)", fontSize: 12 }}>
          <thead>
            <tr style={{ background: "var(--surface-2)" }}>
              <th style={tH}>name</th>
              <th style={tH}>type</th>
              <th style={{...tH, textAlign: "right"}}>size</th>
              <th style={tH}></th>
            </tr>
          </thead>
          <tbody>
            {arts.map(a => (
              <tr key={a.name} className="row-hover"
                onClick={() => setSel(a.name)}
                style={{
                  background: sel === a.name ? "var(--surface-2)" : "transparent",
                  borderBottom: "1px solid var(--border)",
                  borderLeft: sel === a.name ? "2px solid var(--accent)" : "2px solid transparent",
                  cursor: "pointer",
                }}
              >
                <td style={{ padding: "7px 12px", color: "var(--fg)" }}>{a.name}</td>
                <td style={{ padding: "7px 12px", color: "var(--fg-3)" }}>{a.type}</td>
                <td style={{ padding: "7px 12px", color: "var(--fg-2)", textAlign: "right" }}>{fmtBytes(a.size)}</td>
                <td style={{ padding: "7px 12px", textAlign: "right" }}>
                  <IconBtn icon={I.download} title="Download" onClick={(e) => { e.stopPropagation(); Toast.show(`downloading ${a.name}`); }} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <Panel
        title={`Preview · ${sel}`}
        action={<Btn size="xs" kind="ghost" icon={I.folder}>open folder</Btn>}
        padding={0}
      >
        <ArtifactPreview artifact={selected} />
      </Panel>
    </div>
  );
}

function ArtifactPreview({ artifact }) {
  if (!artifact) return null;
  if (artifact.type === "image") {
    return (
      <div style={{ padding: 24, background: "var(--bg)", display: "flex", alignItems: "center", justifyContent: "center", minHeight: 360 }}>
        <ConfusionMatrixSVG />
      </div>
    );
  }
  if (artifact.type === "yaml") {
    return <pre style={preStyle}>{`name: resnet50-aug-cosine-lr3e4
seed: 137
optimizer:
  name: adamw
  lr: 3.0e-4
  weight_decay: 5.0e-2
scheduler:
  name: cosine
  warmup_epochs: 5
batch_size: 256
epochs: 90
mixed_precision: true
augment: randaug-m9
dataset:
  name: imagenet-1k
  root: /data/imagenet`}</pre>;
  }
  if (artifact.type === "checkpoint") {
    return (
      <div style={{ padding: 24, color: "var(--fg-3)", fontFamily: "var(--mono)", fontSize: 12 }}>
        <div style={{ color: "var(--fg)" }}>{artifact.name}</div>
        <div style={{ marginTop: 6 }}>binary · {fmtBytes(artifact.size)} · sha256:c9b1…2faa</div>
        <div style={{ marginTop: 18, padding: 12, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 3, fontSize: 11 }}>
          <div style={{ color: "var(--fg-4)", marginBottom: 4 }}>state_dict keys (preview)</div>
          <div>conv1.weight <span style={{ color: "var(--fg-4)" }}>· torch.Size([64, 3, 7, 7])</span></div>
          <div>layer1.0.conv1.weight <span style={{ color: "var(--fg-4)" }}>· torch.Size([64, 64, 1, 1])</span></div>
          <div>layer1.0.bn1.weight <span style={{ color: "var(--fg-4)" }}>· torch.Size([64])</span></div>
          <div>… <span style={{ color: "var(--fg-4)" }}>+ 322 more</span></div>
        </div>
      </div>
    );
  }
  if (artifact.type === "text") {
    return <pre style={preStyle}>{`[2026-05-12 09:13:01] starting train, 4× A100, batch=256
[2026-05-12 09:13:15] epoch 0/90 step 50/5005 loss 6.872 lr 1.20e-5
[2026-05-12 09:14:22] epoch 0/90 step 500/5005 loss 4.231 lr 1.20e-4
[2026-05-12 09:18:01] epoch 1/90 val_loss 3.812 val_acc 0.142
[2026-05-12 09:18:01] checkpoint saved → epoch_1.ckpt
…
[2026-05-12 14:30:55] epoch 89/90 val_loss 0.830 val_acc 0.782 [best]
[2026-05-12 14:31:18] training complete — total 5h 18m`}</pre>;
  }
  return <pre style={preStyle}>{`{
  "name": "resnet50-aug-cosine-lr3e4",
  "size": "${fmtBytes(artifact.size)}",
  "preview": "…"
}`}</pre>;
}

function ConfusionMatrixSVG() {
  // generative diagonal confusion matrix-ish heatmap
  const cells = 10;
  const r = mulberry32Local(7);
  return (
    <svg width="320" height="320" viewBox="0 0 320 320">
      {Array.from({ length: cells }).flatMap((_, i) =>
        Array.from({ length: cells }).map((_, j) => {
          const intensity = i === j ? 0.75 + r() * 0.25 : Math.max(0, (1 - Math.abs(i - j) / 3) * 0.15 * r());
          return (
            <rect key={`${i}-${j}`}
              x={20 + j * 28} y={20 + i * 28}
              width={26} height={26}
              fill={`rgba(245, 158, 11, ${intensity})`}
              stroke="var(--border)" strokeWidth="0.5"
            />
          );
        })
      )}
      <text x="160" y="312" textAnchor="middle" fontFamily="var(--mono)" fontSize="10" fill="var(--fg-4)">predicted ↔ actual</text>
    </svg>
  );
}
function mulberry32Local(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const preStyle = {
  margin: 0, padding: 14,
  fontFamily: "var(--mono)", fontSize: 11.5,
  color: "var(--fg-2)",
  background: "var(--bg)",
  whiteSpace: "pre-wrap",
  minHeight: 360,
};
const tH = {
  padding: "6px 12px", textAlign: "left", fontWeight: 500,
  fontSize: 10.5, color: "var(--fg-4)",
  textTransform: "uppercase", letterSpacing: 0.6,
  borderBottom: "1px solid var(--border)",
};

// ─── Resources ──────────────────────────────────────────────────────────────
function ResourcesTab({ run }) {
  const res = window.RT_DATA.RESOURCES_B;
  const series = [
    ["GPU utilization",  res.gpu_util, "var(--success)"],
    ["GPU memory",       res.gpu_mem,  "var(--info)"],
    ["CPU",              res.cpu,      "var(--accent)"],
    ["RAM",              res.ram,      "var(--purple)"],
    ["Disk read (MiB/s)",res.io_read,  "var(--warn)"],
  ];

  return (
    <div>
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
        gap: 0, border: "1px solid var(--border)", borderRadius: 4, marginBottom: 16,
        background: "var(--surface)", overflow: "hidden",
      }}>
        <Stat label="avg gpu util" value="86%" sub="peak 99%" color="var(--success)" />
        <Stat label="avg gpu mem"  value="78.4 GiB" sub="of 80 GiB"/>
        <Stat label="cpu bottleneck dips" value="14" sub="data-loader stalls" color="var(--warn)"/>
        <Stat label="avg disk read" value="142 MiB/s" />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(420px, 1fr))", gap: 14 }}>
        {series.map(([label, data, color]) => (
          <Panel
            key={label}
            title={label}
            action={
              <span style={{ fontSize: 10.5, color: "var(--fg-3)" }}>
                avg <span style={{ color: "var(--fg)" }}>{fmtPct(data.reduce((a, b) => a + b, 0) / data.length, 0)}</span>
              </span>
            }
            padding={10}
          >
            <LineChart series={data} smoothing={0.3} height={160} color={color} />
          </Panel>
        ))}
      </div>

      <Panel title="Logged events" padding={0} style={{ marginTop: 16 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "var(--mono)", fontSize: 11.5 }}>
          <tbody>
            {[
              ["00:00:12", "info",   "loaded dataset imagenet-1k (1,281,167 images)"],
              ["00:13:11", "info",   "checkpoint epoch_1.ckpt saved (97 MiB)"],
              ["02:11:42", "warn",   "data loader stalled 8.2s — workers idle"],
              ["03:48:01", "info",   "ema decay updated to 0.9995"],
              ["04:12:33", "warn",   "gpu memory spike 79.9/80 GiB"],
              ["05:18:00", "info",   "training complete · best val_acc 0.785 @ epoch 87"],
            ].map(([t, lvl, msg], i) => (
              <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                <td style={{ padding: "5px 12px", color: "var(--fg-4)", width: 90 }}>{t}</td>
                <td style={{ padding: "5px 12px", color: lvl === "warn" ? "var(--warn)" : "var(--info)", width: 60 }}>{lvl}</td>
                <td style={{ padding: "5px 12px", color: "var(--fg-2)" }}>{msg}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}

// ─── Raw ────────────────────────────────────────────────────────────────────
function RawTab({ run, project }) {
  const raw = {
    id: run.id, name: run.name, status: run.status, project: project.name,
    started_at: run.started, ended_at: run.ended, duration_s: run.duration,
    user: run.user, branch: run.branch, commit: run.commit, tags: run.tags,
    hparams: run.hparams, final_metrics: run.final,
    hardware: run.hardware, env: run.env, dataset: run.dataset,
    dataset_hash: run.dataset_hash, command: run.cmd,
    storage: { runs_db: "runs.sqlite", row_id: 8021, table: "runs", artifacts_dir: `artifacts/${run.id}`, snapshot_dir: `snapshots/${run.commit}` },
  };
  const json = JSON.stringify(raw, null, 2);

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <Btn size="xs" icon={I.copy} onClick={() => Toast.show("copied as json")}>Copy as JSON</Btn>
        <Btn size="xs" icon={I.terminal}>Open in jq</Btn>
        <Btn size="xs" kind="ghost">SQLite row</Btn>
        <Btn size="xs" kind="ghost">.json file →</Btn>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: "var(--fg-4)" }}>nothing is hidden — this is exactly what's on disk.</span>
      </div>
      <Panel padding={0}>
        <pre style={{
          margin: 0, padding: 16,
          fontFamily: "var(--mono)", fontSize: 11.5,
          color: "var(--fg-2)", whiteSpace: "pre",
          overflow: "auto", maxHeight: "75vh",
        }}>{json}</pre>
      </Panel>
    </div>
  );
}

window.RunDetail = RunDetail;
