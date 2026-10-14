/** Tiny hash router: #/ , #/room/<code> , #/editor */
import { useSyncExternalStore } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'room'; code: string }
  | { name: 'editor' }
  | { name: 'devGame' }
  | { name: 'notFound'; path: string };

export function parseHash(hash: string): Route {
  const path = hash.replace(/^#/, '').replace(/\/+$/, '') || '/';
  if (path === '/' || path === '') return { name: 'home' };
  const room = /^\/room\/([A-Za-z0-9]+)$/.exec(path);
  if (room) return { name: 'room', code: room[1].toUpperCase() };
  if (path === '/editor') return { name: 'editor' };
  if (path.startsWith('/dev/game')) return { name: 'devGame' };
  return { name: 'notFound', path };
}

function subscribe(cb: () => void): () => void {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
}

export function useHash(): string {
  return useSyncExternalStore(subscribe, () => window.location.hash);
}

export function navigate(to: '/' | '/editor' | `/room/${string}`): void {
  window.location.hash = to;
}

export function roomLink(code: string): string {
  const { origin, pathname, search } = window.location;
  return `${origin}${pathname}${search}#/room/${code}`;
}
