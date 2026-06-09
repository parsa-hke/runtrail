import { useEffect, useState } from 'react'

export interface Route {
  segs: string[]
  query: Record<string, string>
  hash: string
}

export function parseHash(h: string): Route {
  const raw = (h || '').replace(/^#/, '') || '/'
  const [path, qs] = raw.split('?')
  const segs = path.split('/').filter(Boolean)
  const query: Record<string, string> = {}
  ;(qs || '').split('&').filter(Boolean).forEach((p) => {
    const [k, v] = p.split('=')
    query[decodeURIComponent(k)] = decodeURIComponent(v || '')
  })
  return { segs, query, hash: raw }
}

export function useRoute(): Route {
  const [hash, setHash] = useState(window.location.hash || '#/')
  useEffect(() => {
    const onHash = () => setHash(window.location.hash || '#/')
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  return parseHash(hash)
}

export function navigate(target: string): void {
  window.location.hash = target.startsWith('#') ? target : '#' + target
}
