import { useEffect, useState } from 'react'
import { deviceSetupFrom, setupLink, type DeviceAccount } from '../account'
import { copyText } from '../clipboard'
import { qrSvg } from '../qr'
import type { AppSettings } from '../settings'
import { Card, Segmented } from '../ui'

/**
 * The deployed app's address. Fixed to the Pages URL rather than read off `location`, so a link
 * taken from the dev server or the android shell still opens somewhere a new phone can install.
 */
export const APP_URL = 'https://chase-grey.github.io/my-brain/'

type Audience = 'me' | 'new'

/**
 * A QR, a copy and a share for two links. The one that opens first sets up another of your own
 * devices, keys and all, since that is the one you reach for most. The plain app link, for someone
 * who wants their own, is a tap away: the setup link carries your keys, and handing it to the
 * wrong person should not be the easiest thing on the screen.
 */
export function ShareCard({ account, settings }: { account: DeviceAccount; settings: AppSettings }) {
  const [audience, setAudience] = useState<Audience>('me')
  const link = audience === 'me' ? setupLink(APP_URL, deviceSetupFrom(account, settings)) : APP_URL
  const [svg, setSvg] = useState<{ for: string; svg: string }>()
  const [copied, setCopied] = useState(false)
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'

  useEffect(() => {
    let alive = true
    qrSvg(link).then((value) => { if (alive) setSvg({ for: link, svg: value }) }).catch(() => {
      // No QR; the buttons still carry the link.
    })
    return () => { alive = false }
  }, [link])

  async function copy() {
    if (!await copyText(link)) return
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  function share() {
    // A dismissed share sheet rejects; that is the user changing their mind.
    navigator.share(audience === 'me' ? { title: 'my brain', url: link } : { title: 'my brain', text: 'try my brain', url: link }).catch(() => {})
  }

  return <Card title="share">
    <Segmented label="share with" value={audience} onChange={setAudience} options={[{ value: 'me', label: 'my other devices' }, { value: 'new', label: 'someone new' }]} />
    <div className="share-qr">
      <div className="qr" role="img" aria-label={audience === 'me' ? 'setup qr code' : 'app qr code'} dangerouslySetInnerHTML={{ __html: svg?.for === link ? svg.svg : '' }} />
      {audience === 'new' && <span className="share-url">{APP_URL.replace(/^https:\/\//, '')}</span>}
    </div>
    <div className="actions row-actions">
      <button className="secondary" type="button" onClick={() => void copy()}>{copied ? 'copied' : 'copy link'}</button>
      {canShare && <button className="secondary" type="button" onClick={share}>share</button>}
    </div>
  </Card>
}
