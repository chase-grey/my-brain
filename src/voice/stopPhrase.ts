/**
 * Whether a spoken message is the request to leave voice mode. Only a message that is nothing but the phrase counts,
 * so "remind me to stop listening to the news" is still sent.
 */
export function asksToStopListening(heard: string): boolean {
  const words = heard.toLowerCase().replace(/[^a-z\s]/g, ' ').trim().split(/\s+/).filter((word) => !['ok', 'okay', 'please', 'now', 'thanks'].includes(word))
  return words.join(' ') === 'stop listening'
}
