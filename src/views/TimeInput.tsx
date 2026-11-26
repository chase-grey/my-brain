import { useState } from 'react'
import { duration, parseDuration } from '../format'

/**
 * A length of time, typed: "45", "2h", "1h 30m". Words that are not a length keep the last one that was, and an
 * empty box is no length at all when `optional`.
 */
export function TimeInput({ minutes, onMinutes, label, placeholder, optional = false, autoFocus = false }: { minutes?: number; onMinutes: (minutes?: number) => void; label: string; placeholder?: string; optional?: boolean; autoFocus?: boolean }) {
  const [text, setText] = useState(minutes ? duration(minutes) : '')
  return <input
    aria-label={label} placeholder={placeholder} value={text} autoFocus={autoFocus} autoComplete="off" autoCapitalize="off" enterKeyHint="done"
    onFocus={(event) => event.target.select()}
    onChange={(event) => {
      setText(event.target.value)
      const typed = parseDuration(event.target.value)
      if (typed) onMinutes(typed)
      else if (optional && !event.target.value.trim()) onMinutes(undefined)
    }}
    onBlur={() => setText(minutes ? duration(minutes) : '')}
  />
}
