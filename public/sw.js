const cacheName = 'my-brain-shell-v3'
// Shared transcripts wait here between the share-target POST and the app draining them (docs/transcripts.md).
const shareCacheName = 'my-brain-share'

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(cacheName).then((cache) => cache.add('./')))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== cacheName && key !== shareCacheName).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (url.origin !== self.location.origin) return

  if (event.request.method === 'POST' && url.pathname.endsWith('/share-target')) {
    event.respondWith(receiveShare(event.request))
    return
  }

  if (event.request.method !== 'GET') return
  // The update check asks for the published page past every cache; a cached answer would hide a new deploy.
  if (event.request.cache === 'no-store') return

  if (event.request.mode === 'navigate') {
    event.respondWith(
      // The host lets the browser reuse the page for ten minutes; asking it to check keeps a new deploy from hiding behind that.
      fetch(event.request, { cache: 'no-cache' })
        .then((response) => {
          const copy = response.clone()
          caches.open(cacheName).then((cache) => cache.put('./', copy))
          return response
        })
        .catch(() => caches.match('./')),
    )
    return
  }

  const keep = (response) => {
    if (response.ok) {
      const copy = response.clone()
      caches.open(cacheName).then((cache) => cache.put(event.request, copy))
    }
    return response
  }

  // Only the build's hashed files can be served from cache first. The manifest and icons keep their
  // names when they change, so the cached copy is only for when the network is down.
  if (url.pathname.includes('/assets/')) {
    event.respondWith(caches.match(event.request).then((cached) => cached ?? fetch(event.request).then(keep)))
    return
  }

  event.respondWith(fetch(event.request).then(keep).catch(() => caches.match(event.request).then((cached) => cached ?? Response.error())))
})

// Android's share sheet posts the form here. Each shared file or text becomes one cache entry;
// the app reads them at #share and deletes each one once its note is written.
async function receiveShare(request) {
  try {
    const form = await request.formData()
    const title = String(form.get('title') ?? '')
    const cache = await caches.open(shareCacheName)
    const texts = []
    for (const file of form.getAll('transcript')) {
      if (typeof file === 'string') texts.push(file)
      else if (file && typeof file.text === 'function') texts.push(await file.text())
    }
    const text = String(form.get('text') ?? '')
    if (!texts.length && text) texts.push(text)
    const stamp = Date.now()
    await Promise.all(texts.map((body, index) => cache.put(
      new Request(new URL(`./share/${stamp}-${index}`, self.registration.scope).href),
      new Response(body, { headers: { 'content-type': 'text/markdown; charset=utf-8', 'x-share-title': encodeURIComponent(title) } }),
    )))
  } catch (error) {
    console.warn('share-target failed', error)
  }
  return Response.redirect(new URL('./#share', self.registration.scope).href, 303)
}
