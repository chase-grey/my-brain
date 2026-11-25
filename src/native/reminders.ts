import type { Reminder } from '../domain/remind'
import { isNativeApp } from './platform'

/** The part of the notifications plugin the reminders use, so a test can stand in for the phone. */
export type ReminderPhone = {
  checkPermissions(): Promise<{ display: string }>
  requestPermissions(): Promise<{ display: string }>
  getPending(): Promise<{ notifications: { id: number }[] }>
  cancel(options: { notifications: { id: number }[] }): Promise<void>
  schedule(options: { notifications: { id: number; title: string; body: string; schedule: { at: Date; allowWhileIdle: boolean }; extra: { taskId: string } }[] }): Promise<unknown>
}

/**
 * Makes the phone hold exactly these reminders: whatever it had that is no longer wanted is dropped, and the
 * rest are set again, so a changed time or title takes the place of the old one. Android asks once whether the
 * app may notify, the first time there is a reminder to set.
 */
export async function setReminders(phone: ReminderPhone, reminders: Reminder[]): Promise<void> {
  if (reminders.length && (await phone.checkPermissions()).display.startsWith('prompt')) await phone.requestPermissions()
  const { notifications } = await phone.getPending()
  if (notifications.length) await phone.cancel({ notifications: notifications.map(({ id }) => ({ id })) })
  if (!reminders.length) return
  await phone.schedule({ notifications: reminders.map((reminder) => ({
    id: reminder.id, title: reminder.title, body: '', schedule: { at: new Date(reminder.at), allowWhileIdle: true }, extra: { taskId: reminder.taskId },
  })) })
}

async function phone() {
  return (await import('@capacitor/local-notifications')).LocalNotifications
}

let lastSent: string | undefined
let queue: Promise<void> = Promise.resolve()

/** Sends the reminders to the android app when they changed. Harmless in a browser, which gives no reminders. */
export function pushReminders(reminders: Reminder[]): Promise<void> {
  if (!isNativeApp()) return Promise.resolve()
  const encoded = JSON.stringify(reminders)
  if (encoded === lastSent) return queue
  lastSent = encoded
  queue = queue.then(async () => {
    try {
      await setReminders(await phone(), reminders)
    } catch {
      // Tried again the next time the tasks change or the app opens.
      if (lastSent === encoded) lastSent = undefined
    }
  })
  return queue
}

/** A tap on a reminder opens its task, on a cold start and while the app is already open. */
export async function followReminderTaps(): Promise<void> {
  if (!isNativeApp()) return
  try {
    await (await phone()).addListener('localNotificationActionPerformed', (event) => {
      const taskId = (event.notification.extra as { taskId?: unknown } | undefined)?.taskId
      if (typeof taskId === 'string' && taskId) location.hash = `#task/${taskId}`
    })
  } catch {
    // The reminder still shows; it just opens the app where it was.
  }
}
