import { useEffect, useRef } from 'react'

export interface Series {
  name: string
  color: string
  values: Array<{ x: number; y: number }>
}

// ─── Sparkline (compact, no axes) ───────────────────────────────────────────

export function Sparkline({
  values,
  width = 80,
  height = 22,
  color = 'var(--accent)',
}: {
  values: number[]
  width?: number
  height?: number
  color?: string
}) {
  if (!values.length) return <span style={{ color: 'var(--fg-4)', fontSize: 10 }}>—</span>
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const stepX = values.length > 1 ? width / (values.length - 1) : width
  const pts = values
    .map((v, i) => `${i * stepX},${height - ((v - min) / range) * height}`)
    .join(' ')
  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.25} />
    </svg>
  )
}

// ─── LineChart with axes, grid, hover crosshair ─────────────────────────────

export function LineChart({
  series,
  width = 480,
  height = 220,
  xLabel = 'step',
}: {
  series: Series[]
  width?: number
  height?: number
  xLabel?: string
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const hoverRef = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    const c = ref.current
    if (!c) return
    const dpr = window.devicePixelRatio || 1
    c.width = width * dpr
    c.height = height * dpr
    c.style.width = width + 'px'
    c.style.height = height + 'px'
    const ctx = c.getContext('2d')
    if (!ctx) return
    ctx.scale(dpr, dpr)

    draw(ctx, width, height, series, xLabel, hoverRef.current)

    const onMove = (e: MouseEvent) => {
      const r = c.getBoundingClientRect()
      hoverRef.current = { x: e.clientX - r.left, y: e.clientY - r.top }
      ctx.clearRect(0, 0, width, height)
      draw(ctx, width, height, series, xLabel, hoverRef.current)
    }
    const onLeave = () => {
      hoverRef.current = null
      ctx.clearRect(0, 0, width, height)
      draw(ctx, width, height, series, xLabel, null)
    }
    c.addEventListener('mousemove', onMove)
    c.addEventListener('mouseleave', onLeave)
    return () => {
      c.removeEventListener('mousemove', onMove)
      c.removeEventListener('mouseleave', onLeave)
    }
  }, [series, width, height, xLabel])

  return <canvas ref={ref} style={{ display: 'block' }} />
}

function draw(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  series: Series[],
  xLabel: string,
  hover: { x: number; y: number } | null,
) {
  const PAD = { l: 44, r: 12, t: 10, b: 24 }
  const w = width - PAD.l - PAD.r
  const h = height - PAD.t - PAD.b

  let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity
  for (const s of series) {
    for (const p of s.values) {
      if (p.x < xMin) xMin = p.x
      if (p.x > xMax) xMax = p.x
      if (p.y < yMin) yMin = p.y
      if (p.y > yMax) yMax = p.y
    }
  }
  if (!Number.isFinite(xMin)) {
    ctx.fillStyle = '#888'
    ctx.font = '11px JetBrains Mono, monospace'
    ctx.fillText('no data', PAD.l + 8, PAD.t + 14)
    return
  }
  if (xMin === xMax) xMax = xMin + 1
  if (yMin === yMax) {
    yMax = yMin + 1
    yMin = yMin - 1
  }

  const xs = (x: number) => PAD.l + ((x - xMin) / (xMax - xMin)) * w
  const ys = (y: number) => PAD.t + h - ((y - yMin) / (yMax - yMin)) * h

  // Grid lines.
  ctx.strokeStyle = 'rgba(127,127,127,0.18)'
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let i = 0; i <= 4; i++) {
    const y = PAD.t + (i * h) / 4
    ctx.moveTo(PAD.l, y)
    ctx.lineTo(PAD.l + w, y)
  }
  ctx.stroke()

  // Axis labels.
  ctx.fillStyle = '#888'
  ctx.font = '10px JetBrains Mono, monospace'
  ctx.textAlign = 'right'
  for (let i = 0; i <= 4; i++) {
    const v = yMax - (i * (yMax - yMin)) / 4
    ctx.fillText(formatNum(v), PAD.l - 4, PAD.t + (i * h) / 4 + 3)
  }
  ctx.textAlign = 'center'
  ctx.fillText(String(Math.round(xMin)), PAD.l, PAD.t + h + 14)
  ctx.fillText(String(Math.round(xMax)), PAD.l + w, PAD.t + h + 14)
  ctx.textAlign = 'left'
  ctx.fillText(xLabel, PAD.l + w / 2 - 10, PAD.t + h + 14)

  // Lines.
  for (const s of series) {
    if (!s.values.length) continue
    ctx.strokeStyle = s.color
    ctx.lineWidth = 1.5
    ctx.beginPath()
    s.values.forEach((p, i) => {
      const x = xs(p.x), y = ys(p.y)
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    ctx.stroke()
  }

  // Hover crosshair + tooltip.
  if (hover && hover.x >= PAD.l && hover.x <= PAD.l + w) {
    ctx.strokeStyle = 'rgba(127,127,127,0.5)'
    ctx.beginPath()
    ctx.moveTo(hover.x, PAD.t)
    ctx.lineTo(hover.x, PAD.t + h)
    ctx.stroke()
    const xVal = xMin + ((hover.x - PAD.l) / w) * (xMax - xMin)
    let label = `${xLabel}=${Math.round(xVal)}`
    for (const s of series) {
      if (!s.values.length) continue
      let nearest = s.values[0]
      let best = Math.abs(nearest.x - xVal)
      for (const p of s.values) {
        const d = Math.abs(p.x - xVal)
        if (d < best) {
          best = d
          nearest = p
        }
      }
      label += `  ${s.name}=${formatNum(nearest.y)}`
    }
    ctx.fillStyle = 'rgba(0,0,0,0.7)'
    ctx.fillRect(PAD.l + 4, PAD.t + 2, label.length * 6.2 + 8, 16)
    ctx.fillStyle = '#fff'
    ctx.fillText(label, PAD.l + 8, PAD.t + 13)
  }
}

function formatNum(v: number): string {
  if (!Number.isFinite(v)) return '—'
  const a = Math.abs(v)
  if (a >= 1000 || (a < 0.01 && a > 0)) return v.toExponential(1)
  return v.toFixed(a < 1 ? 3 : 2)
}

// Palette for assigning colors to series by index.
export const PALETTE = [
  'var(--accent)',
  'var(--info)',
  'var(--success)',
  'var(--purple)',
  'var(--danger)',
  'var(--warn)',
]
