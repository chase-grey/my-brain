// Stroke icons on a 24x24 grid using currentColor.
const paths = {
  today: 'M12 4v2M12 18v2M4 12h2M18 12h2M6.3 6.3l1.4 1.4M16.3 16.3l1.4 1.4M6.3 17.7l1.4-1.4M16.3 7.7l1.4-1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  progress: 'M5 19V12M10 19V6M15 19v-4M20 19V9',
  chat: 'M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-8l-4 3v-3H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  stores: 'M3 5h2l2.4 10.5a1 1 0 0 0 1 .8h8.8a1 1 0 0 0 1-.8L20 8H6.2M9 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM17 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  goals: 'M6 21V4M6 4h11l-2.5 4L17 12H6',
  settings: 'M5 7h7M16 7h3M5 12h1M10 12h9M5 17h9M18 17h1M14 5v4M8 10v4M16 15v4',
  plus: 'M12 5v14M5 12h14',
  back: 'M15 5l-7 7 7 7',
  check: 'M5 12.5l4.5 4.5L19 7',
  send: 'M12 19V5M5 12l7-7 7 7',
} as const

export type IconName = keyof typeof paths

export function Icon({ name, size = 22 }: { name: IconName; size?: number }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name]} /></svg>
}
