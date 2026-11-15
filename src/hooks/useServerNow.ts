import { useEffect, useRef, useState } from 'react'
import { API_BASE_URL } from '@/lib/config'
import { ServerClock } from '@/lib/executionTiming'

export function useServerNow(active: boolean): number | null {
  const clock = useRef(new ServerClock())
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => {
    if (!active) return
    let disposed = false
    const controller = new AbortController()
    const tick = () => setNow(clock.current.now(performance.now()))
    const sync = async () => {
      const sent = performance.now()
      try {
        const response = await fetch(`${API_BASE_URL}/api/time`, { cache: 'no-store', signal: controller.signal })
        if (!response.ok) return
        const data = await response.json() as { server_time?: string }
        const received = performance.now()
        if (!disposed && data.server_time) {
          clock.current.sample(data.server_time, sent, received)
          tick()
        }
      } catch { /* Preserve the last server clock during temporary disconnects. */ }
    }
    void sync()
    const ticker = window.setInterval(tick, 1000)
    const refresh = window.setInterval(() => { void sync() }, 30000)
    return () => { disposed = true; controller.abort(); window.clearInterval(ticker); window.clearInterval(refresh) }
  }, [active])
  return now
}
