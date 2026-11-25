// A text is only ever drafted here. The draft opens in the phone's own messaging app, where the person
// picks who it goes to, changes what they like, and sends it themselves.

const phonePattern = /^\+?[\d\s().-]{7,}$/

/** An sms: link carrying the draft. The number goes along only when `to` is one; a name is left for the messaging app. */
export function smsLink(body: string, to = ''): string {
  const number = phonePattern.test(to.trim()) ? to.replace(/[^\d+]/g, '') : ''
  return `sms:${number}?body=${encodeURIComponent(body)}`
}
