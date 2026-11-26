import { registerPlugin } from '@capacitor/core'
import { useEffect, useState } from 'react'
import { APP_COMMIT } from '../appUpdate'
import { isNativeApp } from '../native/platform'
import { mergeLogs, signInLog } from '../signInLog'
import { Sheet } from '../ui'

/** The android shell's side of a sign-in: where the webview went and what failed to load (ReturnPlugin.java). */
const Return = registerPlugin<{ log(): Promise<{ lines: string }> }>('Return')

/** The sign-in log (src/signInLog.ts), to read or copy when connecting microsoft fails. */
export function SignInLog() {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [shell, setShell] = useState('')

  useEffect(() => {
    if (!open || !isNativeApp()) return
    // An apk from before the shell kept a log has nothing to give.
    void Return.log().then((kept) => setShell(kept.lines), () => setShell(''))
  }, [open])

  const text = open ? `build ${APP_COMMIT} · ${isNativeApp() ? 'android app' : 'browser'} · ${navigator.userAgent}\n${mergeLogs(signInLog(), shell) || 'nothing yet'}` : ''

  function copy(): void {
    void navigator.clipboard.writeText(text).then(() => setCopied(true), () => setCopied(false))
  }

  return <>
    <button className="plain" type="button" onClick={() => { setCopied(false); setOpen(true) }}>sign-in log</button>
    {open && <Sheet title="sign-in log" onClose={() => setOpen(false)}>
      <div className="actions row-actions">
        <button className="primary" type="button" onClick={copy}>{copied ? 'copied' : 'copy'}</button>
        <button className="plain" type="button" onClick={() => setOpen(false)}>close</button>
      </div>
      <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: '0.75rem', userSelect: 'text', margin: 0 }}>{text}</pre>
    </Sheet>}
  </>
}
