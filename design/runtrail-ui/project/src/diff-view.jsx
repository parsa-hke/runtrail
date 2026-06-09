/* global React, window */
const { useState: useStateDV, useMemo: useMemoDV, useEffect: useEffectDV } = React;

function DiffView({ runs, ids, project, navigateTo }) {
  const [order, setOrder] = useStateDV(ids);
  const [diffsOnly, setDiffsOnly] = useStateDV(true);
  useEffectDV(() => setOrder(ids), [ids.join(",")]);

  const selected = order.map(id => runs.find(r => r.id === id)).filter(Boolean);
  const a = selected[0], b = selected[1];

  if (!a || !b) {
    return <div style={{ padding: 40, color: "var(--fg-3)" }}>Need at least 2 runs to diff.</div>;
  }

  const swap = () => setOrder([order[1], order[0], ...order.slice(2)]);

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, overflow: "auto" }}>
      {/* Header */}
      <div style={{
        position: "sticky", top: 0, zIndex: 5,
        padding: "14px 24px",
        borderBottom: "1px solid var(--border)",
        background: "var(--bg-2)",
        backdropFilter: "blur(8px)",
      }}>
        <div style={{ fontSize: 11, color: "var(--fg-4)", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
          <span onClick={() => navigateTo("#/")} className="linkish" style={{ cursor: "pointer" }}>{project.name}</span>
          <span>›</span>
          <span style={{ color: "var(--fg-2)" }}>diff</span>
          <span style={{ color: "var(--fg-4)", marginLeft: 8 }}>· {selected.length} runs</span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <RunPill run={a} side="A" />
          <button onClick={swap} title="Swap (s)" style={{
            width: 30, height: 30, borderRadius: 3,
            background: "var(--surface-2)", color: "var(--fg-2)",
            border: "1px solid var(--border-2)", cursor: "pointer",
            display: "inline-flex", alignItems: "center", justifyContent: "center",
          }}>{I.swap}</button>
          <RunPill run={b} side="B" />

          <span style={{ flex: 1 }} />

          <Btn icon={I.bolt} onClick={() => Toast.show("analyzing divergence…")}>Suggest cause</Btn>
          <Btn icon={I.compare} kind="ghost">Add run…</Btn>
        </div>

        {/* Insight banner */}
        <Insight a={a} b={b} />
      </div>

      <div style={{ padding: "16px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
        <DiffSection title="Summary" icon={I.bars} anchor="summary">
          <SummaryBlock a={a} b={b} />
        </DiffSection>

        <DiffSection
          title="Hyperparameters"
          icon={I.gear}
          anchor="hparams"
          action={
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--fg-3)", cursor: "pointer" }}>
              <Checkbox checked={diffsOnly} onChange={setDiffsOnly} /> only differences
            </label>
          }
        >
          <HParamsDiff a={a} b={b} diffsOnly={diffsOnly} />
        </DiffSection>

        <DiffSection title="Metrics" icon={I.bars} anchor="metrics">
          <MetricsDiff a={a} b={b} />
        </DiffSection>

        <DiffSection title="Code" icon={I.branch} anchor="code"
          action={<span style={{ fontSize: 10.5, color: "var(--fg-4)" }}>1 file changed · <span style={{ color: "var(--success)" }}>+5</span> <span style={{ color: "var(--danger)" }}>−5</span></span>}
        >
          <CodeDiff />
        </DiffSection>

        <DiffSection title="Environment" icon={I.terminal} anchor="env">
          <EnvDiff />
        </DiffSection>

        <DiffSection title="Hardware" icon={I.cpu} anchor="hw">
          <HardwareDiff a={a} b={b} />
        </DiffSection>

        <DiffSection title="Data" icon={I.folder} anchor="data">
          <DataDiff a={a} b={b} />
        </DiffSection>
      </div>
    </div>
  );
}

function RunPill({ run, side }) {
  const c = side === "A" ? "var(--accent)" : "var(--info)";
  return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: 10,
      padding: "6px 12px",
      background: "var(--surface)",
      border: `1px solid var(--border-2)`,
      borderLeft: `3px solid ${c}`,
      borderRadius: 3, minWidth: 280, flex: "1 1 auto", maxWidth: 460,
    }}>
      <div style={{
        width: 22, height: 22, borderRadius: 3, background: c, color: "#0d0f12",
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        fontFamily: "var(--mono)", fontWeight: 700, fontSize: 12, flex: "0 0 22px",
      }}>{side}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <StatusDot status={run.status} />
          <span style={{ color: "var(--fg)", fontFamily: "var(--mono)", fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{run.name}</span>
        </div>
        <div style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--fg-4)", marginTop: 2 }}>
          {run.id} · {run.user} · {relTime(run.started)}
        </div>
      </div>
    </div>
  );
}

function Insight({ a, b }) {
  const deltaAcc = (b.final?.val_acc != null && a.final?.val_acc != null) ? (b.final.val_acc - a.final.val_acc) : null;
  const better = deltaAcc != null ? (deltaAcc > 0 ? "B" : "A") : null;
  const winnerColor = better === "B" ? "var(--info)" : "var(--accent)";

  return (
    <div style={{
      marginTop: 12,
      display: "flex", alignItems: "center", gap: 10,
      padding: "9px 14px",
      background: "var(--surface-2)",
      border: "1px solid var(--border-2)",
      borderLeft: `3px solid ${winnerColor}`,
      borderRadius: 3,
      fontFamily: "var(--mono)", fontSize: 12,
    }}>
      <span style={{ color: "var(--accent)" }}>{I.bolt}</span>
      <span style={{ color: "var(--fg-2)" }}>
        <span style={{ color: winnerColor }}>Run {better}</span> improved
        <span style={{ color: "var(--fg)" }}> val_acc by {deltaAcc != null ? (deltaAcc > 0 ? "+" : "") + (deltaAcc * 100).toFixed(2) + "pp" : "—"} </span>
        with{" "}
        <span style={{ color: "var(--fg)" }}>optimizer={b.hparams?.optimizer}</span>
        {" "}(from <span style={{ color: "var(--fg-4)" }}>{a.hparams?.optimizer}</span>),{" "}
        <span style={{ color: "var(--fg)" }}>lr={fmtNum(b.hparams?.lr, 1)}</span>
        {" "}(from <span style={{ color: "var(--fg-4)" }}>{fmtNum(a.hparams?.lr, 1)}</span>),{" "}
        and a different <span style={{ color: "var(--fg)" }}>random seed</span>.
      </span>
      <span style={{ flex: 1 }} />
      <span style={{ fontSize: 11, color: "var(--fg-4)" }}>confidence ·</span>
      <div style={{ width: 60, height: 4, background: "var(--surface-3)", borderRadius: 2 }}>
        <div style={{ width: "78%", height: "100%", background: winnerColor, borderRadius: 2 }} />
      </div>
      <span style={{ fontSize: 11, color: "var(--fg-2)" }}>78%</span>
    </div>
  );
}

function DiffSection({ title, icon, anchor, action, children }) {
  return (
    <section id={anchor} style={{ scrollMarginTop: 220 }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        marginBottom: 8,
      }}>
        <span style={{ color: "var(--fg-3)" }}>{icon}</span>
        <h2 style={{ margin: 0, fontFamily: "var(--mono)", fontSize: 13, fontWeight: 600, color: "var(--fg)", letterSpacing: 0.2 }}>{title}</h2>
        <span style={{ flex: 1, height: 1, background: "var(--border)", marginLeft: 4 }} />
        {action}
      </div>
      <div style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 4,
        overflow: "hidden",
      }}>{children}</div>
    </section>
  );
}

// ─── Summary ────────────────────────────────────────────────────────────────
function SummaryBlock({ a, b }) {
  const metricKeys = ["val_acc", "val_loss", "top5"];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0 }}>
      {[a, b].map((r, i) => {
        const isA = i === 0;
        const c = isA ? "var(--accent)" : "var(--info)";
        return (
          <div key={r.id} style={{ padding: 16, borderRight: isA ? "1px solid var(--border)" : "none" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
              <span style={{
                width: 18, height: 18, borderRadius: 3, background: c,
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                color: "#0d0f12", fontFamily: "var(--mono)", fontWeight: 700, fontSize: 10,
              }}>{isA ? "A" : "B"}</span>
              <span style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--fg)" }}>{r.name}</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
              {metricKeys.map(k => {
                const v = r.final?.[k];
                const other = (isA ? b : a).final?.[k];
                const winner = v != null && other != null
                  ? ((k === "val_loss" ? v < other : v > other) ? "win" : "lose")
                  : null;
                return (
                  <div key={k} style={{
                    padding: 10,
                    background: "var(--surface-2)",
                    border: `1px solid ${winner === "win" ? "var(--success)33" : "var(--border)"}`,
                    borderRadius: 3,
                  }}>
                    <div style={{ fontSize: 10, color: "var(--fg-4)", textTransform: "uppercase", letterSpacing: 0.6 }}>{k}</div>
                    <div style={{ fontFamily: "var(--mono)", fontSize: 18, fontWeight: 600, color: winner === "win" ? "var(--success)" : "var(--fg)", marginTop: 2 }}>
                      {v == null ? "—" : k.endsWith("_acc") || k === "top5" ? fmtPct(v, 2) : fmtNum(v, 3)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── HParams diff ───────────────────────────────────────────────────────────
function HParamsDiff({ a, b, diffsOnly }) {
  const keys = useMemoDV(() => {
    const all = new Set([...Object.keys(a.hparams || {}), ...Object.keys(b.hparams || {})]);
    return [...all].sort();
  }, [a, b]);

  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "var(--mono)", fontSize: 12 }}>
      <thead>
        <tr style={{ background: "var(--surface-2)" }}>
          <th style={tHDV}>parameter</th>
          <th style={tHDV}><span style={{ color: "var(--accent)" }}>A</span> {a.name.slice(0, 26)}</th>
          <th style={tHDV}><span style={{ color: "var(--info)" }}>B</span> {b.name.slice(0, 26)}</th>
          <th style={{ ...tHDV, width: 60 }}>Δ</th>
        </tr>
      </thead>
      <tbody>
        {keys.map(k => {
          const va = a.hparams?.[k];
          const vb = b.hparams?.[k];
          const exists = (x) => x !== undefined;
          let cls = "same";
          if (!exists(va)) cls = "added";
          else if (!exists(vb)) cls = "removed";
          else if (JSON.stringify(va) !== JSON.stringify(vb)) cls = "changed";

          if (diffsOnly && cls === "same") return null;

          const bgMap = {
            added:   "var(--diff-add)",
            removed: "var(--diff-del)",
            changed: "var(--diff-edit)",
            same:    "transparent",
          };
          const deltaIcon = {
            added: <span style={{ color: "var(--success)" }}>+</span>,
            removed: <span style={{ color: "var(--danger)" }}>−</span>,
            changed: <span style={{ color: "var(--accent)" }}>~</span>,
            same: <span style={{ color: "var(--fg-4)" }}>=</span>,
          }[cls];

          return (
            <tr key={k} style={{ background: bgMap[cls], borderBottom: "1px solid var(--border)" }}>
              <td style={{ padding: "5px 14px", color: "var(--fg-3)", width: 220 }}>{k}</td>
              <td style={{ padding: "5px 14px", color: va === undefined ? "var(--fg-4)" : "var(--fg)" }}>
                {va === undefined ? "—" : formatHParam(va)}
              </td>
              <td style={{ padding: "5px 14px", color: vb === undefined ? "var(--fg-4)" : "var(--fg)" }}>
                {vb === undefined ? "—" : formatHParam(vb)}
              </td>
              <td style={{ padding: "5px 14px", textAlign: "center" }}>{deltaIcon}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function formatHParam(v) {
  if (v == null) return "null";
  if (typeof v === "boolean") return String(v);
  if (typeof v === "number") return fmtNum(v, 4);
  return String(v);
}

const tHDV = {
  padding: "8px 14px", textAlign: "left", fontWeight: 500,
  fontSize: 10.5, color: "var(--fg-4)",
  textTransform: "uppercase", letterSpacing: 0.6,
  borderBottom: "1px solid var(--border)",
};

// ─── Metrics diff ───────────────────────────────────────────────────────────
function MetricsDiff({ a, b }) {
  const keys = useMemoDV(() => {
    const all = new Set([...Object.keys(a.metrics || {}), ...Object.keys(b.metrics || {})]);
    return [...all].filter(k => a.metrics?.[k] && b.metrics?.[k]);
  }, [a, b]);
  const [onlyDiv, setOnlyDiv] = useStateDV(false);

  return (
    <>
      <div style={{
        padding: "8px 14px",
        borderBottom: "1px solid var(--border)",
        background: "var(--surface-2)",
        display: "flex", alignItems: "center", gap: 12,
      }}>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--fg-3)", cursor: "pointer" }}>
          <Checkbox checked={onlyDiv} onChange={setOnlyDiv} /> only diverging
        </label>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: "var(--fg-4)" }}>{keys.length} metrics overlap</span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(420px, 1fr))", gap: 1, background: "var(--border)" }}>
        {keys.map(k => {
          const ma = a.metrics[k], mb = b.metrics[k];
          const dAbs = mb.last - ma.last;
          const dRel = ma.last ? dAbs / ma.last : 0;
          return (
            <div key={k} style={{ padding: 14, background: "var(--surface)" }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8 }}>
                <span style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--fg)" }}>{k}</span>
                <span style={{ flex: 1 }} />
                <span style={{
                  fontFamily: "var(--mono)", fontSize: 11,
                  color: (k === "val_loss" ? dAbs < 0 : dAbs > 0) ? "var(--success)" : "var(--danger)",
                }}>
                  {dAbs >= 0 ? "+" : ""}{fmtNum(dAbs, 3)}
                  <span style={{ color: "var(--fg-4)" }}> · {dRel >= 0 ? "+" : ""}{(dRel * 100).toFixed(1)}%</span>
                </span>
              </div>
              <LineChart
                overlay={[
                  { data: ma.series, color: "var(--accent)", label: "A" },
                  { data: mb.series, color: "var(--info)", label: "B" },
                ]}
                smoothing={0.4}
                height={150}
                fill={false}
                compact
              />
            </div>
          );
        })}
      </div>
    </>
  );
}

// ─── Code diff ──────────────────────────────────────────────────────────────
function CodeDiff() {
  const [collapsed, setCollapsed] = useStateDV(false);
  return (
    <div>
      <div style={{
        padding: "8px 14px",
        borderBottom: "1px solid var(--border)",
        background: "var(--surface-2)",
        display: "flex", alignItems: "center", gap: 12,
        fontFamily: "var(--mono)", fontSize: 11.5,
      }}>
        <button onClick={() => setCollapsed(c => !c)} style={{ background: "none", border: "none", color: "var(--fg-3)", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4, fontFamily: "inherit", fontSize: "inherit" }}>
          {collapsed ? I.chevR : I.chevD} src/train.py
        </button>
        <span style={{ flex: 1 }} />
        <span style={{ color: "var(--success)" }}>+5</span>
        <span style={{ color: "var(--danger)" }}>−5</span>
        <Btn size="xs" kind="ghost" icon={I.copy}>copy patch</Btn>
      </div>
      {!collapsed && <SideBySideDiff text={window.RT_DATA.DIFF_HUNK} />}
    </div>
  );
}

function SideBySideDiff({ text }) {
  // parse the hunk into left/right pairs
  const lines = text.split("\n");
  const rows = [];
  let lNum = 0, rNum = 0;
  for (const ln of lines) {
    if (ln.startsWith("+++") || ln.startsWith("---")) continue;
    if (ln.startsWith("@@")) {
      const m = /@@ -(\d+),\d+ \+(\d+),\d+ @@/.exec(ln);
      if (m) { lNum = parseInt(m[1]); rNum = parseInt(m[2]); }
      rows.push({ kind: "hunk", text: ln });
    } else if (ln.startsWith("-")) {
      rows.push({ kind: "del", left: { n: lNum++, text: ln.slice(1) }, right: null });
    } else if (ln.startsWith("+")) {
      // try to attach to the most recent del with no right
      const last = rows[rows.length - 1];
      if (last && last.kind === "del" && !last.right) {
        last.kind = "edit";
        last.right = { n: rNum++, text: ln.slice(1) };
      } else {
        rows.push({ kind: "add", left: null, right: { n: rNum++, text: ln.slice(1) } });
      }
    } else {
      rows.push({ kind: "ctx", left: { n: lNum++, text: ln.slice(1) }, right: { n: rNum++, text: ln.slice(1) } });
    }
  }

  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "var(--mono)", fontSize: 11.5, tableLayout: "fixed" }}>
      <tbody>
        {rows.map((r, i) => {
          if (r.kind === "hunk") {
            return (
              <tr key={i}>
                <td colSpan={4} style={{
                  padding: "4px 14px", color: "var(--info)",
                  background: "var(--info-soft)", fontSize: 10.5,
                }}>{r.text}</td>
              </tr>
            );
          }
          return (
            <tr key={i}>
              <td style={diffNum(r.left)}>{r.left?.n ?? ""}</td>
              <td style={diffCell(r.left, r.kind === "del" || r.kind === "edit", "del")}>{r.left?.text ?? ""}</td>
              <td style={diffNum(r.right)}>{r.right?.n ?? ""}</td>
              <td style={diffCell(r.right, r.kind === "add" || r.kind === "edit", "add")}>{r.right?.text ?? ""}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function diffNum(side) {
  return {
    padding: "0 8px", textAlign: "right",
    color: "var(--fg-4)", width: 32, fontSize: 10.5,
    background: side ? "var(--surface-2)" : "var(--surface-3)",
    borderRight: "1px solid var(--border)",
    userSelect: "none", verticalAlign: "top",
  };
}
function diffCell(side, isChange, kind) {
  return {
    padding: "0 8px",
    color: !side ? "var(--fg-4)"
      : isChange ? (kind === "del" ? "var(--danger)" : "var(--success)")
      : "var(--fg-2)",
    background: !side ? "var(--surface-3)"
      : isChange ? (kind === "del" ? "var(--diff-del)" : "var(--diff-add)")
      : "transparent",
    whiteSpace: "pre-wrap", wordBreak: "break-all",
    verticalAlign: "top",
  };
}

// ─── Env diff ───────────────────────────────────────────────────────────────
function EnvDiff() {
  const A = new Map(window.RT_DATA.PACKAGES_A);
  const B = new Map(window.RT_DATA.PACKAGES_B);
  const keys = [...new Set([...A.keys(), ...B.keys()])].sort();
  const diffs = keys.filter(k => A.get(k) !== B.get(k));
  const same = keys.filter(k => A.get(k) === B.get(k));

  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "var(--mono)", fontSize: 12 }}>
      <thead>
        <tr style={{ background: "var(--surface-2)" }}>
          <th style={tHDV}>package</th>
          <th style={tHDV}><span style={{ color: "var(--accent)" }}>A</span></th>
          <th style={tHDV}><span style={{ color: "var(--info)" }}>B</span></th>
          <th style={{ ...tHDV, width: 80 }}>Δ</th>
        </tr>
      </thead>
      <tbody>
        <tr style={{ background: A.get("python") === B.get("python") ? "transparent" : "var(--diff-edit)" }}>
          <td style={{ padding: "5px 14px", color: "var(--fg-2)" }}>python</td>
          <td style={{ padding: "5px 14px", color: "var(--fg)" }}>3.11.7</td>
          <td style={{ padding: "5px 14px", color: "var(--fg)" }}>3.11.7</td>
          <td style={{ padding: "5px 14px", color: "var(--fg-4)", textAlign: "center" }}>=</td>
        </tr>
        {diffs.map(k => (
          <tr key={k} style={{ background: "var(--diff-edit)", borderTop: "1px solid var(--border)" }}>
            <td style={{ padding: "5px 14px", color: "var(--fg-2)" }}>{k}</td>
            <td style={{ padding: "5px 14px", color: "var(--fg)" }}>{A.get(k) ?? "—"}</td>
            <td style={{ padding: "5px 14px", color: "var(--fg)" }}>{B.get(k) ?? "—"}</td>
            <td style={{ padding: "5px 14px", textAlign: "center", color: "var(--accent)" }}>~ minor</td>
          </tr>
        ))}
        <tr>
          <td colSpan={4} style={{ padding: "8px 14px", color: "var(--fg-4)", fontSize: 11 }}>
            + {same.length} identical packages (collapsed)
          </td>
        </tr>
      </tbody>
    </table>
  );
}

// ─── Hardware diff ──────────────────────────────────────────────────────────
function HardwareDiff({ a, b }) {
  const fields = [
    ["gpu",   `${a.hardware?.gpu} × ${a.hardware?.count}`, `${b.hardware?.gpu} × ${b.hardware?.count}`],
    ["cpu",   a.hardware?.cpu || "—", b.hardware?.cpu || "—"],
    ["ram",   a.hardware?.ram || "—", b.hardware?.ram || "—"],
    ["os",    a.hardware?.os || "—",  b.hardware?.os || "—"],
  ];
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "var(--mono)", fontSize: 12 }}>
      <tbody>
        {fields.map(([k, va, vb]) => (
          <tr key={k} style={{
            background: va !== vb ? "var(--diff-edit)" : "transparent",
            borderBottom: "1px solid var(--border)",
          }}>
            <td style={{ padding: "8px 14px", color: "var(--fg-3)", width: 100 }}>{k}</td>
            <td style={{ padding: "8px 14px", color: "var(--fg)" }}>{va}</td>
            <td style={{ padding: "8px 14px", color: "var(--fg)" }}>{vb}</td>
            <td style={{ padding: "8px 14px", textAlign: "center", width: 60, color: va === vb ? "var(--fg-4)" : "var(--accent)" }}>{va === vb ? "=" : "~"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ─── Data diff ──────────────────────────────────────────────────────────────
function DataDiff({ a, b }) {
  const sameHash = (a.dataset_hash || "?") === (b.dataset_hash || "?");
  const samePath = (a.dataset || "?") === (b.dataset || "?");
  return (
    <div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "var(--mono)", fontSize: 12 }}>
        <tbody>
          <tr style={{ borderBottom: "1px solid var(--border)" }}>
            <td style={{ padding: "8px 14px", color: "var(--fg-3)", width: 140 }}>dataset</td>
            <td style={{ padding: "8px 14px", color: "var(--fg)" }}>{a.dataset || "—"}</td>
            <td style={{ padding: "8px 14px", color: "var(--fg)" }}>{b.dataset || "—"}</td>
          </tr>
          <tr style={{ background: !sameHash && samePath ? "var(--diff-del)" : "transparent" }}>
            <td style={{ padding: "8px 14px", color: "var(--fg-3)" }}>sha256</td>
            <td style={{ padding: "8px 14px", color: "var(--fg)" }}>{a.dataset_hash || "(unknown)"}</td>
            <td style={{ padding: "8px 14px", color: "var(--fg)" }}>{b.dataset_hash || "(unknown)"}</td>
          </tr>
        </tbody>
      </table>
      {!sameHash && samePath && (
        <div style={{
          margin: "0 14px 14px",
          padding: "8px 12px",
          background: "var(--danger-soft)",
          border: "1px solid var(--danger)33",
          color: "var(--danger)",
          fontFamily: "var(--mono)", fontSize: 11.5,
          borderRadius: 3,
          display: "flex", alignItems: "center", gap: 8,
        }}>
          <span>⚠</span>
          dataset paths match but content hashes differ — data may have changed between runs.
        </div>
      )}
    </div>
  );
}

window.DiffViewPage = DiffView;
