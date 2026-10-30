// Simple stroke icons for the phone toolbar. Each is a 24x24 viewBox using currentColor.
const paths: Record<string, string> = {
  // sun: today
  now: 'M12 4v2M12 18v2M4 12h2M18 12h2M6.3 6.3l1.4 1.4M16.3 16.3l1.4 1.4M6.3 17.7l1.4-1.4M16.3 7.7l1.4-1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  // calendar: plan
  plan: 'M5 6h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1zM4 10h16M8 4v4M16 4v4',
  // tray: inbox
  inbox: 'M4 13l2.2-7A1 1 0 0 1 7.2 5h9.6a1 1 0 0 1 1 .7L20 13v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-5zM4 13h5l1 2h4l1-2h5',
  // bars: progress
  progress: 'M5 19V12M10 19V6M15 19v-4M20 19V9',
  // speech bubble: companion
  companion: 'M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-8l-4 3v-3H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z',
  // sliders: settings
  settings: 'M5 7h7M16 7h3M5 12h1M10 12h9M5 17h9M18 17h1M14 5v4M8 10v4M16 15v4',
}

export function NavIcon({ name }: { name: keyof typeof paths }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name]} /></svg>
}
