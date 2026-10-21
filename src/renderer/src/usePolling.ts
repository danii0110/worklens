import { useEffect } from 'react'

export function usePolling(callback: () => void, intervalMs: number, enabled = true): void {
  useEffect(() => {
    if (!enabled) return
    Promise.resolve().then(callback)
    const interval = setInterval(callback, intervalMs)
    return () => clearInterval(interval)
  }, [callback, intervalMs, enabled])
}
