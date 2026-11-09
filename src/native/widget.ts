import { registerPlugin } from '@capacitor/core'
import { isDoneToday } from '../domain/personalNow'
import type { Domain, Place, Task } from '../domain/types'
import { commitmentHint } from '../views/TodayView'
import { isNativeApp } from './platform'

export type WidgetLine = { id: string; text: string; hint?: string }
export type WidgetSnapshot = { title: string; lines: WidgetLine[] }

type WidgetPlugin = { update(snapshot: WidgetSnapshot): Promise<void> }

// On the web there is no widget; the call just does nothing.
const Widget = registerPlugin<WidgetPlugin>('Widget', { web: () => Promise.resolve({ update: async () => {} }) })

/** The home-screen widget shows what the today card shows: today's open commitments, with the same hints. */
export function widgetSnapshot(domain: Domain, commitments: Task[], currentDay: string, place: Place, limit = 5): WidgetSnapshot {
  const open = commitments.filter((task) => !isDoneToday(task, currentDay))
  return {
    title: `today · ${domain}`,
    lines: open.slice(0, limit).map((task) => {
      const hint = commitmentHint(task, currentDay, place)
      return { id: task.id, text: task.title, ...(hint ? { hint } : {}) }
    }),
  }
}

let lastSent = ''

/** Sends the snapshot to the android widget when it changed. Harmless in a browser. */
export async function pushWidget(snapshot: WidgetSnapshot): Promise<void> {
  if (!isNativeApp()) return
  const encoded = JSON.stringify(snapshot)
  if (encoded === lastSent) return
  lastSent = encoded
  try {
    await Widget.update(snapshot)
  } catch {
    // The widget is a convenience; the app carries on without it.
  }
}
