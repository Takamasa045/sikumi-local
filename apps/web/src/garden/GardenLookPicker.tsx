import { useEffect, useId, useRef, useState } from 'react'
import { preloadWorldPackAssets } from './worldAssetLoader'
import type { WorldPack, WorldPackId } from './worlds'

interface GardenLookPickerProps {
  readonly packs: readonly WorldPack[]
  readonly world: WorldPack
  readonly onSelect: (id: WorldPackId) => void
}

export function GardenLookPicker({
  packs,
  world,
  onSelect,
}: GardenLookPickerProps) {
  const [open, setOpen] = useState(false)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const menuId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) {
      return
    }
    function closeFromOutside(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    function closeFromEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false)
        toggleRef.current?.focus()
      }
    }
    document.addEventListener('pointerdown', closeFromOutside)
    document.addEventListener('keydown', closeFromEscape)
    return () => {
      document.removeEventListener('pointerdown', closeFromOutside)
      document.removeEventListener('keydown', closeFromEscape)
    }
  }, [open])

  async function choose(pack: WorldPack) {
    if (pack.id === world.id) {
      setOpen(false)
      toggleRef.current?.focus()
      return
    }
    setError(null)
    setPendingId(pack.id)
    try {
      await preloadWorldPackAssets(pack)
      onSelect(pack.id)
      setOpen(false)
      toggleRef.current?.focus()
    } catch {
      setError('庭の画像を読み込めませんでした。もう一度お試しください。')
    } finally {
      setPendingId(null)
    }
  }

  function warm(pack: WorldPack) {
    if (pack.id !== world.id) {
      void preloadWorldPackAssets(pack).catch(() => undefined)
    }
  }

  return (
    <div
      className="observer-garden-look"
      data-testid="garden-look"
      ref={rootRef}
    >
      <button
        ref={toggleRef}
        type="button"
        className="observer-garden-look-toggle"
        aria-label={`庭の見た目：${world.lookName}`}
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => {
          setError(null)
          setOpen((current) => !current)
        }}
      >
        <span className="observer-garden-look-toggle-label">庭の見た目</span>
        <strong>{world.lookName}</strong>
        <span className="observer-garden-look-toggle-icon" aria-hidden="true">
          ▾
        </span>
      </button>

      {open ? (
        <div
          id={menuId}
          className="observer-garden-look-menu"
          role="group"
          aria-label="庭を選ぶ"
        >
          {packs.map((pack) => {
            const pending = pendingId === pack.id
            return (
              <button
                key={pack.id}
                type="button"
                className="observer-garden-look-button"
                aria-label={pending ? `${pack.lookName}を読み込み中` : undefined}
                aria-pressed={world.id === pack.id}
                disabled={pendingId !== null}
                onPointerEnter={() => warm(pack)}
                onFocus={() => warm(pack)}
                onClick={() => void choose(pack)}
              >
                <span>{pack.lookName}</span>
                {pending ? <span aria-hidden="true">読み込み中…</span> : null}
              </button>
            )
          })}
        </div>
      ) : null}

      {error ? (
        <p className="observer-garden-look-error" role="status">
          {error}
        </p>
      ) : null}
    </div>
  )
}
