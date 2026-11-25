import { useState, type Dispatch, type SetStateAction } from 'react'
import { wifiNames } from '../domain/whereabouts'
import { isNativeApp } from '../native/platform'
import { refreshWifi, useWifi } from '../native/wifi'
import type { AppSettings } from '../settings'
import { placeOptions } from '../domain/taskGuess'
import type { Place } from '../domain/types'
import { shortDate } from '../format'
import { Card, Field } from '../ui'

/** Where he is, at the top of today: what the wifi or the clock says, a place picked by hand, or gone. */
export function WherePicker({ place, picked, gone, asking, onPick, onAsk, onGone, currentDay }: {
  place: Place
  picked?: Place
  /** The day back, while he is gone. */
  gone?: string
  /** The day back is being asked for. */
  asking: boolean
  onPick: (place?: Place) => void
  onAsk: (asking: boolean) => void
  onGone: (backOn: string) => void
  currentDay: string
}) {
  const label = placeOptions.find((option) => option.value === place)?.label
  function choose(value: string) {
    if (value === 'gone') return onAsk(true)
    onAsk(false)
    // Picking a place while gone is coming back.
    if (gone) onGone(currentDay)
    onPick(value === 'auto' ? undefined : value as Place)
  }
  return <select className="quiet-select" aria-label="where you are" value={gone || asking ? 'gone' : picked ?? 'auto'} onChange={(event) => choose(event.target.value)}>
    <option value="auto">{picked || gone || asking ? 'automatic' : `${label} · auto`}</option>
    {placeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    <option value="gone">gone</option>
  </select>
}

function dayAfter(day: string): string {
  const date = new Date(`${day}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + 1)
  return date.toISOString().slice(0, 10)
}

/** The note he leaves himself while away, and the form that asks for the day back. Nothing when he is here. */
export function GoneCard({ gone, asking, currentDay, onGone, onCancel }: {
  gone?: string
  asking: boolean
  currentDay: string
  onGone: (backOn: string) => void
  onCancel: () => void
}) {
  const [backOn, setBackOn] = useState('')
  if (gone) return <Card title="gone">
    <p className="note">back {shortDate(gone)}</p>
    <div className="actions"><button className="secondary" type="button" onClick={() => onGone(currentDay)}>i’m back</button></div>
  </Card>
  if (!asking) return null
  return <Card title="gone">
    <form onSubmit={(event) => { event.preventDefault(); if (backOn > currentDay) { onGone(backOn); onCancel() } }}>
      <Field label="back on"><input type="date" min={dayAfter(currentDay)} value={backOn} onChange={(event) => setBackOn(event.target.value)} /></Field>
      <div className="actions"><button className="primary" type="submit" disabled={!(backOn > currentDay)}>save</button><button className="plain" type="button" onClick={onCancel}>cancel</button></div>
    </form>
  </Card>
}

/** The names of the home and work wifi. On the phone the network it is on can be taken for either. */
export function WifiCard({ settings, onSettings }: { settings: AppSettings; onSettings: Dispatch<SetStateAction<AppSettings>> }) {
  const wifi = useWifi()
  const set = (key: 'homeWifi' | 'workWifi', value: string) => onSettings((current) => ({ ...current, [key]: value }))
  const name = wifi?.name
  const known = name ? [...wifiNames(settings.homeWifi), ...wifiNames(settings.workWifi)].includes(name.toLowerCase()) : true
  return <Card title="wifi">
    <div className="stack">
      <Field label="home wifi"><input autoComplete="off" autoCapitalize="off" spellCheck={false} value={settings.homeWifi} onChange={(event) => set('homeWifi', event.target.value)} /></Field>
      <Field label="work wifi"><input autoComplete="off" autoCapitalize="off" spellCheck={false} value={settings.workWifi} onChange={(event) => set('workWifi', event.target.value)} /></Field>
    </div>
    {isNativeApp() && wifi && !wifi.allowed && <div className="actions"><button className="secondary" type="button" onClick={() => void refreshWifi(true)}>allow wifi name</button></div>}
    {name && !known && <>
      <p className="note">on {name}</p>
      <div className="actions">
        <button className="secondary" type="button" onClick={() => set('homeWifi', name)}>this is home</button>
        <button className="secondary" type="button" onClick={() => set('workWifi', name)}>this is work</button>
      </div>
    </>}
  </Card>
}
