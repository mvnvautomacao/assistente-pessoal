// Service worker minimo: existe so pra satisfazer o requisito de instalacao
// do Chrome/Android (PWA instalavel exige um SW registrado com handler de
// fetch). De proposito NAO guarda cache nenhum -- e um painel de dados
// financeiros ao vivo, mostrar uma versao antiga offline seria mais confuso
// (saldo/gasto errado) do que util.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request));
});
