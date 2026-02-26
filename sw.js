/* ═══════════════════════════════════════════════════════
   SubTrack Service Worker — Background Notifications
   ═══════════════════════════════════════════════════════ */

const CACHE_NAME = 'subtrack-v1';

let subsData = [];
let reminderDays = 3;
let checkInterval = null;

/* ── INSTALL ──────────────────────────────────────────── */
self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

/* ── ACTIVATE ─────────────────────────────────────────── */
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

/* ── FETCH (Offline support) ──────────────────────────── */
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request).catch(() => cached))
  );
});

/* ── MESSAGES from main app ───────────────────────────── */
self.addEventListener('message', (event) => {
  const { type, subs, reminderDays: rd, userName } = event.data || {};

  if (type === 'SYNC_SUBS') {
    subsData = subs || [];
    reminderDays = rd || 3;
    if (checkInterval) clearInterval(checkInterval);
    checkAndNotify(subsData, reminderDays, userName);
    checkInterval = setInterval(() => {
      checkAndNotify(subsData, reminderDays, userName);
    }, 60 * 60 * 1000);
  }

  if (type === 'CHECK_NOW') {
    checkAndNotify(subsData, reminderDays, event.data.userName);
  }
});

/* ── PERIODIC SYNC (PWA installed, Chrome 80+) ─────────── */
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'check-bills') {
    event.waitUntil(checkAndNotify(subsData, reminderDays));
  }
});

/* ── NOTIFICATION CLICK ───────────────────────────────── */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then(clients => {
      for (const client of clients) {
        if ('focus' in client) return client.focus();
      }
      return self.clients.openWindow('./');
    })
  );
});

/* ── CORE: Check bills & show notifications ─────────────── */
function checkAndNotify(subs, remindDays, userName) {
  if (!subs || !subs.length) return Promise.resolve();
  const today = new Date(); today.setHours(0,0,0,0);

  const upcoming = subs.filter(sub => {
    const due = new Date(sub.date + 'T00:00:00');
    const diff = Math.round((due - today) / 86400000);
    return diff >= 0 && diff <= remindDays;
  });

  if (!upcoming.length) return Promise.resolve();

  if (upcoming.length === 1) {
    const sub = upcoming[0];
    const days = Math.round((new Date(sub.date + 'T00:00:00') - today) / 86400000);
    const dueText = days === 0 ? 'due TODAY' : days === 1 ? 'due tomorrow' : `due in ${days} days`;
    const amt = sub.cycle === 'yearly'
      ? `₹${Math.round(sub.cost).toLocaleString('en-IN')}/yr`
      : `₹${Math.round(sub.cost).toLocaleString('en-IN')}/mo`;

    return self.registration.showNotification('💳 SubTrack Reminder', {
      body: `${sub.name} (${amt}) is ${dueText}`,
      tag: `bill-${sub.id}-${today.toDateString()}`,
      renotify: true,
      requireInteraction: days === 0,
      data: { url: './' }
    });
  } else {
    const total = upcoming.reduce((a, s) => a + (s.cycle === 'yearly' ? s.cost / 12 : s.cost), 0);
    const names = upcoming.slice(0, 2).map(s => s.name).join(', ');
    const extra = upcoming.length > 2 ? ` +${upcoming.length - 2} more` : '';
    return self.registration.showNotification(`💳 ${upcoming.length} Bills Coming Up`, {
      body: `${names}${extra} — ₹${Math.round(total).toLocaleString('en-IN')} total`,
      tag: `bills-grouped-${today.toDateString()}`,
      renotify: true,
      data: { url: './' }
    });
  }
}
