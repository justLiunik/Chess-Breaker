import { Suspense, lazy, useEffect, useState } from 'react';
import type { RunStorage } from '@checkbreaker/run';
import { Codex } from './overlays/Codex';
import { DeckOverlay } from './overlays/DeckOverlay';
import { useShortcuts } from './input/shortcuts';
import { Action } from './screens/Action';
import { Building } from './screens/Building';
import { Chooser } from './screens/Chooser';
import { Deployment } from './screens/Deployment';
import { EndPlayback } from './screens/EndPlayback';
import { RunMap } from './screens/RunMap';
import { RunResults } from './screens/RunResults';
import { Shop } from './screens/Shop';
import { StageResults } from './screens/StageResults';
import { Title } from './screens/Title';
import { RunProvider, useRun } from './state/store';
import type { StageSource } from './state/stageSource';
import { localStorageRunStorage } from './storage';

type Overlay = 'deck' | 'codex' | null;

function Screens() {
  const { session, lastCommit } = useRun();
  const [overlay, setOverlay] = useState<Overlay>(null);
  // The Run Map is shown once per stage, before its Deployment; the key names the stage it was acknowledged for.
  const [mapSeen, setMapSeen] = useState<string | null>(null);
  const inRun = session !== null;
  const toggle = (which: 'deck' | 'codex') => (): void => setOverlay((o) => (o === which ? null : which));
  useShortcuts({ deck: inRun ? toggle('deck') : undefined, codex: inRun ? toggle('codex') : undefined });

  const body = (() => {
    if (!session) return <Title />;
    const mapKey = `${session.run.seed}:${session.run.actIndex}:${session.run.stageIndex}`;
    // A stage that just ended plays back first: a win shows its results, a loss replays the position and the reply.
    if (lastCommit && (session.phase === 'chooser' || session.phase === 'shop' || session.phase === 'ended')) {
      return lastCommit.won ? <StageResults /> : <EndPlayback />;
    }
    switch (session.phase) {
      case 'awaiting_stage': return <Building />;
      case 'deployment': return mapSeen === mapKey ? <Deployment /> : <RunMap onContinue={() => setMapSeen(mapKey)} />;
      case 'action': return <Action />;
      case 'chooser': return <Chooser />;
      case 'shop': return <Shop />;
      case 'ended': return <RunResults />;
    }
  })();

  return (
    <>
      {inRun && (
        <nav className="appbar" aria-label="Reference">
          <button type="button" onClick={toggle('deck')}>Deck (D)</button>
          {' '}
          <button type="button" onClick={toggle('codex')}>Codex (C)</button>
        </nav>
      )}
      {body}
      {inRun && overlay === 'deck' && <DeckOverlay onClose={() => setOverlay(null)} />}
      {inRun && overlay === 'codex' && <Codex onClose={() => setOverlay(null)} />}
    </>
  );
}

export interface AppProps {
  source: StageSource;
  /** Builds the run storage; it receives the callback to call on the first write failure. Defaults to `localStorage`. */
  makeStorage?: (onError: (e: unknown) => void) => RunStorage;
}

// The dev bench is loaded on demand so its templates, decks and positions stay out of the game's bundle.
const Bench = lazy(() => import('./screens/Bench').then((m) => ({ default: m.Bench })));

export function App({ source, makeStorage = localStorageRunStorage }: AppProps) {
  const [storageFailed, setStorageFailed] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [storage] = useState(() => makeStorage(() => setStorageFailed(true)));
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const onChange = (): void => setHash(window.location.hash);
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  if (hash === '#bench') {
    return (
      <Suspense fallback={<p>Loading the bench...</p>}>
        <Bench source={source} />
      </Suspense>
    );
  }
  return (
    <RunProvider source={source} storage={storage}>
      {storageFailed && !dismissed && (
        <div className="banner" role="alert">
          Saving is unavailable in this browser; this run will be lost when the tab closes.
          {' '}
          <button type="button" onClick={() => setDismissed(true)}>Dismiss</button>
        </div>
      )}
      <Screens />
    </RunProvider>
  );
}
