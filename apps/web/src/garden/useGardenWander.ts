import { useEffect, useState } from 'react'
import type { GardenPoint } from './motion'

const WANDER_INTERVAL_MS = 2_600
const WANDER_RADIUS_MIN = 1.8
const WANDER_RADIUS_SPAN = 2.8

export function useGardenWander(
  home: GardenPoint,
  enabled: boolean,
  reducedMotion: boolean,
): GardenPoint {
  const [offset, setOffset] = useState<GardenPoint>({ x: 0, y: 0 })

  useEffect(() => {
    if (!enabled || reducedMotion) {
      setOffset({ x: 0, y: 0 })
      return
    }

    const step = () => {
      const angle = Math.random() * Math.PI * 2
      const radius = WANDER_RADIUS_MIN + Math.random() * WANDER_RADIUS_SPAN
      setOffset({
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius * 0.65,
      })
    }

    const timer = window.setInterval(step, WANDER_INTERVAL_MS)
    return () => {
      window.clearInterval(timer)
    }
  }, [enabled, reducedMotion, home.x, home.y])

  return {
    x: home.x + offset.x,
    y: home.y + offset.y,
  }
}
