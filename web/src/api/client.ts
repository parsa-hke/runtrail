import type { Artifact, DiffReport, EventRow, MetricRow, Pkg, Project, ResourceSample, Run } from './types'

const BASE = '/api/v1'

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    ...init,
  })
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`
    try {
      const body = (await res.json()) as { error?: { message?: string } }
      if (body?.error?.message) msg = body.error.message
    } catch {
      // body wasn't JSON; keep status text
    }
    throw new Error(msg)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export const api = {
  health: () => req<{ ok: boolean; version: string; mutations?: boolean }>('/health'),

  listProjects: () => req<Project[]>('/projects'),
  getProject: (id: string) => req<Project>(`/projects/${id}`),
  patchProject: (id: string, patch: { name?: string; description?: string; default_tags?: string[]; baselines?: string[] }) =>
    req<Project>(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),

  listRuns: (params: { project?: string; status?: string; tag?: string; limit?: number } = {}) => {
    const q = new URLSearchParams()
    if (params.project) q.set('project', params.project)
    if (params.status) q.set('status', params.status)
    if (params.tag) q.set('tag', params.tag)
    if (params.limit) q.set('limit', String(params.limit))
    return req<Run[]>(`/runs?${q.toString()}`)
  },

  getRun: (id: string) => req<{ run: Run; artifacts: Artifact[] }>(`/runs/${id}`),
  patchRun: (id: string, patch: { name?: string; notes?: string; tags?: string[]; pinned?: boolean }) =>
    req<Run>(`/runs/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteRun: (id: string) => req<{ ok: boolean }>(`/runs/${id}`, { method: 'DELETE' }),
  stopRun: (id: string) => req<{ ok: boolean }>(`/runs/${id}/stop`, { method: 'POST' }),

  getMetrics: (id: string, names?: string[]) => {
    const q = new URLSearchParams()
    if (names && names.length) q.set('names', names.join(','))
    return req<MetricRow[]>(`/runs/${id}/metrics?${q.toString()}`)
  },

  getResources: (id: string) => req<ResourceSample[]>(`/runs/${id}/resources`),
  getEvents: (id: string, since = 0) => req<EventRow[]>(`/runs/${id}/events?since=${since}`),
  getLogs: (id: string, stream: 'stdout' | 'stderr' = 'stdout', tail = 500) =>
    req<{ stream: string; lines: string[] }>(`/runs/${id}/logs?stream=${stream}&tail=${tail}`),

  listArtifacts: (id: string) => req<Artifact[]>(`/runs/${id}/artifacts`),
  artifactURL: (id: string, name: string) =>
    `${BASE}/runs/${id}/artifacts/${encodeURIComponent(name)}`,

  sourceTree: (id: string) => req<string[]>(`/runs/${id}/source/tree`),
  sourceFile: (id: string, path: string) =>
    req<{ path: string; content: string }>(`/runs/${id}/source/file?path=${encodeURIComponent(path)}`),

  listPackages: (id: string) => req<Pkg[]>(`/runs/${id}/packages`),

  diff: (ids: string[]) =>
    req<DiffReport>(`/diff?ids=${ids.join(',')}`),

  listSavedViews: (project?: string) => {
    const q = new URLSearchParams()
    if (project) q.set('project', project)
    return req<any[]>(`/views?${q.toString()}`)
  },
  saveView: (view: { id: string; project_id: string; name: string; query: string }) =>
    req<any>('/views', { method: 'POST', body: JSON.stringify(view) }),
  deleteView: (id: string, project?: string) => {
    const q = new URLSearchParams()
    if (project) q.set('project', project)
    return req<{ ok: boolean }>(`/views/${id}?${q.toString()}`, { method: 'DELETE' })
  },
}
