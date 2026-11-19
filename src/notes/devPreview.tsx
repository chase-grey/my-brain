// Dev-only page for trying the editor before the notes tab exists: `npm run dev`, then /dev/note-editor.html.
// It is not an input of the production build.
import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../styles.css'
import { useKeyboardInset } from '../useKeyboardInset'
import { NoteEditor } from './NoteEditor'

const sample = `---
tags: [sample]
---
# Trip planning
## Before we go
* [ ] renew passport
* [x] book the cabin
    * [ ] ask about the dog

Some *italic*, __bold__, a_snake_case word, and [[20 Projects/House|the house]].
A second line with a [web link](https://example.com) and a [note link](other-note.md).

| when | what |
|:-----|-----:|
| 9am  | **leave** |

> pack light

\`\`\`
plain code
\`\`\`

<details><summary>raw</summary>html</details>
`

function Preview() {
  useKeyboardInset()
  const [saved, setSaved] = useState(sample)
  const [opened, setOpened] = useState('')
  return <main className="main" style={{ '--tabbar': '0px' } as React.CSSProperties}>
    <NoteEditor source={sample} onChange={setSaved} onOpenNote={setOpened} />
    <details open>
      <summary>saved markdown{saved === sample ? ' (identical)' : ''}{opened ? ` · opened ${opened}` : ''}</summary>
      <pre style={{ whiteSpace: 'pre-wrap', fontSize: '0.8rem' }}>{saved}</pre>
    </details>
  </main>
}

createRoot(document.getElementById('root')!).render(<StrictMode><Preview /></StrictMode>)
