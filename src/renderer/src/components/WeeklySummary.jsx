import { useState, useEffect } from 'react'
import { todayLocal, dateToLocal } from '../utils'

function getMondayOfWeek(dateStr) {
  const d = new Date(dateStr + 'T12:00:00')
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  return dateToLocal(d)
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00')
  d.setDate(d.getDate() + n)
  return dateToLocal(d)
}

function formatDate(d) {
  return new Date(d + 'T12:00:00').toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short'
  })
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const TARGETS = {
  low_cal: { calMin: 900,  calMax: 1100, label: 'Low-Cal', color: '#5bc8f5' },
  normal:  { calMin: 1950, calMax: 2200, label: 'Normal',  color: '#f5a623' }
}

export default function WeeklySummary() {
  const [weekStart, setWeekStart] = useState(getMondayOfWeek(todayLocal()))
  const [summary, setSummary]     = useState(null)
  const [loading, setLoading]     = useState(false)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const data = await window.api.getWeeklySummary(weekStart)
      setSummary(data)
      setLoading(false)
    }
    load()
  }, [weekStart])

  const weekEnd = addDays(weekStart, 6)

  function goWeek(n) {
    const d = new Date(weekStart + 'T12:00:00')
    d.setDate(d.getDate() + n * 7)
    setWeekStart(dateToLocal(d))
  }

  const statCard = (label, value, sub, color = '#e8e8f0') => (
    <div style={{ background: '#16162a', border: '1px solid #2a2a45', borderRadius: 10, padding: '14px 16px' }}>
      <div style={{ fontSize: 11, color: '#606080', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color }}>{value ?? '—'}</div>
      {sub && <div style={{ fontSize: 11, color: '#505070', marginTop: 3 }}>{sub}</div>}
    </div>
  )

  return (
    <div style={{ maxWidth: 820 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#e8e8f0', marginBottom: 4 }}>Weekly Review</h1>
          <div style={{ fontSize: 13, color: '#606080' }}>
            {formatDate(weekStart)} – {formatDate(weekEnd)}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={() => goWeek(-1)} style={{ padding: '7px 14px', borderRadius: 7, background: '#1e1e35', border: '1px solid #2e2e4e', color: '#e8e8f0', cursor: 'pointer', fontSize: 14 }}>
            ←
          </button>
          <button onClick={() => setWeekStart(getMondayOfWeek(todayLocal()))} style={{ padding: '7px 14px', borderRadius: 7, background: '#1e1e35', border: '1px solid #2e2e4e', color: '#8080a0', cursor: 'pointer', fontSize: 12 }}>
            This week
          </button>
          <button onClick={() => goWeek(1)} style={{ padding: '7px 14px', borderRadius: 7, background: '#1e1e35', border: '1px solid #2e2e4e', color: '#e8e8f0', cursor: 'pointer', fontSize: 14 }}>
            →
          </button>
        </div>
      </div>

      {loading && <div style={{ color: '#606080', padding: 40, textAlign: 'center' }}>Loading…</div>}

      {!loading && !summary && (
        <div style={{ background: '#16162a', border: '1px solid #2a2a45', borderRadius: 12, padding: 40, textAlign: 'center', color: '#606080' }}>
          No logs found for this week.
        </div>
      )}

      {!loading && summary && (() => {
        const t = TARGETS[summary.logs[0]?.day_type || 'normal']
        const weightColor = summary.weightChange === null ? '#8080a0'
          : summary.weightChange < 0 ? '#7cfc7c' : '#ff6b6b'
        const weightSign  = summary.weightChange > 0 ? '+' : ''

        // Build day grid
        const logsByDate = {}
        summary.logs.forEach(l => { logsByDate[l.date] = l })

        return (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
              {statCard('Avg calories', summary.avgCal ? `${summary.avgCal} kcal` : null)}
              {statCard('Avg protein',  summary.avgProtein ? `${summary.avgProtein} g` : null, 'Target 140–160 g', summary.avgProtein >= 140 && summary.avgProtein <= 160 ? '#7cfc7c' : '#f5a623')}
              {statCard('Weight change', summary.weightChange !== null ? `${weightSign}${summary.weightChange} kg` : null, 'Mon vs Sun', weightColor)}
              {statCard('Workouts', summary.totalWorkouts, `${summary.totalDays} days logged`)}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 28 }}>
              {statCard('Avg steps', summary.avgSteps ? summary.avgSteps.toLocaleString() : null, 'Aim 8,000+', summary.avgSteps >= 8000 ? '#7cfc7c' : '#f5a623')}
              {statCard('Low-cal days', summary.lowCalDays, `of ${summary.totalDays} logged`)}
              {statCard('🍺 Beers', summary.totalBeers || 0, 'total this week', summary.totalBeers > 7 ? '#ff6b6b' : summary.totalBeers > 3 ? '#f5a623' : '#7cfc7c')}
            </div>

            <h3 style={{ fontSize: 13, fontWeight: 600, color: '#8080a0', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>Day by Day</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 8, marginBottom: 28 }}>
              {DAY_LABELS.map((label, i) => {
                const date = addDays(weekStart, i)
                const log  = logsByDate[date]
                const tgt  = log ? TARGETS[log.day_type] : null
                const calOk = log && log.calories >= tgt.calMin && log.calories <= tgt.calMax
                const calOver = log && log.calories > tgt.calMax
                const dayColor = !log ? '#2a2a45' : calOk ? '#7cfc7c22' : calOver ? '#ff6b6b22' : '#f5a62322'
                const borderColor = !log ? '#2a2a45' : calOk ? '#7cfc7c' : calOver ? '#ff6b6b' : '#f5a623'
                return (
                  <div key={i} style={{ background: dayColor, border: `1px solid ${borderColor}`, borderRadius: 8, padding: '10px 8px', textAlign: 'center' }}>
                    <div style={{ fontSize: 10, color: '#8080a0', fontWeight: 600, marginBottom: 4 }}>{label}</div>
                    <div style={{ fontSize: 10, color: '#606080', marginBottom: 6 }}>{date.slice(5)}</div>
                    {log ? (
                      <>
                        <div style={{ fontSize: 12, fontWeight: 700, color: borderColor }}>{log.calories || '—'}</div>
                        <div style={{ fontSize: 9, color: '#606080', marginTop: 2 }}>kcal</div>
                        {log.protein > 0 && <div style={{ fontSize: 9, color: '#8080a0', marginTop: 3 }}>{log.protein}g P</div>}
                        {log.workout && <div style={{ fontSize: 8, color: '#5bc8f5', marginTop: 3, wordBreak: 'break-word', lineHeight: 1.2 }}>{log.workout.slice(0, 20)}</div>}
                        {log.beers > 0 && <div style={{ fontSize: 9, color: '#f5a623', marginTop: 2 }}>🍺 {log.beers}</div>}
                      </>
                    ) : (
                      <div style={{ fontSize: 10, color: '#404060', marginTop: 8 }}>no log</div>
                    )}
                  </div>
                )
              })}
            </div>

            {summary.logs.some(l => l.notes) && (
              <>
                <h3 style={{ fontSize: 13, fontWeight: 600, color: '#8080a0', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>Notes</h3>
                <div style={{ background: '#16162a', border: '1px solid #2a2a45', borderRadius: 10, overflow: 'hidden', marginBottom: 24 }}>
                  {summary.logs.filter(l => l.notes).map((l, i, arr) => (
                    <div key={l.id} style={{ padding: '10px 16px', borderBottom: i < arr.length - 1 ? '1px solid #2a2a45' : 'none' }}>
                      <span style={{ fontSize: 11, color: '#606080', marginRight: 10 }}>{l.date}</span>
                      <span style={{ fontSize: 13, color: '#e8e8f0' }}>{l.notes}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )
      })()}
    </div>
  )
}
