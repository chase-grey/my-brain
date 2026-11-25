import { MONEY_FIGURES, moneyReadPrompt, parseMoneyRead, type MoneyAccount, type MoneyFigure } from '../domain/money'
import { autoModel, defaultCompanionModel, type AppSettings } from '../settings'
import { activeModel, baseUrlFor, providerOf, usesAnthropic } from './aiProvider'
import { AnthropicClient, textOf, type ChatClient } from './anthropicClient'
import { readAttachment, userContent } from './attachments'
import { mapCompanionError } from './companion'
import { OpenAiCompatClient } from './openAiClient'

export type MoneyRead = { figures: Partial<Record<MoneyFigure, number>>; accounts: MoneyAccount[] }

/** Reads money screenshots with the person's own key. The pictures go to the model once and are not kept anywhere. */
export async function readMoneyScreenshots(files: File[], client: ChatClient, model: string): Promise<MoneyRead> {
  const images = []
  for (const file of files) {
    const attachment = await readAttachment(file)
    if (attachment.kind !== 'image') throw new Error(`${file.name} is not a picture`)
    images.push(attachment)
  }
  if (!images.length) throw new Error('no screenshots picked')
  let text: string
  try {
    text = textOf((await client.createMessage({ model, system: moneyReadPrompt, messages: [{ role: 'user', content: userContent('read these screenshots', images) }], max_tokens: 2000 })).content)
  } catch (error) {
    throw new Error(mapCompanionError(error).message)
  }
  const read = parseMoneyRead(text)
  if (!read || (!MONEY_FIGURES.some((figure) => read.figures[figure] !== undefined) && !read.accounts.length)) throw new Error('no numbers found in those screenshots')
  return read
}

/** The reader for these settings, or nothing when the chat has no key to read with. */
export function moneyReader(settings: AppSettings): ((files: File[]) => Promise<MoneyRead>) | undefined {
  const apiKey = settings.anthropicApiKey.replace(/\s+/g, '')
  const baseUrl = baseUrlFor(settings)
  const anthropic = usesAnthropic('personal', settings)
  const picked = activeModel('personal', settings)
  const model = picked === autoModel ? defaultCompanionModel : picked
  if (settings.aiMode !== 'key' || !apiKey || !baseUrl || !model) return undefined
  const provider = providerOf(settings.aiProvider)
  const client = anthropic ? new AnthropicClient(apiKey) : new OpenAiCompatClient(apiKey, baseUrl, provider.id === 'custom' ? 'the ai service' : provider.label)
  return (files) => readMoneyScreenshots(files, client, model)
}
