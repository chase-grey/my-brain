/** TypeSafe's system-one model: a state and up to eight labeled questions in, calibrated probabilities out. No text is generated. */
export type JevQuestion = { type: 'choice'; instructions: string; criteria: Record<string, string> }
export type JevAnswer = { type: 'choice'; choice: string; probabilities: Record<string, number> }

export class JevError extends Error {
  constructor(readonly status: number, readonly responseBody: string) {
    super(`jev returned ${status}`)
  }
}

export class JevClient {
  constructor(
    private readonly apiKey: string,
    private readonly fetcher: typeof fetch = (input, init) => fetch(input, init),
    private readonly baseUrl = 'https://api.typesafe.ai/v1/systemone',
    private readonly model = 'jev-latest',
  ) {}

  async ask(state: Record<string, unknown>, questions: Record<string, JevQuestion>): Promise<Record<string, JevAnswer>> {
    const response = await this.fetcher(this.baseUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ model: this.model, state, questions }),
    })
    if (!response.ok) throw new JevError(response.status, await response.text())
    const result = await response.json() as { answers?: Record<string, JevAnswer> }
    return result.answers ?? {}
  }
}
