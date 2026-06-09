import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import { Btn, Empty, KV, Panel, Tag } from '../components/atoms'

export default function SettingsPage() {
  const queryClient = useQueryClient()
  const { data: health } = useQuery({
    queryKey: ['health'],
    queryFn: () => api.health(),
  })
  const mutationsEnabled = health?.mutations ?? false

  const { data: projects = [], isLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.listProjects(),
  })

  if (isLoading) return <Empty title="Loading…" />
  if (!projects.length) return <Empty title="No projects yet" hint="Start a run to create one." />

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
      {projects.map((p) => (
        <ProjectPanel key={p.id} project={p} mutationsEnabled={mutationsEnabled} queryClient={queryClient} />
      ))}

      <Panel title="About">
        <KV k="api" v={<a href="/api/v1/health" style={{ color: 'var(--info)' }}>/api/v1/health</a>} />
        <KV k="mutations" v={mutationsEnabled ? 'enabled' : 'enable with `runtrail ui --mutations`'} />
        <KV k="docs" v={<a href="https://github.com/parsa-hke/runtrail" style={{ color: 'var(--info)' }}>github.com/parsa-hke/runtrail</a>} />
      </Panel>
    </div>
  )
}

function ProjectPanel({
  project,
  mutationsEnabled,
  queryClient,
}: {
  project: import('../api/types').Project
  mutationsEnabled: boolean
  queryClient: any
}) {
  const [isEditingDesc, setIsEditingDesc] = useState(false)
  const [descText, setDescText] = useState(project.description || '')
  const [newTag, setNewTag] = useState('')
  const [newBaseline, setNewBaseline] = useState('')

  const handlePatch = async (patch: any) => {
    try {
      await api.patchProject(project.id, patch)
      queryClient.invalidateQueries({ queryKey: ['projects'] })
    } catch (e: any) {
      alert(e.message)
    }
  }

  const saveDesc = () => {
    handlePatch({ description: descText })
    setIsEditingDesc(false)
  }

  const removeTag = (tagToRemove: string) => {
    const nextTags = project.default_tags.filter((t) => t !== tagToRemove)
    handlePatch({ default_tags: nextTags })
  }

  const addTag = () => {
    const tag = newTag.trim()
    if (!tag) return
    if (project.default_tags.includes(tag)) {
      setNewTag('')
      return
    }
    const nextTags = [...project.default_tags, tag]
    handlePatch({ default_tags: nextTags })
    setNewTag('')
  }

  const removeBaseline = (runId: string) => {
    const nextBaselines = project.baselines.filter((id) => id !== runId)
    handlePatch({ baselines: nextBaselines })
  }

  const addBaseline = () => {
    const runId = newBaseline.trim()
    if (!runId) return
    if (project.baselines.includes(runId)) {
      setNewBaseline('')
      return
    }
    const nextBaselines = [...project.baselines, runId]
    handlePatch({ baselines: nextBaselines })
    setNewBaseline('')
  }

  return (
    <Panel title={project.name}>
      <KV k="id" v={project.id} />
      {project.path && <KV k="path" v={project.path} />}
      
      <KV
        k="description"
        v={
          isEditingDesc ? (
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                value={descText}
                onChange={(e) => setDescText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && saveDesc()}
                style={{
                  flex: 1,
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 3,
                  color: 'var(--fg)',
                  fontFamily: 'var(--mono)',
                  fontSize: 11,
                  padding: '2px 6px',
                }}
              />
              <Btn variant="accent" onClick={saveDesc}>Save</Btn>
              <Btn variant="default" onClick={() => setIsEditingDesc(false)}>Cancel</Btn>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>{project.description || '—'}</span>
              {mutationsEnabled && (
                <Btn variant="default" onClick={() => setIsEditingDesc(true)} style={{ padding: '2px 6px', fontSize: 10 }}>
                  Edit
                </Btn>
              )}
            </div>
          )
        }
      />

      <KV
        k="default tags"
        v={
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4 }}>
            {project.default_tags.map((t) => (
              <Tag key={t}>
                {t}
                {mutationsEnabled && (
                  <span
                    onClick={(e) => {
                      e.stopPropagation()
                      removeTag(t)
                    }}
                    style={{
                      marginLeft: 6,
                      cursor: 'pointer',
                      color: 'var(--danger)',
                      fontWeight: 'bold',
                    }}
                  >
                    ×
                  </span>
                )}
              </Tag>
            ))}
            {mutationsEnabled && (
              <div style={{ display: 'flex', gap: 4, marginLeft: 4 }}>
                <input
                  placeholder="add tag…"
                  value={newTag}
                  onChange={(e) => setNewTag(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addTag()}
                  style={{
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderRadius: 3,
                    color: 'var(--fg)',
                    fontFamily: 'var(--mono)',
                    fontSize: 10,
                    padding: '1px 6px',
                    width: 80,
                  }}
                />
                <Btn variant="default" onClick={addTag} style={{ padding: '1px 6px', fontSize: 10 }}>
                  +
                </Btn>
              </div>
            )}
            {!project.default_tags.length && !mutationsEnabled && '—'}
          </div>
        }
      />

      <KV
        k="baselines"
        v={
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4 }}>
            {project.baselines.map((id) => (
              <div key={id} style={{ display: 'inline-flex', alignItems: 'center', background: 'var(--surface-2)', border: '1px solid var(--border-2)', borderRadius: 3, padding: '1px 7px', marginRight: 4 }}>
                <a
                  href={`#/runs/${id}`}
                  style={{ color: 'var(--accent)', fontFamily: 'var(--mono)', fontSize: 11, textDecoration: 'none' }}
                >
                  {id}
                </a>
                {mutationsEnabled && (
                  <span
                    onClick={(e) => {
                      e.stopPropagation()
                      removeBaseline(id)
                    }}
                    style={{
                      marginLeft: 6,
                      cursor: 'pointer',
                      color: 'var(--danger)',
                      fontWeight: 'bold',
                      fontSize: 10,
                    }}
                  >
                    ×
                  </span>
                )}
              </div>
            ))}
            {mutationsEnabled && (
              <div style={{ display: 'flex', gap: 4, marginLeft: 4 }}>
                <input
                  placeholder="add run-id…"
                  value={newBaseline}
                  onChange={(e) => setNewBaseline(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addBaseline()}
                  style={{
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderRadius: 3,
                    color: 'var(--fg)',
                    fontFamily: 'var(--mono)',
                    fontSize: 10,
                    padding: '1px 6px',
                    width: 100,
                  }}
                />
                <Btn variant="default" onClick={addBaseline} style={{ padding: '1px 6px', fontSize: 10 }}>
                  +
                </Btn>
              </div>
            )}
            {!project.baselines.length && !mutationsEnabled && '—'}
          </div>
        }
      />
    </Panel>
  )
}
