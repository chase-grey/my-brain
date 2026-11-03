import { useState } from 'react'
import { storeLabel, storeOptions, visibleStoreItems } from '../domain/shopping'
import type { StoreType, Task } from '../domain/types'
import { newId } from '../format'
import { Card, Empty, Toggle } from '../ui'

export function StoresView({ activeStore, tasks, onStore, onToggle, onAdd }: {
  activeStore: StoreType
  tasks: Task[]
  onStore: (store: StoreType) => void
  onToggle: (id: string) => void
  onAdd: (task: Task) => void
}) {
  const [title, setTitle] = useState('')
  const items = visibleStoreItems(tasks, activeStore)
  const label = storeLabel(activeStore).toLowerCase()

  function submit(event: React.FormEvent) {
    event.preventDefault()
    const cleanTitle = title.trim()
    if (!cleanTitle) return
    const id = newId('item')
    const isOnline = activeStore === 'amazon'
    onAdd({
      id, taskId: id, domain: 'personal', title: cleanTitle, completed: false,
      estimateMin: 5, originalEstimateMin: 5, priority: 3,
      energy: isOnline ? 'shallow' : 'errand',
      place: isOnline ? ['home'] : ['out'],
      needs: isOnline ? ['computer'] : ['store'], storeType: activeStore,
      pinned: false, carries: 0, metadataComplete: true,
    })
    setTitle('')
  }

  return <>
    <header className="view-head"><h1>stores</h1></header>
    <div className="segmented store-tabs" role="tablist" aria-label="store">{storeOptions.map((store) => {
      const count = visibleStoreItems(tasks, store.value).filter((item) => !item.completed).length
      return <button role="tab" aria-selected={activeStore === store.value} className={activeStore === store.value ? 'selected' : ''} key={store.value} onClick={() => onStore(store.value)} type="button">{store.shortLabel.toLowerCase()}{count > 0 && <small>{count}</small>}</button>
    })}</div>
    <Card title={label}>
      <form className="add-line" onSubmit={submit}><input aria-label={`add to ${label}`} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="add an item" /><button className="primary" type="submit" disabled={!title.trim()}>add</button></form>
      {items.length
        ? <ul className="rows">{items.map((item) => <li className={`row${item.completed ? ' is-done' : ''}`} key={item.id}><Toggle done={item.completed} label={`${item.completed ? 'need again' : 'bought'} ${item.title}`} onToggle={() => onToggle(item.id)} /><div className="row-main"><span className="row-title">{item.title}</span></div></li>)}</ul>
        : <Empty>nothing on the list</Empty>}
    </Card>
  </>
}
