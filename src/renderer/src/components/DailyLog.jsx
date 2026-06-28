import { useState, useEffect, useCallback } from 'react'
import { todayLocal } from '../utils'

const TARGETS = {
  low_cal: { calMin: 900,  calMax: 1100, label: 'Low-Cal Day',  color: '#5bc8f5' },
  normal:  { calMin: 1950, calMax: 2200, label: 'Normal Day',   color: '#f5a623' }
}
const PROTEIN_MIN = 140
const PROTEIN_MAX = 160
const BEER_CAL = 180

function formatDate(d) {
  return new Date(d + 'T12:00:00').toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  })
}

function StatusBadge({ value, min, max, unit = '' }) {
  if (value === null || value === undefined || value === '') return null
  const v = parseFloat(value)
  let color = '#7cfc7c', status = '✓'
  if (v < min)  { color = '#f5a623'; status = '↑ low' }
  else if (v > max) { color = '#ff6b6b'; status = '↑ high' }
  return (
    <span style={{
      fontSize: 11, padding: '2px 7px', borderRadius: 10,
      background: color + '22', color, fontWeight: 600
    }}>
      {v}{unit} {status}
    </span>
  )
}

function Field({ label, hint, children }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <label style={{ display: 'block', fontSize: 12, color: '#8080a0', marginBottom: 5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {label}
      </label>
      {hint && <div style={{ fontSize: 11, color: '#505070', marginBottom: 5 }}>{hint}</div>}
      {children}
    </div>
  )
}

const inputStyle = {
  width: '100%', padding: '9px 12px', background: '#1e1e35',
  border: '1px solid #2e2e4e', borderRadius: 7, color: '#e8e8f0',
  fontSize: 14, outline: 'none'
}

export default function DailyLog() {
  const [date, setDate]   = useState(todayLocal())
  const [form, setForm]   = useState({ day_type: 'normal', calories: '', protein: '', steps: '', workout: '', beers: '', notes: '' })
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(false)

  const loadLog = useCallback(async (d) => {
    setLoading(true)
    const log = await window.api.getLog(d)
    if (log) {
      setForm({ day_type: log.day_type || 'normal', calories: log.calories ?? '', protein: log.protein ?? '',
        steps: log.steps ?? '', workout: log.workout ?? '', beers: log.beers ?? '', notes: log.notes ?? '' })
    } else {
      setForm({ day_type: 'normal', calories: '', protein: '', steps: '', workout: '', beers: '', notes: '' })
    }
    setSaved(false); setLoading(false)
  }, [])

  useEffect(() => { loadLog(date) }, [date, loadLog])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  async function handleSave() {
    await window.api.saveLog({
      date, day_type: form.day_type,
      calories: parseInt(form.calories) || 0,
      protein:  parseInt(form.protein)  || 0,
      steps:    parseInt(form.steps)    || 0,
      workout:  form.workout || '',
      beers:    parseFloat(form.beers)  || 0,
      notes:    form.notes || ''
    })
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  const target = TARGETS[form.day_type]
  const cal = parseInt(form.calories) || 0
  const protein = parseInt(form.protein) || 0
  const beers = parseFloat(form.beers) || 0
  const beerCals = Math.round(beers * BEER_CAL)
  const calFromFood = cal - beerCals
  const calPct = Math.min(100, Math.round((cal / target.calMax) * 100))
  const barColor = (cal >= target.calMin && cal <= target.calMax) ? '#7cfc7c' : cal > target.calMax ? '#ff6b6b' : '#f5a623'

  return (
    <div style={{ maxWidth: 640 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#e8e8f0' }}>Daily Log</h1>
          <div style={{ fontSize: 13, color: '#606080', marginTop: 3 }}>{formatDate(date)}</div>
        </div>
        <input type="date" value={date} onChange={e => setDate(e.target.value)}
          style={{ ...inputStyle, width: 'auto', fontSize: 13 }} />
      </div>

      {loading ? <div style={{ color: '#606080' }}>Loading…</div> : (
        <>
          <div style={{ display: 'flex', gap: 10, marginBottom: 24 }}>
            {Object.entries(TARGETS).map(([key, t]) => (
              <button key={key} onClick={() => set('day_type', key)} style={{
                flex: 1, padding: '12px 0', borderRadius: 10, cursor: 'pointer',
                border: `2px solid ${form.day_type === key ? t.color : '#2a2a45'}`,
                background: form.day_type === key ? t.color + '22' : '#16162a',
                color: form.day_type === key ? t.color : '#606080',
                fontWeight: 600, fontSize: 14, transition: 'all 0.15s'
              }}>
                <div>{t.label}</div>
                <div style={{ fontSize: 11, fontWeight: 400, marginTop: 2 }}>{t.calMin}–{t.calMax} kcal</div>
              </button>
            ))}
          </div>

          <div style={{ marginBottom: 24, background: '#16162a', borderRadius: 10, padding: '14px 16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#8080a0', marginBottom: 8 }}>
              <span>Calories: <strong style={{ color: barColor }}>{cal} kcal</strong></span>
              <span>Target: {target.calMin}–{target.calMax}</span>
            </div>
            <div style={{ height: 8, background: '#2a2a45', borderRadius: 4, overflow: 'hidden' }}>
              <div style={{ width: `${calPct}%`, height: '100%', background: barColor, borderRadius: 4, transition: 'width 0.3s' }} />
            </div>
            {beers > 0 && (
              <div style={{ fontSize: 11, color: '#606080', marginTop: 6 }}>
                🍺 Beer: {beerCals} kcal · Food: {calFromFood} kcal
              </div>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 20px' }}>
            <Field label="Calories" hint={`Target: ${target.calMin}–${target.calMax} kcal`}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="number" min="0" max="5000" value={form.calories}
                  onChange={e => set('calories', e.target.value)} placeholder="e.g. 1800" style={inputStyle} />
                <StatusBadge value={form.calories} min={target.calMin} max={target.calMax} unit=" kcal" />
              </div>
            </Field>
            <Field label="Protein" hint="Target: 140–160 g">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="number" min="0" max="400" value={form.protein}
                  onChange={e => set('protein', e.target.value)} placeholder="e.g. 150" style={inputStyle} />
                <StatusBadge value={form.protein} min={PROTEIN_MIN} max={PROTEIN_MAX} unit="g" />
              </div>
            </Field>
            <Field label="Steps" hint="Aim for 8,000+">
              <input type="number" min="0" max="60000" value={form.steps}
                onChange={e => set('steps', e.target.value)} placeholder="e.g. 9200" style={inputStyle} />
            </Field>
            <Field label="🍺 Beers" hint={`~${BEER_CAL} kcal each`}>
              <input type="number" min="0" max="20" step="0.5" value={form.beers}
                onChange={e => set('beers', e.target.value)} placeholder="0" style={inputStyle} />
            </Field>
          </div>

          <Field label="Workout">
            <input type="text" value={form.workout} onChange={e => set('workout', e.target.value)}
              placeholder="e.g. 5km run, strength 45min, rest day…" style={inputStyle} />
          </Field>
          <Field label="Notes">
            <textarea value={form.notes} onChange={e => set('notes', e.target.value)}
              placeholder="How are you feeling? Anything to flag…"
              rows={3} style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }} />
          </Field>

          {(form.calories || form.protein || form.steps) && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
              {form.calories && <StatusBadge value={form.calories} min={target.calMin} max={target.calMax} unit=" kcal" />}
              {form.protein  && <StatusBadge value={form.protein}  min={PROTEIN_MIN} max={PROTEIN_MAX} unit="g protein" />}
              {form.steps && parseInt(form.steps) >= 8000 && (
                <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 10, background: '#7cfc7c22', color: '#7cfc7c', fontWeight: 600 }}>
                  {parseInt(form.steps).toLocaleString()} steps ✓
                </span>
              )}
            </div>
          )}

          <button onClick={handleSave} style={{
            padding: '12px 32px', borderRadius: 8, cursor: 'pointer',
            background: saved ? '#7cfc7c22' : '#7cfc7c',
            color: saved ? '#7cfc7c' : '#0f0f1a',
            border: saved ? '1px solid #7cfc7c' : 'none',
            fontSize: 14, fontWeight: 700, transition: 'all 0.2s'
          }}>
            {saved ? '✓ Saved!' : 'Save Log'}
          </button>
        </>
      )}
    </div>
  )
}
