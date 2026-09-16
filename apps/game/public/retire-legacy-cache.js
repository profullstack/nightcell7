/* Run on normal service-worker activation, never force an update during play. */
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.delete("nc7-content"));
});
