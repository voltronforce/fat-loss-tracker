import { useState, useEffect, useRef } from 'react'

function ProgressBar({ pct, color = '#7cfc7c' }) {
  return (
    <div style={{ height: 8, background: '#2a2a45', borderRadius: 4, overflow: 'hidden', margin: '8px 0' }}>
      <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 4, transition: 'width 0.3s' }} />
    </div>
  )
}

function StatChip({ label, value, color = '#5bc8f5' }) {
  return (
    <div style={{ background: '#1e1e35', border: '1px solid #2a2a45', borderRadius: 8, padding: '10px 14px', textAlign: 'center' }}>
      <div style={{ fontSize: 20, fontWeight: 700, color }}>{value ?? '—'}</div>
      <div style={{ fontSize: 11, color: '#606080', marginTop: 2 }}>{label}</div>
    </div>
  )
}

export default function HealthImport() {
  const [status, setStatus]       = useState('idle')  // idle | picking | importing | done | error
  const [progress, setProgress]   = useState(null)
  const [result, setResult]       = useState(null)
  const [errorMsg, setErrorMsg]   = useState(null)
  const [linesRead, setLinesRead] = useState(0)
  const unsubRef = useRef(null)

  useEffect(() => {
    unsubRef.current = window.api.onImportProgress((data) => {
      setProgress(data)
      if (data.stage === 'reading' && data.linesRead != null) setLinesRead(data.linesRead)
      if (data.stage === 'done')  { setStatus('done');  setResult(data.stats) }
      if (data.stage === 'error') { setStatus('error'); setErrorMsg(data.error) }
    })
    return () => { if (unsubRef.current) unsubRef.current() }
  }, [])

  async function handleImport() {
    setStatus('picking')
    setResult(null); setErrorMsg(null); setLinesRead(0); setProgress(null)

    const { canceled, filePaths } = await window.api.openFileDialog()
    if (canceled || !filePaths?.length) { setStatus('idle'); return }

    const filePath = filePaths[0]
    setStatus('importing')

    const res = await window.api.importHealthXML(filePath)
    if (!res.success && status !== 'done') {
      setStatus('error')
      setErrorMsg(res.error || 'Unknown error')
    }
  }

  function reset() {
    setStatus('idle'); setProgress(null); setResult(null)
    setErrorMsg(null); setLinesRead(0)
  }

  const stageLabel = {
    opening_zip: 'Opening ZIP archive…',
    reading:     'Streaming export.xml…',
    saving:      'Writing to database…',
    done:        'Import complete!',
    error:       'Import failed'
  }[progress?.stage] ?? 'Starting…'

  return (
    <div style={{ maxWidth: 640 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: '#e8e8f0', marginBottom: 6 }}>Import Apple Health</h1>
      <p style={{ fontSize: 13, color: '#606080', lineHeight: 1.6, marginBottom: 24 }}>
        Import your Apple Health export to sync weight history, steps, and workouts.
        Accepts either the raw <code style={{ color: '#5bc8f5' }}>export.xml</code> or the
        full <code style={{ color: '#5bc8f5' }}>export.zip</code> from the Health app.
      </p>

      <div style={{ background: '#16162a', border: '1px solid #2a2a45', borderRadius: 12, padding: '20px 24px', marginBottom: 24 }}>
        <h3 style={{ fontSize: 13, fontWeight: 600, color: '#8080a0', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 }}>How to export</h3>
        {[
          'Open the Health app on your iPhone',
          'Tap your profile photo → Export All Health Data',
          'Save / AirDrop the resulting export.zip to your Mac',
          'Click Import below and select the file'
        ].map((step, i) => (
          <div key={i} style={{ display: 'flex', gap: 12, marginBottom: 8, alignItems: 'flex-start' }}>
            <div style={{ width: 20, height: 20, borderRadius: '50%', background: '#2a2a50', color: '#5bc8f5', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>
              {i + 1}
            </div>
            <div style={{ fontSize: 13, color: '#a0a0c0', lineHeight: 1.5 }}>{step}</div>
          </div>
        ))}
      </div>

      {status === 'idle' && (
        <button onClick={handleImport} style={{
          padding: '13px 28px', borderRadius: 9, cursor: 'pointer',
          background: '#7cfc7c', color: '#0f0f1a',
          border: 'none', fontSize: 14, fontWeight: 700
        }}>
          📥 Select & Import File
        </button>
      )}

      {status === 'picking' && (
        <div style={{ color: '#8080a0', fontSize: 13, padding: '12px 0' }}>Waiting for file selection…</div>
      )}

      {status === 'importing' && (
        <div style={{ background: '#16162a', border: '1px solid #2a2a45', borderRadius: 12, padding: '20px 24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <span style={{ fontSize: 13, color: '#e8e8f0', fontWeight: 600 }}>{stageLabel}</span>
            {linesRead > 0 && (
              <span style={{ fontSize: 11, color: '#606080' }}>{(linesRead / 1_000_000).toFixed(1)}M lines</span>
            )}
          </div>
          <ProgressBar
            pct={progress?.stage === 'saving' ? 90 : progress?.stage === 'opening_zip' ? 5 : Math.min(80, linesRead / 30_000)}
            color="#5bc8f5"
          />
          <div style={{ fontSize: 11, color: '#505070', marginTop: 6 }}>
            Large exports (2–3 GB) may take 1–2 minutes. Don't close the app.
          </div>
        </div>
      )}

      {status === 'done' && result && (
        <div>
          <div style={{ background: '#16162a', border: '1px solid #7cfc7c40', borderRadius: 12, padding: '20px 24px', marginBottom: 20 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#7cfc7c', marginBottom: 16 }}>✓ Import successful</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
              <StatChip label="Weight entries"   value={result.weight}         color="#5bc8f5" />
              <StatChip label="Days with steps"  value={result.steps}          color="#f5a623" />
              <StatChip label="Workouts"         value={result.workouts}       color="#c87fff" />
              <StatChip label="Active energy days" value={result.activeEnergyDays} color="#7cfc7c" />
            </div>
          </div>
          <button onClick={reset} style={{
            padding: '10px 22px', borderRadius: 8, cursor: 'pointer',
            background: '#1e1e35', border: '1px solid #2e2e4e',
            color: '#8080a0', fontSize: 13
          }}>
            Import another file
          </button>
        </div>
      )}

      {status === 'error' && (
        <div>
          <div style={{ background: '#16162a', border: '1px solid #ff6b6b40', borderRadius: 12, padding: '20px 24px', marginBottom: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#ff6b6b', marginBottom: 8 }}>✗ Import failed</div>
            <div style={{ fontSize: 13, color: '#a08080', fontFamily: 'monospace', background: '#1a1015', borderRadius: 6, padding: '10px 14px' }}>
              {errorMsg}
            </div>
          </div>
          <button onClick={reset} style={{
            padding: '10px 22px', borderRadius: 8, cursor: 'pointer',
            background: '#1e1e35', border: '1px solid #2e2e4e',
            color: '#8080a0', fontSize: 13
          }}>
            Try again
          </button>
        </div>
      )}

      <div style={{ marginTop: 32, padding: '16px 20px', background: '#16162a', border: '1px solid #2a2a45', borderRadius: 10 }}>
        <div style={{ fontSize: 11, color: '#505070', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Privacy</div>
        <div style={{ fontSize: 12, color: '#606080', lineHeight: 1.6 }}>
          All data is processed and stored locally on this machine. Nothing is uploaded or transmitted externally.
        </div>
      </div>
    </div>
  )
}
