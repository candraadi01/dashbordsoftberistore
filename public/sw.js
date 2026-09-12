/* SoftberyStore PWA Service Worker — push notification + offline shell */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

/* ─── Web Push Handler ─────────────────────────────────────────────────── */
self.addEventListener("push", (event) => {
  let payload = { title: "SoftberyStore", body: "Ada transaksi baru masuk!", url: "/dashboard/transactions" };
  if (event.data) {
    try {
      payload = { ...payload, ...JSON.parse(event.data.text()) };
    } catch {
      payload.body = event.data.text();
    }
  }

  const options = {
    body: payload.body,
    icon: "/icons/icon-192x192.png",
    badge: "/icons/badge-72x72.png",
    image: payload.image || undefined,
    vibrate: [200, 100, 200],
    tag: payload.tag || "softbery-transaction",
    renotify: true,
    requireInteraction: false,
    data: { url: payload.url || "/dashboard/transactions", timestamp: Date.now() },
    actions: [
      { action: "open", title: "Buka Dashboard" },
      { action: "dismiss", title: "Tutup" },
    ],
  };

  event.waitUntil(
    self.registration.showNotification(payload.title, options)
  );
});

/* ─── Notification Click Handler ───────────────────────────────────────── */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  if (event.action === "dismiss") return;

  const targetUrl = (event.notification.data && event.notification.data.url) || "/dashboard/transactions";
  const origin = self.location.origin;
  const fullUrl = targetUrl.startsWith("http") ? targetUrl : origin + targetUrl;

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      // Jika sudah ada tab terbuka → fokus dan navigate
      for (const client of clientList) {
        if (client.url.startsWith(origin) && "focus" in client) {
          client.focus();
          client.navigate(fullUrl);
          return;
        }
      }
      // Buka tab baru
      if (self.clients.openWindow) return self.clients.openWindow(fullUrl);
    })
  );
});

/* ─── Push Subscription Change ─────────────────────────────────────────── */
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    self.registration.pushManager.subscribe({ userVisibleOnly: true })
      .then((subscription) =>
        fetch("/api/push/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(subscription.toJSON()),
        })
      )
  );
});
