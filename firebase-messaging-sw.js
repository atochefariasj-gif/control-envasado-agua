// Importar los SDKs de Firebase Compat dentro del Service Worker
importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js');

// Configuración extraída de tu consola de Firebase
const firebaseConfig = {
  apiKey: "AIzaSyBoAEj2D9wUNZrRFSmdxOM1scqm0urNfRo",
  authDomain: "control-envasado-agua.firebaseapp.com",
  projectId: "control-envasado-agua",
  storageBucket: "control-envasado-agua.firebasestorage.app",
  messagingSenderId: "337600183929",
  appId: "1:337600183929:web:1f019b401521161a2e1ea8",
  measurementId: "G-DJ3LZ96XP7"
};

// Inicializar Firebase
firebase.initializeApp(firebaseConfig);

// Inicializar el servicio de notificaciones
const messaging = firebase.messaging();

// Escuchar notificaciones entrantes cuando la app está en segundo plano o cerrada
messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Notificación recibida en segundo plano:', payload);

  // Intentar obtener el título y mensaje de 'notification' o directamente de 'data'
  const notificationTitle = payload.notification?.title || payload.data?.title || '💧 AGROMAR INDUSTRIAL';
  const notificationBody = payload.notification?.body || payload.data?.body || 'Se ha registrado una nueva actualización.';

  const notificationOptions = {
    body: notificationBody,
    icon: './icon-192.png',
    badge: './icon-192.png',
    vibrate: [100, 50, 100],
    data: {
      url: self.location.origin,
      solicitud_id: payload.data?.solicitud_id || ''
    }
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});

// Acción al hacer clic en la notificación recibida
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (let client of windowClients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow('./index.html');
      }
    })
  );
});
