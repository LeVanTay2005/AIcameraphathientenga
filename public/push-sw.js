// Firebase Web config is public configuration, never a service-account credential.
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/camera.html#recordings', self.location.origin);
  if (url.origin !== self.location.origin) return;
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async windows => {
    const existing = windows.find(client => new URL(client.url).origin === url.origin);
    if (existing) { await existing.navigate(url.href); return existing.focus(); }
    return clients.openWindow(url.href);
  }));
});
self.addEventListener('install', () => self.skipWaiting());
importScripts('https://www.gstatic.com/firebasejs/11.6.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/11.6.0/firebase-messaging-compat.js');
const config = JSON.parse(new URL(self.location.href).searchParams.get('config') || '{}');
firebase.initializeApp(config);
firebase.messaging().onBackgroundMessage(payload => {
  const data = payload.data || {};
  return self.registration.showNotification(data.title || 'Sự kiện camera', {
    body: data.body || 'Có ảnh/video mới. Mở ứng dụng để kiểm tra.',
    icon: '/icons/icon-192.png', tag: data.eventId || 'camera-event',
    data: { url: '/camera.html?event=' + encodeURIComponent(data.eventId || '') + '#recordings' }
  });
});
