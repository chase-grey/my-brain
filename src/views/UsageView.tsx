import type { Domain } from '../domain/types'

type UsageLink = { title: string; detail: string; href: string }

const personalLinks: UsageLink[] = [
  { title: 'anthropic usage', detail: 'tokens by model and day for your api key', href: 'https://console.anthropic.com/settings/usage' },
  { title: 'anthropic cost', detail: 'spend for the current billing period', href: 'https://console.anthropic.com/settings/cost' },
]

const workLinks: UsageLink[] = [
  { title: 'claude code usage', detail: 'session and weekly limits for the account the bridge uses', href: 'https://claude.ai/settings/usage' },
]

// Chat runs through different accounts per space, so each space links to the dashboard that bills it.
export function UsageView({ domain }: { domain: Domain }) {
  const links = domain === 'personal' ? personalLinks : workLinks
  return <>
    <header className="view-head"><h1>usage</h1></header>
    {links.map((link) => <a key={link.href} className="card linkcard" href={link.href} target="_blank" rel="noreferrer"><span className="row-title">{link.title}</span><small>{link.detail}</small></a>)}
  </>
}
