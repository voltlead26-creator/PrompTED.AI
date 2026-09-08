// Isolated browser fixture for the actual shared component. It deliberately has
// no provider, authentication or persistence adapter and is never an app route.
import React, { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { TedChangeReview } from '../../components/organisms/TedChangeReview';
import '../../design-system/tokens.css';

declare global {
  interface Window { releaseTeditBrowserAction?: () => void }
}

function Harness() {
  const toolbar = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [applied, setApplied] = useState(0);
  const [retries, setRetries] = useState(0);
  const [discards, setDiscards] = useState(0);
  const [failDiscard, setFailDiscard] = useState(false);
  const suggestion = Array.from({ length: 50 }, (_, i) => `Suggested paragraph ${i + 1}: synthetic wording for keyboard and viewport acceptance.`).join('\n\n');
  return <main style={{ fontFamily: 'system-ui, sans-serif', color: '#2B2521', background: '#F7F1E7', padding: 16 }}>
    <h1>Long checklist fixture</h1>
    <label><input type="checkbox" checked={failDiscard} onChange={event => setFailDiscard(event.target.checked)} />Simulate discard failure</label>
    <p data-testid="counts">{JSON.stringify({ applied, retries, discards })}</p>
    <div style={{ height: 4200 }}>Original wording remains unchanged until explicit acceptance.</div>
    {pending && <TedChangeReview suggested={suggestion} changes={['Preserved the original scope.', 'Proposed clearer wording.']}
      explanation="Review the suggested wording. This synthetic fixture does not save a document."
      notice={notice} returnFocusRef={toolbar}
      onApply={async () => {
        setApplied(value => value + 1);
        await new Promise<void>(resolve => { window.releaseTeditBrowserAction = resolve; });
        delete window.releaseTeditBrowserAction;
        setNotice('Change could not be saved. Your suggestion is still available to retry.');
      }}
      onRetry={async () => { setRetries(value => value + 1); setNotice(null); await Promise.resolve(); }}
      onDiscard={async () => { setDiscards(value => value + 1); await Promise.resolve(); if (failDiscard) throw new Error('Synthetic discard failure'); setPending(false); setNotice(null); }} />}
    <div ref={toolbar} role="toolbar" aria-label="Edit fixture item" tabIndex={-1}
      style={{ position: 'fixed', bottom: 12, left: 16, right: 16, padding: 12, background: '#FFFDF8', border: '1px solid #D8CCB7' }}>
      <button type="button" disabled={pending} onClick={() => { setNotice(null); setPending(true); }}>tEdit</button>
      <button type="button" onClick={() => setApplied(value => value + 100)}>Background action</button>
    </div>
  </main>;
}

const root = document.getElementById('root');
if (!root) throw new Error('Missing local acceptance root');
createRoot(root).render(<Harness />);
