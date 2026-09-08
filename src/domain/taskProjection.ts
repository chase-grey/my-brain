import type { ProviderTask, Task, TaskMeta } from './types'

export type TaskProjection = {
  triaged: Task[]
  untriaged: ProviderTask[]
}

function key(domain: ProviderTask['domain'], id: string): string {
  return `${domain}:${id}`
}

export function projectTasks(providerTasks: ProviderTask[], metadata: TaskMeta[]): TaskProjection {
  const metadataByTask = new Map(metadata.map((item) => [key(item.domain, item.taskId), item]))
  const triaged: Task[] = []
  const untriaged: ProviderTask[] = []

  for (const providerTask of providerTasks) {
    const meta = metadataByTask.get(key(providerTask.domain, providerTask.id))
    if (!meta) {
      untriaged.push(providerTask)
      continue
    }
    triaged.push({ ...providerTask, ...meta })
  }

  return { triaged, untriaged }
}
