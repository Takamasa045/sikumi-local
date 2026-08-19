import { useEffect, useRef, useState } from 'react'
import { travelDurationMs, type GardenPoint } from './motion'

export function useStationTravel(
  target: GardenPoint,
  reducedMotion: boolean,
): {
  readonly point: GardenPoint
  readonly traveling: boolean
  readonly durationMs: number
} {
  const previous = useRef(target)
  const [point, setPoint] = useState(target)
  const [traveling, setTraveling] = useState(false)
  const [durationMs, setDurationMs] = useState(0)
  const first = useRef(true)

  useEffect(() => {
    const from = previous.current
    previous.current = target

    if (first.current) {
      first.current = false
      setPoint(target)
      setTraveling(false)
      setDurationMs(0)
      return
    }

    if (reducedMotion) {
      setPoint(target)
      setTraveling(false)
      setDurationMs(0)
      return
    }

    const nextDuration = travelDurationMs(from, target)
    setPoint(target)
    setDurationMs(nextDuration)
    if (nextDuration === 0) {
      setTraveling(false)
      return
    }

    setTraveling(true)
    const timer = window.setTimeout(() => {
      setTraveling(false)
    }, nextDuration)
    return () => {
      window.clearTimeout(timer)
    }
  }, [reducedMotion, target.x, target.y])

  return { point, traveling, durationMs }
}
