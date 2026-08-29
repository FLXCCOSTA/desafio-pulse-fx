/*
 * Service worker do Pulse FX.
 *
 * A decisão central aqui é o que NÃO fica em cache.
 *
 * Num painel financeiro, servir dado de cache é pior do que não servir nada:
 * mostrar uma cotação de ontem como se fosse a de agora, sem que o usuário
 * perceba, transforma uma falha de rede visível numa informação errada
 * silenciosa. Por isso `/api` nunca é interceptado — vai direto à rede e, se a
 * rede falhar, a interface mostra o estado de erro, que é honesto.
 *
 * O cache cobre apenas a casca do aplicativo: HTML, JS, CSS e ícones. É o que
 * dá a abertura instantânea e a instalação como app, sem risco de mentir sobre
 * números.
 */

const CACHE = 'pulsefx-shell-v1';
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Dados nunca saem do cache. Ver o comentário no topo do arquivo.
  if (url.pathname.startsWith('/api')) return;

  // Também não interceptamos outras origens nem métodos com efeito colateral.
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;

  // Rede primeiro, cache como rede de segurança: assim um deploy novo aparece
  // na primeira visita com conexão, em vez de ficar preso numa versão antiga.
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        void caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() =>
        caches.match(event.request).then((cached) => cached ?? caches.match('/index.html')),
      ),
  );
});
