// Types mirror internal/domain/domain.go.

export type RunStatus = 'running' | 'done' | 'failed' | 'killed'

export interface Run {
  id: string
  project_id: string
  name: string
  status: RunStatus
  started_at: string
  ended_at?: string | null
  duration_s: number
  user?: string
  host?: string
  pid?: number
  branch?: string
  commit?: string
  dirty: boolean
  cmd?: string
  exit_code: number
  error?: string
  notes?: string
  pinned: boolean
  tags: string[]
  hparams: Record<string, unknown>
  final: Record<string, number>
  hardware?: Record<string, unknown>
  env?: Record<string, unknown>
  dataset?: string
  dataset_hash?: string
}

export interface Project {
  id: string
  name: string
  path?: string
  description?: string
  default_tags: string[]
  baselines: string[]
}

export interface Artifact {
  name: string
  type: string
  size_bytes: number
  sha256: string
  created_at: string
}

export interface Pkg {
  name: string
  version: string
}

export interface MetricRow {
  step: number
  wall_ms: number
  values: Record<string, number>
}

export interface ResourceSample {
  wall_ms: number
  cpu_pct?: number
  ram_pct?: number
  ram_used_bytes?: number
  gpu_count?: number
  gpus?: Array<{ util?: number; mem_pct?: number; mem_used_bytes?: number; temp_c?: number }>
  disk_read_bps?: number
  disk_write_bps?: number
  [k: string]: unknown
}

export interface EventRow {
  wall_ms: number
  level: 'info' | 'warn' | 'error' | string
  message: string
}

// ── Diff types ────────────────────────────────────────────────────────────────

export interface HParamDiff {
  changed: Record<string, (unknown | null)[]>
  same: Record<string, unknown>
  only_in: Record<string, number[]>
}

export interface MetricSummaryRow {
  name: string
  values: number[]   // NaN encoded as null from Go
  best_idx: number   // -1 if tied/unknown
  delta: number
  delta_pct: number
  higher_better: boolean
}

export interface MetricsDiff {
  winner: 'A' | 'B' | 'tie' | ''
  rows: MetricSummaryRow[]
}

export interface EnvDiff {
  changed: Record<string, string[]>
  same: Record<string, string>
}

export interface HardwareDiff {
  changed: Record<string, string[]>
  same: Record<string, string>
}

export interface DataDiff {
  same: boolean
  same_hash: boolean
  values: string[]
  hashes: string[]
}

export interface Insight {
  winner: 'A' | 'B' | 'tie' | ''
  delta_metric: string
  delta_value: number
  delta_pct: number
  likely: string[]
  confidence: number
}

export interface DiffReport {
  runs: Run[]
  hparams: HParamDiff
  metrics: MetricsDiff
  env: EnvDiff
  hardware: HardwareDiff
  data: DataDiff
  insight: Insight
}
