import { useState } from 'react';
import { loadSave } from '@checkbreaker/run';
import { runConfig } from '../config';
import { saveErrorText } from '../messages';
import { reducedMotion, useReducedMotion } from '../settings';
import { useRun } from '../state/store';

export function Title() {
  const { dispatch, dev, storage, error } = useRun();
  const motion = useReducedMotion();
  // Read once when the screen opens: a damaged save is reported once, and New run (which overwrites it) clears it.
  const [saved, setSaved] = useState(() => {
    const text = storage.read();
    return text === null ? null : loadSave(text, runConfig);
  });
  const [asking, setAsking] = useState(false);
  const [seed, setSeed] = useState('');
  const [seedBad, setSeedBad] = useState(false);
  const valid = saved?.ok ? saved.value : null;

  const startNew = (): void => {
    setAsking(false);
    const text = seed.trim().toUpperCase();
    if (text !== '' && !/^[0-9A-F]{4}-[0-9A-F]{4}$/.test(text)) { setSeedBad(true); return; }
    setSeedBad(false);
    setSaved(null);
    dispatch(text === '' ? { type: 'new_run' } : { type: 'new_run', seed: text });
  };

  return (
    <main className="screen title" data-testid="title-screen">
      <h1>Checkbreaker</h1>
      {valid && (
        <p>
          <button type="button" className="start" onClick={() => dispatch({ type: 'continue' })}>
            Continue: act {valid.run.actIndex + 1}, stage {valid.run.stageIndex + 1}, {valid.run.coins} coins
          </button>
          {valid.debug && <strong className="debug-flag"> DEBUG RUN</strong>}
        </p>
      )}
      <p>
        <label>
          Seed (optional){' '}
          <input type="text" value={seed} placeholder="XXXX-XXXX" maxLength={9} autoComplete="off" spellCheck={false}
            aria-invalid={seedBad} onChange={(e) => { setSeed(e.target.value); setSeedBad(false); }} />
        </label>
        {seedBad && <span role="alert" className="error"> A seed looks like 7F3A-2210 (eight hex digits).</span>}
      </p>
      {saved && !saved.ok && <p role="alert" className="error">{saveErrorText(saved.error)}</p>}
      <p>
        <button type="button" className={valid ? '' : 'start'} onClick={() => (valid ? setAsking(true) : startNew())}>New run</button>
      </p>
      {error && <p role="alert" className="error">{error}</p>}
      <fieldset className="settings">
        <legend>Settings</legend>
        <label>
          <input type="checkbox" role="switch" checked={dev} onChange={(e) => dispatch({ type: 'set_dev', on: e.target.checked })} />
          {' '}Developer tools
        </label>
        <br />
        <label>
          <input type="checkbox" role="switch" checked={motion} onChange={(e) => reducedMotion.write(e.target.checked)} />
          {' '}Reduce motion
        </label>
        {' '}
        <button type="button" onClick={() => reducedMotion.write(null)}>Use system setting</button>
      </fieldset>
      {asking && (
        <div className="confirm" role="dialog" aria-modal="true" aria-label="Replace saved run">
          <p>A run is in progress. Starting a new run replaces it and cannot be undone.</p>
          <button type="button" autoFocus onClick={() => setAsking(false)}>Cancel</button>
          {' '}
          <button type="button" onClick={startNew}>Replace the saved run</button>
        </div>
      )}
    </main>
  );
}
