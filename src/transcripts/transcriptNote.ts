// Turns a transcript shared from Mark Zakharov's Transcribe app into a HomeBase note.
// See docs/transcripts.md. The share arrives as the app's markdown export: a title heading, a
// short bullet header (Date, Duration, Speakers), then "[mm:ss] Speaker: text" lines. A .txt
// export is the lines only, so every header field has a fallback.

export const transcriptsFolder = '40 Transcripts'

export type SharedTranscript = {
  text: string
  title?: string
}

export type ParsedTranscript = {
  title: string
  date: string
  duration?: string
  speakers?: number
  body: string
}

const forbidden = /["*:<>?/\\|]/g
const reservedNames = new Set(['CON', 'PRN', 'AUX', 'NUL', ...Array.from({ length: 9 }, (_, i) => [`COM${i + 1}`, `LPT${i + 1}`]).flat()])

export function parseTranscript(shared: SharedTranscript, today: string): ParsedTranscript {
  const lines = shared.text.replace(/\r\n?/g, '\n').split('\n')
  let title = ''
  let dateText = ''
  let duration: string | undefined
  let speakers: number | undefined
  let index = 0

  while (index < lines.length) {
    const line = lines[index].trim()
    if (!line) { index++; continue }
    if (!title && line.startsWith('# ')) { title = line.slice(2).trim(); index++; continue }
    const field = /^- (Date|Duration|Speakers):\s*(.*)$/.exec(line)
    if (field) {
      if (field[1] === 'Date') dateText = field[2]
      if (field[1] === 'Duration') duration = field[2] || undefined
      if (field[1] === 'Speakers') speakers = Number.parseInt(field[2], 10) || undefined
      index++
      continue
    }
    break
  }

  const body = lines.slice(index).join('\n').trim()
  return {
    title: title || shared.title?.trim() || 'recording',
    date: parseDate(dateText) ?? today,
    duration,
    speakers,
    body,
  }
}

// Mark's export prints the date in the phone's locale (for example "Nov 4, 2026, 2:15 PM").
// Date.parse handles the English forms; anything else falls back to today.
function parseDate(text: string): string | undefined {
  if (!text) return undefined
  const parsed = new Date(text)
  if (Number.isNaN(parsed.getTime())) return undefined
  const y = parsed.getFullYear()
  const m = String(parsed.getMonth() + 1).padStart(2, '0')
  const d = String(parsed.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function safeTitle(raw: string, maxLength = 60): string {
  let cleaned = Array.from(raw, (ch) => ch.charCodeAt(0) < 0x20 && !/\s/.test(ch) ? '_' : ch).join('').replace(forbidden, '_').replace(/\s+/g, ' ').trim().replace(/^[. ]+|[. ]+$/g, '').slice(0, maxLength).replace(/^[. ]+|[. ]+$/g, '')
  if (!cleaned) return 'recording'
  if (reservedNames.has(cleaned.split('.')[0].toUpperCase())) cleaned = `_${cleaned}`
  return cleaned
}

export function transcriptPath(parsed: ParsedTranscript, suffix = 0): string {
  const name = `${parsed.date} ${safeTitle(parsed.title)}${suffix > 1 ? ` ${suffix}` : ''}`
  return `${transcriptsFolder}/${name}.md`
}

export function transcriptNote(parsed: ParsedTranscript): string {
  const front = [
    '---',
    `date: ${parsed.date}`,
    ...(parsed.duration ? [`duration: "${parsed.duration}"`] : []),
    ...(parsed.speakers ? [`speakers: ${parsed.speakers}`] : []),
    'source: transcribe',
    '---',
  ]
  return `${front.join('\n')}\n# ${parsed.title}\n\n${parsed.body}\n`
}
