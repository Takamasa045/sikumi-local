import { useEffect, useState } from 'react'
import { readPrefersReducedMotion, reducedMotionQuery } from './motion'

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(readPrefersReducedMotion)

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') {
      return
    }
    const media = window.matchMedia(reducedMotionQuery())
    const onChange = () => {
      setReduced(media.matches)
    }
    onChange()
    media.addEventListener('change', onChange)
    return () => {
      media.removeEventListener('change', onChange)
    }
  }, [])

  return reduced
}
