/* global React, window */
const { useState: useStateLR, useEffect: useEffectLR, useRef: useRefLR, useMemo: useMemoLR } = React;

function LiveRunView({ run, runs, project, navigateTo }) {
  const [tick, setTick] = useStateLR(0);
  const [autoScroll, setAutoScroll] = useStateLR(true);
  const [logsOpen, setLogsOpen] = useStateLR(true);
  const [stopConfirm, setStopConfirm] = useStateLR(false);
  const logRef = useRefLR(null);

  // simulate live ticking
  useEffectLR(() => {
    const id = setInterval(() => setTick(t => t + 1), 1500);
    return () => clearInterval(id);
  }, []);

  // We grow synthetic latest values from the seed series each tick
  const live = useMemoLR(() => {
    const out = {};
    for (const [k, m] of Object.entries(run.metrics || {})) {
      const n = m.series.length;
      // append a couple of "live" wobble points
      const extra = [];
      for (let i = 0; i < Math.min(3, tick); i++) {
        const last = extra.length ? extra[extra.length - 1] : m.series[n - 1];
        const dir = k.includes("acc") ? 1 : -1;
        const wobble = (Math.sin((tick + i) * 0.9) * 0.004) + dir * 0.001;
        extra.push(Math.max(0.001, last + wobble));
      }
      out[k] = { ...m, series: [...m.series, ...extra], last: extra[extra.length - 1] ?? m.last };
    }
    return out;
  }, [run.metrics, tick]);

  const elapsedSec = (run.duration || 0) + tick * 1.5;
  const hh = Math.floor(elapsedSec / 3600);
  const mm = Math.floor((elapsedSec % 3600) / 60);
  const ss = Math.floor(elapsedSec % 60);
  const elapsed = `${String(hh).padStart(2,"0")}:${String(mm).padStart(2,"0")}:${String(ss).padStart(2,"0")}`;

  // logs
  const logLines = useMemoLR(() => {
    const base = [
      [ "info",  "starting train, 8× H100, batch=1024" ],
      [ "info",  "loaded dataset imagenet-1k (1,281,167 images)" ],
      [ "info",  "warmup epoch 0/20 — lr=1.2e-6 → 1.0e-3" ],
      [ "info",  "epoch 12/300 step 1500/1252 train_loss 3.812 val_acc 0.412" ],
      [ "warn",  "data loader stalled 4.1s — workers idle" ],
      [ "info",  "checkpoint epoch_12.ckpt saved (412 MiB)" ],
      [ "info",  `epoch 41/300 step 50/1252 train_loss ${fmtNum(2.04 - tick * 0.003, 3)} val_acc ${fmtNum(0.508 + tick * 0.0001, 3)}` ],
      [ "info",  `epoch 41/300 step 100/1252 train_loss ${fmtNum(2.02 - tick * 0.003, 3)}` ],
      [ "info",  `epoch 41/300 step 150/1252 train_loss ${fmtNum(2.01 - tick * 0.003, 3)}` ],
      [ "info",  `epoch 41/300 step 200/1252 train_loss ${fmtNum(2.00 - tick * 0.003, 3)} lr 9.4e-4` ],
      [ "info",  `epoch 41/300 step 250/1252 train_loss ${fmtNum(1.99 - tick * 0.003, 3)}` ],
    ];
    return base;
  }, [tick]);

  useEffectLR(() => {
    if (autoScroll && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logLines, autoScroll]);

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, overflow: "hidden" }}>
      {/* Header */}
      <div style={{
        padding: "14px 24px 12px",
        borderBottom: "1px solid var(--border)",
        background: "var(--bg-2)",
      }}>
        <div style={{ fontSize: 11, color: "var(--fg-4)", marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
          <span onClick={() => navigateTo("#/")} className="linkish" style={{ cursor: "pointer" }}>{project.name}</span>
          <span>›</span>
          <span onClick={() => navigateTo("#/")} className="linkish" style={{ cursor: "pointer" }}>runs</span>
          <span>›</span>
          <span style={{ color: "var(--fg-2)" }}>{run.id}</span>
          <span style={{ color: "var(--fg-4)", marginLeft: 8 }}>· live</span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <h1 style={{ margin: 0, fontFamily: "var(--mono)", fontSize: 20, fontWeight: 600, color: "var(--fg)" }}>{run.name}</h1>
          <StatusBadge status="running" pulse />
          <span style={{
            display: "inline-flex", alignItems: "center", gap: 4,
            fontFamily: "var(--mono)", fontSize: 12, color: "var(--fg-2)",
          }}>
            <span style={{ color: "var(--fg-4)" }}>elapsed</span>
            <span>{elapsed}</span>
          </span>
          <span style={{
            display: "inline-flex", alignItems: "center", gap: 4,
            fontFamily: "var(--mono)", fontSize: 12, color: "var(--fg-2)",
          }}>
            <span style={{ color: "var(--fg-4)" }}>eta</span>
            <span>{run.eta}</span>
          </span>
          <span style={{ flex: 1 }} />
          <Btn icon={I.compare} onClick={() => navigateTo(`#/diff?ids=${run.id},run-a1f3`)}>Compare with…</Btn>
          <Btn icon={I.tag}>Tag</Btn>
          {stopConfirm ? (
            <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 11, color: "var(--danger)" }}>send SIGTERM?</span>
              <Btn size="sm" kind="danger" onClick={() => { Toast.show("kill signal sent"); setStopConfirm(false); }} icon={I.stop}>Confirm stop</Btn>
              <Btn size="sm" kind="ghost" onClick={() => setStopConfirm(false)}>cancel</Btn>
            </div>
          ) : (
            <Btn icon={I.stop} kind="danger" onClick={() => setStopConfirm(true)}>Stop run</Btn>
          )}
        </div>

        {/* Progress bar */}
        <div style={{ marginTop: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--fg-3)", marginBottom: 4, fontFamily: "var(--mono)" }}>
            <span>epoch <span style={{ color: "var(--fg)" }}>41</span>/300 · step <span style={{ color: "var(--fg)" }}>{(50_000 + tick * 12).toLocaleString()}</span> of 375,600</span>
            <span><span style={{ color: "var(--fg)" }}>{(run.progress * 100).toFixed(1)}%</span> · {(124 + tick % 5)} steps/s</span>
          </div>
          <div style={{ height: 4, background: "var(--surface-3)", borderRadius: 2, overflow: "hidden" }}>
            <div style={{
              height: "100%",
              width: (run.progress * 100) + "%",
              background: "linear-gradient(90deg, var(--accent), var(--info))",
              transition: "width .3s",
            }} />
          </div>
        </div>
      </div>

      {/* Main two-pane: charts | resources */}
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <div style={{ flex: 1, minWidth: 0, overflow: "auto", padding: 18, display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Latest values strip */}
          <div style={{
            display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
            gap: 0, border: "1px solid var(--border)", borderRadius: 4,
            background: "var(--surface)", overflow: "hidden",
          }}>
            <Stat label="val_acc"    value={fmtPct(live.val_acc?.last, 2)} sub="last logged" color="var(--info)" />
            <Stat label="train_loss" value={fmtNum(live.train_loss?.last, 3)} sub={`best ${fmtNum(live.train_loss?.best, 3)}`} color="var(--accent)" />
            <Stat label="val_loss"   value={fmtNum(live.val_loss?.last, 3)} sub={`best ${fmtNum(live.val_loss?.best, 3)}`} />
            <Stat label="lr"         value="9.4e-4" sub="cosine, decaying"/>
            <Stat label="throughput" value={`${124 + tick % 5}/s`} sub="steps · running" color="var(--success)"/>
          </div>

          {/* Charts */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(420px, 1fr))", gap: 12 }}>
            {Object.entries(live).map(([k, m]) => (
              <Panel key={k}
                title={k}
                padding={10}
                action={
                  <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 10.5, color: "var(--fg-3)" }}>
                    <StatusDot status="running" pulse />
                    <span>{fmtNum(m.last, 4)}</span>
                  </div>
                }
              >
                <LineChart series={m.series} smoothing={0.4} height={150} />
              </Panel>
            ))}
          </div>
        </div>

        {/* Right rail: resources */}
        <aside style={{
          width: 280, flex: "0 0 280px",
          borderLeft: "1px solid var(--border)",
          background: "var(--bg-2)",
          display: "flex", flexDirection: "column", overflow: "hidden",
        }}>
          <div style={{
            padding: "10px 14px",
            borderBottom: "1px solid var(--border)",
            fontSize: 10.5, color: "var(--fg-3)",
            textTransform: "uppercase", letterSpacing: 0.6,
            display: "flex", alignItems: "center", gap: 6,
          }}>
            <StatusDot status="running" pulse />
            <span>live · 8× H100</span>
          </div>
          <div style={{ overflow: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
            <GpuBlock id={0} util={97 - tick % 3} mem={62.4} memTotal={80} temp={71} />
            <GpuBlock id={1} util={96 - (tick + 1) % 3} mem={62.4} memTotal={80} temp={72} />
            <GpuBlock id={2} util={97} mem={62.3} memTotal={80} temp={70} />
            <GpuBlock id={3} util={95 - (tick + 2) % 4} mem={62.4} memTotal={80} temp={73} />
            <div style={{ borderTop: "1px solid var(--border)", paddingTop: 10, marginTop: 4 }}>
              <ResBlock label="CPU"   value={`${(28 + tick % 5)}%`} bars={[28, 31, 24, 33, 41]} />
              <ResBlock label="RAM"   value="284 / 512 GiB" pct={55} />
              <ResBlock label="DISK"  value="142 MiB/s read" pct={42} />
              <ResBlock label="NET"   value="2.1 GiB/s rx · 0.3 GiB/s tx" pct={61} />
            </div>
          </div>
        </aside>
      </div>

      {/* Logs panel */}
      <div style={{
        borderTop: "1px solid var(--border)",
        background: "var(--bg-2)",
        display: "flex", flexDirection: "column",
        maxHeight: logsOpen ? 220 : 32,
        transition: "max-height .15s",
        overflow: "hidden",
      }}>
        <div style={{
          height: 32, padding: "0 14px",
          display: "flex", alignItems: "center", gap: 10,
          borderBottom: logsOpen ? "1px solid var(--border)" : "none",
          fontSize: 11, color: "var(--fg-3)",
        }}>
          <button onClick={() => setLogsOpen(o => !o)} style={{ background: "none", border: "none", color: "var(--fg-2)", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4, fontFamily: "var(--mono)", fontSize: 11 }}>
            {logsOpen ? I.chevD : I.chevR} stdout / stderr
          </button>
          <span style={{ color: "var(--fg-4)" }}>· tail -f · {logLines.length} lines</span>
          <span style={{ flex: 1 }} />
          <label style={{ display: "inline-flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
            <Checkbox checked={autoScroll} onChange={setAutoScroll} /> autoscroll
          </label>
          <TextInput value="" onChange={() => {}} placeholder="filter logs…" icon={I.search} width={180} />
          <IconBtn icon={I.copy} title="Copy logs" onClick={() => Toast.show("copied logs")} />
        </div>
        {logsOpen && (
          <div ref={logRef} style={{
            flex: 1, overflow: "auto", padding: "8px 14px",
            fontFamily: "var(--mono)", fontSize: 11.5,
            background: "var(--bg)", color: "var(--fg-2)",
          }}>
            {logLines.map(([lvl, msg], i) => (
              <div key={i} style={{ display: "flex", gap: 10, padding: "1px 0" }}>
                <span style={{ color: "var(--fg-4)", width: 84, flex: "0 0 84px" }}>{new Date(Date.now() - (logLines.length - i) * 1500).toLocaleTimeString()}</span>
                <span style={{
                  color: lvl === "warn" ? "var(--warn)" : lvl === "error" ? "var(--danger)" : "var(--info)",
                  width: 50, flex: "0 0 50px", textTransform: "uppercase", fontSize: 10,
                }}>{lvl}</span>
                <span style={{ flex: 1, whiteSpace: "pre-wrap" }}>{msg}</span>
              </div>
            ))}
            <div style={{ display: "flex", gap: 10, padding: "1px 0", color: "var(--accent)" }}>
              <span style={{ width: 84, flex: "0 0 84px", color: "var(--fg-4)" }}>{new Date().toLocaleTimeString()}</span>
              <span style={{ width: 50, flex: "0 0 50px", color: "var(--fg-4)", textTransform: "uppercase", fontSize: 10 }}>info</span>
              <span className="blink">waiting for next step</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function GpuBlock({ id, util, mem, memTotal, temp }) {
  return (
    <div style={{
      background: "var(--surface)",
      border: "1px solid var(--border)",
      borderRadius: 3,
      padding: "8px 10px",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <span style={{ fontFamily: "var(--mono)", fontSize: 11.5, color: "var(--fg)" }}>gpu{id}</span>
        <span style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--fg-4)" }}>{temp}°C</span>
      </div>
      <BarRow label="util" pct={util} color="var(--success)" />
      <BarRow label="mem"  pct={(mem / memTotal) * 100} color="var(--info)" sub={`${mem.toFixed(1)} / ${memTotal} GiB`} />
    </div>
  );
}

function BarRow({ label, pct, color, sub }) {
  const p = Math.max(0, Math.min(100, pct));
  return (
    <div style={{ marginBottom: 4 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--fg-4)", marginBottom: 2, fontFamily: "var(--mono)" }}>
        <span>{label}</span>
        <span style={{ color: "var(--fg-2)" }}>{sub || `${p.toFixed(0)}%`}</span>
      </div>
      <div style={{ height: 4, background: "var(--surface-3)", borderRadius: 1 }}>
        <div style={{ height: "100%", width: p + "%", background: color, borderRadius: 1 }} />
      </div>
    </div>
  );
}

function ResBlock({ label, value, pct, bars }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontFamily: "var(--mono)", fontSize: 11, color: "var(--fg-3)", marginBottom: 3 }}>
        <span style={{ color: "var(--fg-4)" }}>{label}</span>
        <span style={{ color: "var(--fg-2)" }}>{value}</span>
      </div>
      {pct != null ? (
        <div style={{ height: 3, background: "var(--surface-3)", borderRadius: 1 }}>
          <div style={{ height: "100%", width: pct + "%", background: pct > 80 ? "var(--warn)" : "var(--accent)" }} />
        </div>
      ) : bars && (
        <div style={{ display: "flex", gap: 1, height: 16, alignItems: "flex-end" }}>
          {bars.map((v, i) => <div key={i} style={{ flex: 1, height: v + "%", background: "var(--accent)", opacity: 0.7 }} />)}
        </div>
      )}
    </div>
  );
}

window.LiveRunView = LiveRunView;
