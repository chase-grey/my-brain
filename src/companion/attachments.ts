import type { ContentBlock } from './anthropicClient'

export type AttachmentKind = 'image' | 'pdf' | 'text'
/**
 * Something sent along with a chat message. `data` is base64 for an image or a pdf and the words themselves for a
 * text file. It lives in memory only: a stored thread keeps the name and nothing else.
 */
export type Attachment = { name: string; kind: AttachmentKind; mediaType: string; data?: string }

/** What the file picker offers. */
export const attachmentAccept = 'image/*,application/pdf,text/*,.md,.csv,.json,.log,.yml,.yaml,.xml,.sql,.ps1,.py,.ts,.tsx,.js'
/** The long edge an image is shrunk to before it is sent: past this the model shrinks it anyway. */
export const maxImageEdge = 1568
export const maxPdfBytes = 20 * 1024 * 1024
export const maxTextChars = 200_000

const textExtensions = /\.(txt|md|markdown|csv|tsv|json|log|ya?ml|xml|html?|css|sql|ps1|py|m|[jt]sx?)$/i

/** Which kind a file is, or nothing when the chat cannot send it. */
export function attachmentKind(file: { name: string; type: string }): AttachmentKind | undefined {
  if (file.type.startsWith('image/')) return 'image'
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) return 'pdf'
  if (file.type.startsWith('text/') || file.type === 'application/json' || file.type === 'application/xml' || textExtensions.test(file.name)) return 'text'
  return undefined
}

export function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  return btoa(binary)
}

export function fromBase64(data: string): Uint8Array {
  const binary = atob(data)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return bytes
}

// A phone photo is several megabytes; redrawn at the size the model reads, it is a few hundred kilobytes.
async function readImage(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file)
  try {
    const scale = Math.min(1, maxImageEdge / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('no canvas')
    // Jpeg has no transparency; without this a see-through png turns black.
    context.fillStyle = '#fff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.85).split(',')[1] ?? ''
  } finally {
    bitmap.close()
  }
}

/** Reads a picked file into something the chat can send. Throws with words the chat can show. */
export async function readAttachment(file: File): Promise<Attachment> {
  const kind = attachmentKind(file)
  if (!kind) throw new Error(`can't attach ${file.name}: only photos, pdfs and text files`)
  if (kind === 'image') {
    let data = ''
    try {
      data = await readImage(file)
    } catch {
      // Left empty: reported below.
    }
    if (!data) throw new Error(`can't read ${file.name}`)
    return { name: file.name, kind, mediaType: 'image/jpeg', data }
  }
  if (kind === 'pdf') {
    if (file.size > maxPdfBytes) throw new Error(`${file.name} is over 20 mb`)
    return { name: file.name, kind, mediaType: 'application/pdf', data: toBase64(new Uint8Array(await file.arrayBuffer())) }
  }
  const text = await file.text()
  if (text.length > maxTextChars) throw new Error(`${file.name} is too long to attach`)
  return { name: file.name, kind, mediaType: file.type || 'text/plain', data: text }
}

/** A text file as the model reads it. */
export function fileText(attachment: Attachment): string {
  return `file ${attachment.name}:\n${attachment.data ?? ''}`
}

function block(attachment: Attachment): ContentBlock {
  if (attachment.data === undefined) return { type: 'text', text: `(${attachment.name} was attached here earlier and is no longer available)` }
  if (attachment.kind === 'image') return { type: 'image', source: { type: 'base64', media_type: attachment.mediaType, data: attachment.data } }
  if (attachment.kind === 'pdf') return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: attachment.data }, title: attachment.name }
  return { type: 'text', text: fileText(attachment) }
}

/** A user message as the model gets it: plain words, or the attachments followed by the words. */
export function userContent(text: string, attachments: Attachment[] = []): string | ContentBlock[] {
  if (!attachments.length) return text
  return [...attachments.map(block), ...(text ? [{ type: 'text', text } satisfies ContentBlock] : [])]
}

/** The attachment as a stored thread keeps it. */
export function withoutData({ name, kind, mediaType }: Attachment): Attachment {
  return { name, kind, mediaType }
}
