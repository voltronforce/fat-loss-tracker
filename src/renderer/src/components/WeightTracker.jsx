import { useState, useEffect } from 'react'
import { todayLocal, dateToLocal } from '../utils'
import {
  ComposedChart, Line, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ReferenceLine, ResponsiveContainer
} from 'recharts'

const GOAL_WEIGHT = 75
const GOAL_DATE   = '2026-09-30'

function rollingAverage(data, window = 7) {
  return data.map((d, i) => {
    const slice = data.slice(Math.max(0, i - window + 1), i + 1)
    const avg = slice.reduce((s, x) => s + x.weight, 0) / slice.length
    return { ...d, rolling7: parseFloat(avg.toFixed(2)) }
  })
}

function linearRegression(data) {
  if (data.length < 2) return data
  const t0 = new Date(data[0].date).getTime()
  const xs = data.map(d => (new Date(d.date).getTime() - t0) / 86_400_000)
  const ys = data.map(d => d.weight)
  const n = data.length
  const sx = xs.reduce((a,b) => a+b, 0), sy = ys.reduce((a,b) => a+b, 0)
  const sxy = xs.reduce((s,x,i) => s+x*ys[i], 0), sxx = xs.reduce((s,x) => s+x*x, 0)
  const denom = n*sxx - sx*sx
  if (denom === 0) return data.map(d => ({ ...d, trend: d.weight }))
  const slope = (n*sxy - sx*sy) / denom
  const intercept = (sy - slope*sx) / n
  return data.map((d, i) => ({ ...d, trend: parseFloat((intercept + slope*xs[i]).toFixed(2)) }))
}

function daysBetween(a, b) {
  return Math.round((new Date(b) - new Date(a)) / 86400000)
}

const inputStyle = {
  padding: '9px 12px', background: '#1e1e35', border: '1px solid #2e2e4e',
  borderRadius: 7, color: '#e8e8f0', fontSize: 14, outline: 'none'
}

export default function WeightTracker() {
  const [logs, setLogs]       = useState([])
  const [newDate, setNewDate] = useState(todayLocal())
  const [newWeight, setNewWeight] = useState('')
  const [saved, setSaved]     = useState(false)
  const [period, setPeriod]   = useState(90)

  async function load() {
    const data = await window.api.getWeightLogs(period)
    setLogs([...data].sort((a, b) => a.date.localeCompare(b.date)))
  }
  useEffect(() => { load() }, [period])

  async function handleSave() {
    if (!newWeight) return
    await window.api.saveWeight(newDate, parseFloat(newWeight))
    setNewWeight(''); setSaved(true)
    setTimeout(() => setSaved(false), 2000)
    load()
  }

  async function handleDelete(id) { await window.api.deleteWeight(id); load() }

  const chartData = linearRegression(rollingAverage(logs))
  const latest = logs.length > 0 ? logs[logs.length - 1].weight : null
  const toGo   = latest ? parseFloat((latest - GOAL_WEIGHT).toFixed(2)) : null

  // Date-accurate slope for estimated finish
  let estFinish = null
  if (chartData.length >= 4) {
    const lookback = Math.min(14, chartData.length)
    const slice = chartData.slice(-lookback)
    const t0 = new Date(slice[0].date).getTime()
    const xs = slice.map(d => (new Date(d.date).getTime() - t0) / 86_400_000)
    const ys = slice.map(d => d.weight)
    const n = slice.length
    const sx = xs.reduce((a,b)=>a+b,0), sy = ys.reduce((a,b)=>a+b,0)
    const sxy = xs.reduce((s,x,i)=>s+x*ys[i],0), sxx = xs.reduce((s,x)=>s+x*x,0)
    const denom = n*sxx - sx*sx
    if (denom !== 0) {
      const slopePerDay = (n*sxy - sx*sy) / denom
      if (slopePerDay < 0 && latest > GOAL_WEIGHT) {
        const daysToGoal = (GOAL_WEIGHT - latest) / slopePerDay
        const est = new Date(); est.setDate(est.getDate() + Math.round(daysToGoal))
        estFinish = dateToLocal(est)
      }
    }
  }

  const daysLeft = daysBetween(todayLocal(), GOAL_DATE)
  const requiredLoss = latest ? (latest - GOAL_WEIGHT) : null
  const requiredWeekly = requiredLoss && daysLeft > 0
    ? parseFloat((requiredLoss / (daysLeft / 7)).toFixed(2)) : null

  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null
    return (
      <div style={{ background: '#1e1e35', border: '1px solid #2e2e4e', borderRadius: 8, padding: '10px 14px', fontSize: 12 }}>
        <div style={{ color: '#8080a0', marginBottom: 6 }}>{label}</div>
        {payload.map(p => (
          <div key={p.name} style={{ color: p.color, marginBottom: 2 }}>{p.name}: <strong>{p.value} kg</strong></div>
        ))}
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 820 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: '#e8e8f0', marginBottom: 6 }}>Weight Tracker</h1>
      <div style={{ fontSize: 13, color: '#606080', marginBottom: 24 }}>Goal: {GOAL_WEIGHT} kg by {GOAL_DATE}</div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 28 }}>
        {[
          { label: 'Current',     value: latest ? `${latest} kg` : '—', color: '#e8e8f0' },
          { label: 'To Goal',     value: toGo   ? `${toGo} kg`   : '—', color: toGo > 0 ? '#f5a623' : '#7cfc7c' },
          { label: 'Need / week', value: requiredWeekly ? `${requiredWeekly} kg` : '—', color: '#5bc8f5' },
          { label: 'Est. finish', value: estFinish || '—', color: estFinish && estFinish <= GOAL_DATE ? '#7cfc7c' : '#ff6b6b' }
        ].map(({ label, value, color }) => (
          <div key={label} style={{ background: '#16162a', border: '1px solid #2a2a45', borderRadius: 10, padding: '14px 16px' }}>
            <div style={{ fontSize: 11, color: '#606080', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>{label}</div>
            <div style={{ fontSize: 20, fontWeight: 700, color }}>{value}</div>
          </div>
        ))}
      </div>

      <div style={{ background: '#16162a', border: '1px solid #2a2a45', borderRadius: 10, padding: '16px 18px', marginBottom: 28, display: 'flex', gap: 12, alignItems: 'flex-end' }}>
        <div>
          <label style={{ display: 'block', fontSize: 11, color: '#8080a0', marginBottom: 5, textTransform: 'uppercase', letterSpacing: 0.5 }}>Date</label>
          <input type="date" value={newDate} onChange={e => setNewDate(e.target.value)} style={inputStyle} />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 11, color: '#8080a0', marginBottom: 5, textTransform: 'uppercase', letterSpacing: 0.5 }}>Weight (kg)</label>
          <input type="number" min="50" max="200" step="0.1" value={newWeight}
            onChange={e => setNewWeight(e.target.value)} placeholder="e.g. 83.4"
            style={{ ...inputStyle, width: 120 }}
            onKeyDown={e => e.key === 'Enter' && handleSave()} />
        </div>
        <button onClick={handleSave} style={{
          padding: '9px 20px', borderRadius: 7, cursor: 'pointer',
          background: saved ? '#7cfc7c22' : '#7cfc7c',
          color: saved ? '#7cfc7c' : '#0f0f1a',
          border: saved ? '1px solid #7cfc7c' : 'none', fontWeight: 600, fontSize: 13
        }}>
          {saved ? '✓ Saved' : '+ Log'}
        </button>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {[30, 60, 90, 180].map(d => (
          <button key={d} onClick={() => setPeriod(d)} style={{
            padding: '5px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 12,
            background: period === d ? '#2a2a50' : 'transparent',
            color: period === d ? '#e8e8f0' : '#606080',
            border: `1px solid ${period === d ? '#5a5a90' : '#2a2a45'}`
          }}>{d}d</button>
        ))}
      </div>

      {chartData.length > 0 ? (
        <div style={{ background: '#16162a', border: '1px solid #2a2a45', borderRadius: 12, padding: '20px 8px 8px', marginBottom: 28 }}>
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={chartData} margin={{ left: 0, right: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a2a45" />
              <XAxis dataKey="date" tick={{ fill: '#606080', fontSize: 11 }} tickFormatter={d => d.slice(5)} interval="preserveStartEnd" />
              <YAxis domain={['auto','auto']} tick={{ fill: '#606080', fontSize: 11 }} tickFormatter={v => `${v}kg`} width={48} />
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ fontSize: 12, color: '#8080a0' }} />
              <ReferenceLine y={GOAL_WEIGHT} stroke="#ff6b6b" strokeDasharray="6 3" label={{ value: 'Goal 75kg', fill: '#ff6b6b', fontSize: 11 }} />
              <Area type="monotone" dataKey="weight" name="Weight" stroke="#5bc8f5" fill="#5bc8f522" strokeWidth={2} dot={{ fill: '#5bc8f5', r: 3 }} />
              <Line type="monotone" dataKey="rolling7" name="7-day avg" stroke="#f5a623" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="trend" name="Trend" stroke="#7cfc7c" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div style={{ background: '#16162a', border: '1px solid #2a2a45', borderRadius: 12, padding: 40, textAlign: 'center', color: '#606080', marginBottom: 28 }}>
          No weight data yet. Log your first weigh-in above.
        </div>
      )}

      {logs.length > 0 && (
        <div>
          <h3 style={{ fontSize: 14, fontWeight: 600, color: '#8080a0', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>Recent Entries</h3>
          <div style={{ background: '#16162a', border: '1px solid #2a2a45', borderRadius: 10, overflow: 'hidden' }}>
            {[...logs].reverse().slice(0, 15).map((l, i) => (
              <div key={l.id} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '10px 16px', borderBottom: i < 14 ? '1px solid #2a2a45' : 'none'
              }}>
                <div>
                  <span style={{ fontSize: 13, color: '#e8e8f0' }}>{l.date}</span>
                  {l.source !== 'manual' && <span style={{ fontSize: 10, color: '#606080', marginLeft: 8 }}>{l.source}</span>}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  <span style={{ fontSize: 16, fontWeight: 700, color: '#5bc8f5' }}>{l.weight} kg</span>
                  {l.source === 'manual' && (
                    <button onClick={() => handleDelete(l.id)}
                      style={{ background: 'none', border: 'none', color: '#404060', cursor: 'pointer', fontSize: 14 }}
                      title="Delete">✕</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
