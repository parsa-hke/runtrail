/* global React, window */
const { useState, useEffect, useRef, useMemo, useCallback, useLayoutEffect, Fragment } = React;

// ─── Format helpers ─────────────────────────────────────────────────────────
function fmtDuration(s) {
  if (s == null) return "—";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  if (h) return `${h}h ${String(m).padStart(2,"0")}m`;
  if (m) return `${m}m ${String(sec).padStart(2,"0")}s`;
  return `${sec}s`;
}
function fmtBytes(n) {
  if (n == null) return "—";
  const u = ["B", "KiB", "MiB", "GiB", "TiB"];
  let i = 0; let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 ? 2 : v < 100 ? 1 : 0)} ${u[i]}`;
}
function fmtNum(n, d = 3) {
  if (n == null) return "—";
  if (n === 0) return "0";
  const abs = Math.abs(n);
  if (abs >= 100) return n.toFixed(0);
  if (abs >= 1) return n.toFixed(d);
  if (abs >= 0.01) return n.toFixed(d);
  return n.toExponential(1);
}
function fmtPct(n, d = 1) { return n == null ? "—" : (n * 100).toFixed(d) + "%"; }
function fmtTime(iso) {
  if (!iso) return "—";
  return iso.replace("T", " ").replace(/:\d\d$/, "");
}
function relTime(iso) {
  if (!iso) return "—";
  const t = new Date(iso.replace(" ", "T") + "Z").getTime();
  if (Number.isNaN(t)) return iso;
  const now = new Date("2026-05-13T12:00:00Z").getTime();
  const s = Math.floor((now - t) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// ─── Atomic UI ──────────────────────────────────────────────────────────────
const STATUS_COLOR = {
  done:    { fg: "var(--success)", bg: "var(--success-soft)", label: "done"    },
  running: { fg: "var(--info)",    bg: "var(--info-soft)",    label: "running" },
  failed:  { fg: "var(--danger)",  bg: "var(--danger-soft)",  label: "failed"  },
  killed:  { fg: "var(--fg-4)",    bg: "var(--surface-3)",    label: "killed"  },
  queued:  { fg: "var(--warn)",    bg: "var(--accent-soft)",  label: "queued"  },
};

function StatusDot({ status, pulse = false }) {
  const c = STATUS_COLOR[status] || STATUS_COLOR.killed;
  return (
    <span style={{
      display: "inline-block",
      width: 8, height: 8, borderRadius: 8,
      background: c.fg,
      boxShadow: pulse ? `0 0 0 3px ${c.bg}` : "none",
      animation: pulse ? "rtPulse 1.5s ease-in-out infinite" : "none",
      flex: "0 0 8px",
    }} />
  );
}

function StatusBadge({ status, pulse }) {
  const c = STATUS_COLOR[status] || STATUS_COLOR.killed;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      padding: "2px 7px 2px 7px", height: 20,
      background: c.bg, color: c.fg,
      border: `1px solid ${c.fg}33`,
      borderRadius: 3,
      fontFamily: "var(--mono)", fontSize: 11, fontWeight: 500,
      letterSpacing: 0.2,
    }}>
      <StatusDot status={status} pulse={pulse} />
      {c.label}
    </span>
  );
}

function Tag({ children, onClick, removable, color }) {
  return (
    <span
      onClick={onClick}
      style={{
        display: "inline-flex", alignItems: "center", gap: 4,
        padding: "1px 6px", height: 18,
        background: "var(--surface-3)",
        color: color || "var(--fg-2)",
        border: "1px solid var(--border)",
        borderRadius: 2,
        fontFamily: "var(--mono)", fontSize: 10.5,
        cursor: onClick ? "pointer" : "default",
        userSelect: "none",
      }}
    >
      <span style={{ color: "var(--fg-4)" }}>#</span>{children}
      {removable && <span style={{ marginLeft: 2, color: "var(--fg-4)" }}>×</span>}
    </span>
  );
}

function KBD({ children }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      minWidth: 16, height: 16, padding: "0 4px",
      background: "var(--surface-3)",
      border: "1px solid var(--border)",
      borderBottomWidth: 2,
      borderRadius: 3,
      fontFamily: "var(--mono)", fontSize: 10, color: "var(--fg-2)",
      lineHeight: 1, marginLeft: 1, marginRight: 1,
      verticalAlign: "middle",
    }}>{children}</span>
  );
}

function Btn({ children, onClick, kind = "default", size = "sm", icon, kbd, active, disabled, title, style }) {
  const sizing = size === "xs"
    ? { height: 22, padding: "0 7px", fontSize: 11 }
    : size === "md"
    ? { height: 30, padding: "0 12px", fontSize: 13 }
    : { height: 26, padding: "0 9px", fontSize: 12 };
  const kinds = {
    default: { bg: "var(--surface-2)", fg: "var(--fg)",      bd: "var(--border-2)" },
    ghost:   { bg: "transparent",      fg: "var(--fg-2)",    bd: "transparent" },
    primary: { bg: "var(--accent)",    fg: "#1c1408",        bd: "var(--accent)" },
    danger:  { bg: "var(--surface-2)", fg: "var(--danger)",  bd: "var(--border-2)" },
  };
  const k = kinds[kind] || kinds.default;
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        ...sizing,
        background: active ? "var(--accent-soft)" : k.bg,
        color: active ? "var(--accent)" : k.fg,
        border: `1px solid ${active ? "var(--accent)" : k.bd}`,
        borderRadius: 3,
        fontFamily: "var(--mono)", fontWeight: 500,
        opacity: disabled ? 0.4 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
        transition: "background .12s, border-color .12s, color .12s",
        whiteSpace: "nowrap",
        ...style,
      }}
      onMouseEnter={(e) => { if (!disabled && kind !== "primary" && !active) e.currentTarget.style.background = "var(--hover)"; }}
      onMouseLeave={(e) => { if (!disabled && !active) e.currentTarget.style.background = k.bg; }}
    >
      {icon && <span style={{ color: active ? "var(--accent)" : "var(--fg-3)" }}>{icon}</span>}
      {children}
      {kbd && <KBD>{kbd}</KBD>}
    </button>
  );
}

function IconBtn({ icon, title, onClick, active }) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        width: 26, height: 26,
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        background: active ? "var(--accent-soft)" : "transparent",
        color: active ? "var(--accent)" : "var(--fg-2)",
        border: `1px solid ${active ? "var(--accent)" : "transparent"}`,
        borderRadius: 3,
        cursor: "pointer",
      }}
      onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = "var(--hover)"; }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = "transparent"; }}
    >
      {icon}
    </button>
  );
}

// ─── Icons (minimal line set, drawn primitively) ────────────────────────────
const I = {
  search:   <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.3"/><path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>,
  filter:   <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M2 3.5h12M4 8h8M6 12.5h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>,
  compare:  <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M8 1.5v13M3 4l-2 2 2 2M13 8l2 2-2 2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  pin:      <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M9.5 1.5l5 5M11 4l-5 1-3 3 5 5 3-3 1-5M2 14l3.5-3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  tag:      <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M2 2v6l6.5 6.5L14.5 8.5 8 2H2zM5 5.5h.01" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  trash:    <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M3 4h10M6 4V2.5h4V4M4.5 4l.5 9.5h6L11.5 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  download: <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M8 2v9M4 8l4 4 4-4M2.5 14h11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  copy:     <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><rect x="5" y="5" width="9" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.3"/><path d="M3.5 10.5V3a1 1 0 011-1H11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>,
  gear:     <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.3"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.5 1.5M11.5 11.5L13 13M3 13l1.5-1.5M11.5 4.5L13 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>,
  bolt:     <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M9 1L3 9h4l-1 6 6-8H8l1-6z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/></svg>,
  plus:     <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>,
  chevR:    <svg width="11" height="11" viewBox="0 0 16 16" fill="none"><path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  chevD:    <svg width="11" height="11" viewBox="0 0 16 16" fill="none"><path d="M3 6l5 5 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  chevL:    <svg width="11" height="11" viewBox="0 0 16 16" fill="none"><path d="M10 3l-5 5 5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  arrowR:   <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M2 8h12M9 3l5 5-5 5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  arrowLR:  <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M2 5h12M5 2L2 5l3 3M14 11H2M11 14l3-3-3-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  branch:   <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><circle cx="4" cy="3" r="1.5" stroke="currentColor" strokeWidth="1.3"/><circle cx="4" cy="13" r="1.5" stroke="currentColor" strokeWidth="1.3"/><circle cx="12" cy="6" r="1.5" stroke="currentColor" strokeWidth="1.3"/><path d="M4 4.5v7M4.5 9.5C8 9.5 10.5 8 10.5 7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>,
  list:     <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>,
  bars:     <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M3 13V8M7.5 13V4M12 13V10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>,
  cpu:      <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><rect x="3" y="3" width="10" height="10" rx="1" stroke="currentColor" strokeWidth="1.3"/><rect x="6" y="6" width="4" height="4" stroke="currentColor" strokeWidth="1.3"/><path d="M6 1v2M10 1v2M6 13v2M10 13v2M1 6h2M1 10h2M13 6h2M13 10h2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>,
  doc:      <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M3 1.5h7l3 3v10H3v-13z M10 1.5v3h3" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/></svg>,
  folder:   <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M2 4h4l1.5 1.5H14V13H2V4z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/></svg>,
  terminal: <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><rect x="1.5" y="2.5" width="13" height="11" rx="1" stroke="currentColor" strokeWidth="1.3"/><path d="M4 6l2.5 2L4 10M8 10.5h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  sun:      <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.3"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.5 1.5M11.5 11.5L13 13M3 13l1.5-1.5M11.5 4.5L13 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>,
  moon:     <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M13 9.5A6 6 0 016.5 3a5 5 0 105.5 8 6 6 0 011 -1.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/></svg>,
  question: <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.3"/><path d="M6 6.5a2 2 0 014 0c0 1.2-2 1.5-2 3M8 12h.01" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>,
  link:     <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M7 9l5-5a2.8 2.8 0 014 4l-3 3M9 7L4 12a2.8 2.8 0 01-4-4l3-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  swap:     <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M3 5h11M11 2l3 3-3 3M13 11H2M5 14l-3-3 3-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  dot3:     <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><circle cx="3" cy="8" r="1.3"/><circle cx="8" cy="8" r="1.3"/><circle cx="13" cy="8" r="1.3"/></svg>,
  stop:     <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><rect x="4" y="4" width="8" height="8" rx="1"/></svg>,
  brand:    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
    <path d="M2 14 L5 8 L8 11 L11 5 L14 9 L16 6" stroke="var(--accent)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="5" cy="8" r="1.2" fill="var(--accent)" />
    <circle cx="11" cy="5" r="1.2" fill="var(--accent)" />
    <circle cx="16" cy="6" r="1.2" fill="var(--accent)" />
  </svg>,
};

// ─── Charts: Sparkline + Line chart (canvas) ────────────────────────────────
function Sparkline({ series, width = 120, height = 22, color, fill, stroke = 1.4, baseline }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const c = ref.current;
    if (!c || !series || !series.length) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = width * dpr; c.height = height * dpr;
    const ctx = c.getContext("2d"); ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);
    const min = Math.min(...series);
    const max = Math.max(...series);
    const range = max - min || 1;
    const pad = 2;
    const xs = (i) => pad + (i / (series.length - 1)) * (width - 2 * pad);
    const ys = (v) => height - pad - ((v - min) / range) * (height - 2 * pad);

    const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#f59e0b";
    const lineColor = color || accent;

    if (fill) {
      ctx.beginPath();
      ctx.moveTo(xs(0), ys(series[0]));
      for (let i = 1; i < series.length; i++) ctx.lineTo(xs(i), ys(series[i]));
      ctx.lineTo(xs(series.length - 1), height - pad);
      ctx.lineTo(xs(0), height - pad);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
    }

    ctx.beginPath();
    ctx.lineWidth = stroke;
    ctx.strokeStyle = lineColor;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    for (let i = 0; i < series.length; i++) {
      const x = xs(i), y = ys(series[i]);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // last point dot
    const lx = xs(series.length - 1), ly = ys(series[series.length - 1]);
    ctx.fillStyle = lineColor;
    ctx.beginPath(); ctx.arc(lx, ly, 1.6, 0, Math.PI * 2); ctx.fill();

    if (baseline != null) {
      ctx.strokeStyle = "var(--fg-4)";
      ctx.setLineDash([2, 2]);
      const by = ys(baseline);
      ctx.beginPath();
      ctx.moveTo(pad, by); ctx.lineTo(width - pad, by);
      ctx.strokeStyle = "rgba(120,120,120,0.35)";
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }, [series, width, height, color, fill, stroke, baseline]);

  return <canvas ref={ref} style={{ width, height, display: "block" }} />;
}

function LineChart({ series, height = 220, color, label, smoothing = 0, yLog = false, overlay, baseline, xLabel = "step", showGrid = true, compact = false, fill = true }) {
  const wrapRef = useRef(null);
  const canRef = useRef(null);
  const [hover, setHover] = useState(null);
  const [w, setW] = useState(600);

  useLayoutEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setW(Math.max(120, Math.floor(r.width)));
    });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  // Convert one or many series to a unified list
  const all = useMemo(() => {
    const list = overlay && overlay.length ? overlay : (series ? [{ data: series, color, label }] : []);
    // apply smoothing (EMA)
    return list.map((s) => {
      if (!smoothing) return s;
      const a = smoothing;
      const sm = [];
      let prev = s.data[0];
      for (let i = 0; i < s.data.length; i++) {
        prev = prev * a + s.data[i] * (1 - a);
        sm.push(prev);
      }
      return { ...s, smoothed: sm };
    });
  }, [series, overlay, color, label, smoothing]);

  useLayoutEffect(() => {
    const c = canRef.current;
    if (!c || !all.length) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = w * dpr; c.height = height * dpr;
    const ctx = c.getContext("2d"); ctx.scale(dpr, dpr);

    const css = getComputedStyle(document.documentElement);
    const fg4 = css.getPropertyValue("--fg-4").trim() || "#666";
    const fg3 = css.getPropertyValue("--fg-3").trim() || "#888";
    const border = css.getPropertyValue("--border").trim() || "#222";
    const accent = css.getPropertyValue("--accent").trim() || "#f59e0b";

    const padL = compact ? 36 : 44, padR = 10, padT = 8, padB = compact ? 18 : 22;
    const pw = w - padL - padR;
    const ph = height - padT - padB;

    // compute ranges
    let lo = Infinity, hi = -Infinity, maxLen = 0;
    for (const s of all) {
      for (const v of s.data) {
        if (yLog) {
          const lv = Math.log10(Math.max(v, 1e-9));
          if (lv < lo) lo = lv; if (lv > hi) hi = lv;
        } else {
          if (v < lo) lo = v; if (v > hi) hi = v;
        }
      }
      if (s.data.length > maxLen) maxLen = s.data.length;
    }
    if (lo === hi) { lo -= 0.5; hi += 0.5; }
    const yPad = (hi - lo) * 0.08;
    lo -= yPad; hi += yPad;

    const xs = (i) => padL + (i / (maxLen - 1)) * pw;
    const ys = (v) => {
      const vv = yLog ? Math.log10(Math.max(v, 1e-9)) : v;
      return padT + (1 - (vv - lo) / (hi - lo)) * ph;
    };

    ctx.clearRect(0, 0, w, height);

    // grid
    if (showGrid) {
      ctx.strokeStyle = border + "aa";
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 3]);
      const yTicks = 4;
      ctx.fillStyle = fg4;
      ctx.font = `10px var(--mono)`;
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      for (let i = 0; i <= yTicks; i++) {
        const t = i / yTicks;
        const y = padT + t * ph;
        ctx.beginPath();
        ctx.moveTo(padL, y); ctx.lineTo(w - padR, y);
        ctx.stroke();
        const val = hi - t * (hi - lo);
        const lbl = yLog ? Math.pow(10, val).toExponential(0) : (Math.abs(val) >= 1 ? val.toFixed(2) : val.toFixed(3));
        ctx.fillText(lbl, padL - 6, y);
      }
      ctx.setLineDash([]);

      // x ticks
      ctx.textAlign = "center"; ctx.textBaseline = "top";
      const xTicks = 5;
      for (let i = 0; i <= xTicks; i++) {
        const t = i / xTicks;
        const x = padL + t * pw;
        const v = Math.round(t * (maxLen - 1));
        ctx.fillText(String(v), x, height - padB + 4);
      }
    }

    if (baseline != null) {
      ctx.strokeStyle = fg4 + "66";
      ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(padL, ys(baseline)); ctx.lineTo(w - padR, ys(baseline)); ctx.stroke();
      ctx.setLineDash([]);
    }

    // lines
    all.forEach((s, idx) => {
      const data = s.smoothed || s.data;
      const lineColor = s.color || (idx === 0 ? accent : ["#38bdf8", "#a78bfa", "#4ade80", "#f472b6"][idx % 4]);

      if (fill && all.length === 1) {
        ctx.beginPath();
        ctx.moveTo(xs(0), ys(data[0]));
        for (let i = 1; i < data.length; i++) ctx.lineTo(xs(i), ys(data[i]));
        ctx.lineTo(xs(data.length - 1), padT + ph);
        ctx.lineTo(xs(0), padT + ph);
        ctx.closePath();
        const grad = ctx.createLinearGradient(0, padT, 0, padT + ph);
        grad.addColorStop(0, lineColor + "33");
        grad.addColorStop(1, lineColor + "00");
        ctx.fillStyle = grad;
        ctx.fill();
      }

      ctx.beginPath();
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = 1.6;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      for (let i = 0; i < data.length; i++) {
        const x = xs(i), y = ys(data[i]);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();

      // raw underlay if smoothing
      if (s.smoothed) {
        ctx.beginPath();
        ctx.strokeStyle = lineColor + "55";
        ctx.lineWidth = 1;
        for (let i = 0; i < s.data.length; i++) {
          const x = xs(i), y = ys(s.data[i]);
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    });

    // crosshair
    if (hover) {
      const x = hover.x;
      const i = Math.round(((x - padL) / pw) * (maxLen - 1));
      if (i >= 0 && i < maxLen) {
        const cx = xs(i);
        ctx.strokeStyle = fg3 + "aa";
        ctx.setLineDash([2, 2]);
        ctx.beginPath(); ctx.moveTo(cx, padT); ctx.lineTo(cx, padT + ph); ctx.stroke();
        ctx.setLineDash([]);
        all.forEach((s, idx) => {
          const lineColor = s.color || (idx === 0 ? accent : ["#38bdf8", "#a78bfa", "#4ade80"][idx % 3]);
          const v = (s.smoothed || s.data)[i];
          if (v == null) return;
          ctx.fillStyle = lineColor;
          ctx.beginPath(); ctx.arc(cx, ys(v), 3, 0, Math.PI * 2); ctx.fill();
        });
      }
    }
  }, [all, w, height, yLog, hover, baseline, showGrid, compact, fill]);

  // hover label content
  const hoverInfo = useMemo(() => {
    if (!hover || !all.length) return null;
    const padL = compact ? 36 : 44, padR = 10;
    const pw = w - padL - padR;
    const maxLen = Math.max(...all.map(s => s.data.length));
    const i = Math.round(((hover.x - padL) / pw) * (maxLen - 1));
    if (i < 0 || i >= maxLen) return null;
    return {
      step: i,
      values: all.map((s, idx) => ({
        label: s.label || `series${idx}`,
        color: s.color || (idx === 0 ? "var(--accent)" : ["#38bdf8", "#a78bfa", "#4ade80"][idx % 3]),
        value: (s.smoothed || s.data)[i],
      })),
    };
  }, [hover, all, w, compact]);

  return (
    <div ref={wrapRef} style={{ position: "relative", width: "100%", height }}>
      <canvas
        ref={canRef}
        style={{ width: "100%", height: "100%", display: "block" }}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setHover({ x: e.clientX - r.left, y: e.clientY - r.top });
        }}
        onMouseLeave={() => setHover(null)}
      />
      {hoverInfo && (
        <div style={{
          position: "absolute",
          top: 6,
          right: 12,
          background: "var(--surface-2)",
          border: "1px solid var(--border-2)",
          borderRadius: 3,
          padding: "5px 8px",
          fontFamily: "var(--mono)", fontSize: 11,
          pointerEvents: "none",
          color: "var(--fg-2)",
        }}>
          <div style={{ color: "var(--fg-4)", fontSize: 10 }}>step {hoverInfo.step}</div>
          {hoverInfo.values.map((v, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 8, height: 2, background: v.color, display: "inline-block" }} />
              <span style={{ color: "var(--fg-3)" }}>{v.label}</span>
              <span style={{ color: "var(--fg)" }}>{fmtNum(v.value, 4)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Inputs: Select, Text, Slider, Toggle ───────────────────────────────────
function Select({ value, onChange, options, width, icon }) {
  return (
    <div style={{
      display: "inline-flex", alignItems: "center",
      height: 26, padding: "0 6px 0 8px",
      width,
      background: "var(--surface-2)",
      border: "1px solid var(--border-2)",
      borderRadius: 3,
      color: "var(--fg)",
      fontFamily: "var(--mono)", fontSize: 12,
      gap: 6, cursor: "pointer", position: "relative",
    }}>
      {icon && <span style={{ color: "var(--fg-3)" }}>{icon}</span>}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          appearance: "none", WebkitAppearance: "none",
          background: "transparent", border: "none", outline: "none",
          color: "inherit", fontFamily: "inherit", fontSize: "inherit",
          paddingRight: 14, cursor: "pointer", flex: 1,
        }}
      >
        {options.map((o) => <option key={o.value || o} value={o.value || o}>{o.label || o}</option>)}
      </select>
      <span style={{ color: "var(--fg-3)", position: "absolute", right: 6, pointerEvents: "none" }}>{I.chevD}</span>
    </div>
  );
}

function TextInput({ value, onChange, placeholder, icon, kbd, width, autoFocus, onKeyDown }) {
  return (
    <div style={{
      display: "inline-flex", alignItems: "center",
      height: 26, padding: "0 8px",
      width,
      background: "var(--surface-2)",
      border: "1px solid var(--border-2)",
      borderRadius: 3,
      gap: 6,
    }}>
      {icon && <span style={{ color: "var(--fg-3)" }}>{icon}</span>}
      <input
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        style={{
          flex: 1, background: "transparent", border: "none", outline: "none",
          color: "inherit", fontFamily: "inherit", fontSize: 12, minWidth: 0,
        }}
      />
      {kbd && <KBD>{kbd}</KBD>}
    </div>
  );
}

function Checkbox({ checked, onChange, indeterminate }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onChange(!checked); }}
      style={{
        width: 14, height: 14, padding: 0,
        background: checked ? "var(--accent)" : "var(--surface-2)",
        border: `1px solid ${checked ? "var(--accent)" : "var(--border-strong)"}`,
        borderRadius: 2,
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        flex: "0 0 14px",
      }}
    >
      {checked && !indeterminate && <svg width="9" height="9" viewBox="0 0 10 10"><path d="M1.5 5.2L4 7.6L8.5 2.5" stroke="#1c1408" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>}
      {indeterminate && <span style={{ width: 6, height: 1.5, background: "var(--fg-3)" }} />}
    </button>
  );
}

function Slider({ value, min = 0, max = 1, step = 0.01, onChange, width = 100 }) {
  return (
    <input
      type="range" min={min} max={max} step={step} value={value}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      style={{
        width, height: 4, accentColor: "var(--accent)", verticalAlign: "middle",
      }}
    />
  );
}

// ─── Layout helpers ─────────────────────────────────────────────────────────
function Panel({ children, title, action, padding = 14, style }) {
  return (
    <div style={{
      background: "var(--surface)",
      border: "1px solid var(--border)",
      borderRadius: 4,
      overflow: "hidden",
      ...style,
    }}>
      {title && (
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "8px 12px",
          borderBottom: "1px solid var(--border)",
          background: "var(--surface-2)",
          fontFamily: "var(--mono)", fontSize: 11, color: "var(--fg-3)",
          textTransform: "uppercase", letterSpacing: 0.6,
        }}>
          <span>{title}</span>
          {action}
        </div>
      )}
      <div style={{ padding }}>{children}</div>
    </div>
  );
}

function Stat({ label, value, sub, color, mono = true }) {
  return (
    <div style={{
      padding: "10px 14px",
      borderRight: "1px solid var(--border)",
      minWidth: 120,
    }}>
      <div style={{ fontSize: 10, color: "var(--fg-4)", textTransform: "uppercase", letterSpacing: 0.6, fontFamily: "var(--mono)" }}>{label}</div>
      <div style={{ fontFamily: mono ? "var(--mono)" : "var(--sans)", fontSize: 20, fontWeight: 600, color: color || "var(--fg)", marginTop: 2 }}>{value}</div>
      {sub && <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--fg-3)", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

// ─── Toaster (tiny) ─────────────────────────────────────────────────────────
const Toast = {
  _list: [],
  _set: null,
  show(msg) {
    const id = Math.random().toString(36).slice(2);
    Toast._list = [...Toast._list, { id, msg }];
    Toast._set && Toast._set(Toast._list);
    setTimeout(() => {
      Toast._list = Toast._list.filter(t => t.id !== id);
      Toast._set && Toast._set(Toast._list);
    }, 2200);
  },
};
function Toaster() {
  const [list, setList] = useState([]);
  useEffect(() => { Toast._set = setList; return () => { Toast._set = null; }; }, []);
  return (
    <div style={{
      position: "fixed", bottom: 32, left: "50%", transform: "translateX(-50%)",
      display: "flex", flexDirection: "column-reverse", gap: 6, pointerEvents: "none",
      zIndex: 1000,
    }}>
      {list.map(t => (
        <div key={t.id} style={{
          background: "var(--surface-3)", border: "1px solid var(--border-2)",
          padding: "6px 12px", borderRadius: 3, fontFamily: "var(--mono)", fontSize: 12,
          color: "var(--fg)", boxShadow: "var(--shadow)",
        }}>{t.msg}</div>
      ))}
    </div>
  );
}

// ─── Global animations ──────────────────────────────────────────────────────
const GLOBAL_CSS = `
@keyframes rtPulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50%      { opacity: 0.4; transform: scale(0.92); }
}
@keyframes rtSpin { to { transform: rotate(360deg); } }
.row-hover:hover { background: var(--hover) !important; }
.row-hover:hover .row-actions { opacity: 1 !important; }
.linkish { color: var(--fg); cursor: pointer; }
.linkish:hover { color: var(--accent); text-decoration: underline; }
`;

// Export to window
Object.assign(window, {
  fmtDuration, fmtBytes, fmtNum, fmtPct, fmtTime, relTime,
  StatusDot, StatusBadge, Tag, KBD, Btn, IconBtn, I,
  Sparkline, LineChart,
  Select, TextInput, Checkbox, Slider,
  Panel, Stat, Toast, Toaster, GLOBAL_CSS,
  STATUS_COLOR,
});
