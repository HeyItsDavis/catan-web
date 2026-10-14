import { lazy, Suspense } from 'react';
import './App.css';
import { HomePage } from './ui/lobby/HomePage';
import { RoomPage } from './ui/lobby/RoomPage';
import { parseHash, useHash } from './ui/router';

// Split off the screens most players never open (keeps the first load small).
const ModEditor = lazy(() => import('./ui/editor/ModEditor'));
const DevGameHarness = lazy(() => import('./ui/game/dev/DevGameHarness'));

function Loading() {
  return <main className="center-page"><div className="spinner" aria-label="Loading" /></main>;
}

export default function App() {
  const route = parseHash(useHash());
  switch (route.name) {
    case 'home':
      return <HomePage />;
    case 'room':
      return <RoomPage key={route.code} code={route.code} />;
    case 'editor':
      return (
        <div className="app-editor">
          <header className="topbar">
            <a className="brand" href="#/">⬡ Hexlands</a>
            <span className="topbar-title">Mod Editor</span>
          </header>
          <Suspense fallback={<Loading />}>
            <ModEditor />
          </Suspense>
        </div>
      );
    case 'devGame':
      return <Suspense fallback={<Loading />}><DevGameHarness /></Suspense>;
    case 'notFound':
      return (
        <main className="center-page">
          <div className="card narrow">
            <h1>Page not found</h1>
            <p className="muted">Nothing lives at <code>{route.path}</code>.</p>
            <a className="btn primary" href="#/">Go home</a>
          </div>
        </main>
      );
  }
}
