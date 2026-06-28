import { useState, useEffect } from 'react'
import { todayLocal, dateToLocal } from '../utils'

// ---------------------------------------------------------------------------
// Constants — will move to Settings later
// ---------------------------------------------------------------------------
const GOAL_WEIGHT  = 75
const GOAL_DATE    = '2026-09-30'
const PROTEIN_MIN  = 140
const PROTEIN_MAX  = 160
const STEP_TARGET  = 8000
const BEER_CAL     = 180
const TARGETS = {
  low_cal: { calMin: 900,  calMax: 1100,  label: 'Low-Cal', color: '#5bc8f5' },
  normal:  { calMin: 1950, calMax: 2200,  label: 'Normal',  color: '#f5a623' }
}

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------
function getMondayLocal(dateStr) {
  const d = new Date(dateStr + 'T12:00:00')
  const day = d.getDay()
  d.setDate(d.getDate() - day + (day === 0 ? -6 : 1))
  return dateToLocal(d)
}

function daysUntil(dateStr) {
  return Math.max(0, Math.round((new Date(dateStr) - new Date()) / 86_400_000))
}

/** Deduplicate weight_logs by date, averaging multiple sources per day. */
function dedupeWeights(logs) {
  const map = {}
  for (const l of logs) {
    if (!map[l.date]) map[l.date] = []
    map[l.date].push(parseFloat(l.weight))
  }
  return Object.entries(map)
    .map(([date, ws]) => ({
      date,
      weight: parseFloat((ws.reduce((a, b) => a + b, 0) / ws.length).toFixed(2))
    }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

/** Rolling average of last n entries. */
function rollingAvg(sorted, n) {
  if (!sorted.length) return null
  const slice = sorted.slice(-n)
  return parseFloat((slice.reduce((s, d) => s + d.weight, 0) / slice.length).toFixed(2))
}

/** Linear regression slope (kg/day) over last `lookback` data points.
 *  Uses actual calendar days on the x-axis so the rate is accurate
 *  regardless of how often the user weighs in. */
function lrSlope(sorted, lookback = 14) {
  const data = sorted.slice(-lookback)
  if (data.length < 4) return null
  const n  = data.length
  const t0 = new Date(data[0].date).getTime()
  const xs = data.map(d => (new Date(d.date).getTime() - t0) / 86_400_000) // days from first
  const ys = data.map(d => d.weight)
  const sx  = xs.reduce((a, b) => a + b, 0)
  const sy  = ys.reduce((a, b) => a + b, 0)
  const sxy = xs.reduce((s, x, i) => s + x * ys[i], 0)
  const sxx = xs.reduce((s, x) => s + x * x, 0)
  const denom = n * sxx - sx * sx
  return denom === 0 ? null : (n * sxy - sx * sy) / denom
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------
function MiniBar({ label, value, min, max, unit = '', color = '#5bc8f5', fmt = (v) => v }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0
  const ok  = value >= min && value <= max
  const bar = ok ? '#7cfc7c' : value > max ? '#ff6b6b' : color
  return (
    <div style={{ marginBottom: 11 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#8080a0', marginBottom: 3 }}>
        <span>{label}</span>
        <span style={{ color: bar, fontWeight: 600 }}>{fmt(value)}{unit ? ' ' + unit : ''}</span>
      </div>
      <div style={{ height: 4, background: '#2a2a45', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: bar, borderRadius: 2, transition: 'width 0.4s' }} />
      </div>
    </div>
  )
}

function Stat({ label, value, color = '#e8e8f0', size = 17 }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: '#606080', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: size, fontWeight: 700, color }}>{value}</div>
    </div>
  )
}

function WeekPill({ label, value, ok, warn }) {
  const color = warn ? '#ff6b6b' : ok ? '#7cfc7c' : '#f5a623'
  return (
    <div style={{ background: '#1e1e35', borderRadius: 8, padding: '9px 12px' }}>
      <div style={{ fontSize: 10, color: '#606080', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 700, color }}>{value}</div>
    </div>
  )
}

function NavBtn({ children, onClick }) {
  return (
    <button onClick={onClick} style={{
      marginTop: 14, width: '100%', padding: '8px 0', borderRadius: 7, cursor: 'pointer',
      background: '#2a2a50', border: '1px solid #3a3a60', color: '#a0a0c0',
      fontSize: 12, fontWeight: 600
    }}>
      {children}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Main Dashboard
// ---------------------------------------------------------------------------
export default function Dashboard({ setView }) {
  const [todayLog, setTodayLog]   = useState(null)
  const [weights,  setWeights]    = useState([])
  const [summary,  setSummary]    = useState(null)
  const [loading,  setLoading]    = useState(true)

  const today     = todayLocal()
  const weekStart = getMondayLocal(today)
  const daysLeft  = daysUntil(GOAL_DATE)
  const weeksLeft = daysLeft / 7

  useEffect(() => {
    Promise.all([
      window.api.getLog(today),
      window.api.getWeightLogs(90),
      window.api.getWeeklySummary(weekStart)
    ]).then(([log, wLogs, week]) => {
      setTodayLog(log)
      setWeights(wLogs || [])
      setSummary(week)
      setLoading(false)
    })
  }, [])

  // ---- Weight analysis ----
  const sorted       = dedupeWeights(weights)
  const latest       = sorted.length > 0 ? sorted[sorted.length - 1].weight : null
  const avg7         = rollingAvg(sorted, 7)
  const avg28        = rollingAvg(sorted, 28)
  const slopePerDay  = lrSlope(sorted, 14)
  const weeklyRate   = slopePerDay !== null ? parseFloat((slopePerDay * 7).toFixed(2)) : null

  // Use 7-day average as the primary weight basis — more stable than a single noisy weigh-in.
  // Fall back to latest if there's not enough data for a rolling average.
  const trendWeight  = avg7 ?? latest
  const toGoal       = trendWeight !== null ? parseFloat((trendWeight - GOAL_WEIGHT).toFixed(1)) : null
  const reqWeekly    = toGoal !== null && toGoal > 0 && weeksLeft > 0
    ? parseFloat((toGoal / weeksLeft).toFixed(2))
    : null

  // Trend confidence: based on how many distinct days have a weigh-in in the last 14 days
  const fourteenDaysAgo = (() => {
    const d = new Date(); d.setDate(d.getDate() - 14); return dateToLocal(d)
  })()
  const recentCount = sorted.filter(d => d.date >= fourteenDaysAgo).length
  const confidence  = recentCount >= 8 ? 'high' : recentCount >= 4 ? 'medium' : 'low'
  const confidenceColor = confidence === 'high' ? '#7cfc7c' : confidence === 'medium' ? '#f5a623' : '#606080'

  // ---- Trend status ----
  let trendStatus = null
  let trendColor  = '#606080'
  let trendMsg    = null

  if (sorted.length < 4) {
    trendStatus = 'not enough data'
    trendMsg    = 'Log at least 4 weigh-ins to see a trend assessment.'
  } else if (weeklyRate !== null && reqWeekly !== null && toGoal > 0) {
    const ratio = Math.abs(weeklyRate) / reqWeekly
    if (weeklyRate >= 0) {
      trendStatus = 'gaining weight'
      trendColor  = '#ff6b6b'
      trendMsg    = `2-week trend shows +${Math.abs(weeklyRate).toFixed(2)} kg/week. Need to lose ${reqWeekly} kg/week to reach ${GOAL_WEIGHT} kg by ${GOAL_DATE}. Focus on tightening calories — particularly on weekends.`
    } else if (ratio < 0.5) {
      const gapKcal = Math.round((reqWeekly - Math.abs(weeklyRate)) * 7700 / 7)
      trendStatus = 'too slow'
      trendColor  = '#f5a623'
      trendMsg    = `Losing ${Math.abs(weeklyRate).toFixed(2)} kg/week, need ${reqWeekly} kg/week. Roughly equivalent to ~${gapKcal} kcal/day if the trend is real (water weight can distort short windows). Try one extra low-cal day this week.`
    } else if (ratio < 0.85) {
      trendStatus = 'slightly slow'
      trendColor  = '#f5a623'
      trendMsg    = `Losing ${Math.abs(weeklyRate).toFixed(2)} kg/week — slightly under the ${reqWeekly} kg/week target. One extra low-cal day or keeping weekend calories closer to target should close the gap.`
    } else if (ratio <= 1.3) {
      trendStatus = 'on track'
      trendColor  = '#7cfc7c'
      trendMsg    = `Losing ${Math.abs(weeklyRate).toFixed(2)} kg/week — on the ${reqWeekly} kg/week target. Keep going, no change needed.`
    } else {
      trendStatus = 'ahead of target'
      trendColor  = '#7cfc7c'
      trendMsg    = `Losing ${Math.abs(weeklyRate).toFixed(2)} kg/week — faster than the ${reqWeekly} kg/week required. You're ahead of schedule. No need to restrict further.`
    }
  } else if (toGoal !== null && toGoal <= 0) {
    trendStatus = 'goal reached!'
    trendColor  = '#7cfc7c'
    trendMsg    = `You've hit ${GOAL_WEIGHT} kg! Excellent work.`
  }

  // ---- Today analysis ----
  const dayType = todayLog?.day_type || 'normal'
  const target  = TARGETS[dayType]
  const cal     = todayLog?.calories || 0
  const protein = todayLog?.protein  || 0
  const steps   = todayLog?.steps    || 0
  const beers   = todayLog?.beers    || 0

  // ---- Suggestions ----
  const suggestions = []
  if (!todayLog) {
    suggestions.push('Log today\'s food to get personalised suggestions.')
  } else {
    if (protein < PROTEIN_MIN * 0.5)
      suggestions.push(`Protein at ${protein}g — prioritise hitting ${PROTEIN_MIN}g before anything else.`)
    else if (protein < PROTEIN_MIN)
      suggestions.push(`${PROTEIN_MIN - protein}g protein to go — add a shake or a chicken breast.`)
    if (cal > target.calMax)
      suggestions.push(`Calories at ${cal} kcal — over the ${target.calMax} target. Watch dinner portions.`)
    if (beers >= 2)
      suggestions.push(`${beers} beers = ~${Math.round(beers * BEER_CAL)} kcal. Budget carefully for the rest of today.`)
    if (steps < STEP_TARGET * 0.4 && new Date().getHours() > 15)
      suggestions.push(`Steps at ${steps.toLocaleString()} — a 20-min walk would close the gap.`)
    if (suggestions.length === 0) {
      if (protein >= PROTEIN_MIN && cal <= target.calMax)
        suggestions.push('All targets looking good. Stay consistent through the evening.')
      else
        suggestions.push('Keep logging — you\'re on track for a solid day.')
    }
  }

  // ---- Protein-hit days this week ----
  const proteinHitDays = summary?.logs?.filter(l => (l.protein || 0) >= PROTEIN_MIN).length ?? 0

  if (loading) {
    return <div style={{ color: '#606080', padding: 40 }}>Loading…</div>
  }

  const dateLabel = new Date(today + 'T12:00:00').toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long'
  })

  return (
    <div style={{ maxWidth: 820 }}>

      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#e8e8f0', marginBottom: 2 }}>Dashboard</h1>
        <div style={{ fontSize: 13, color: '#606080' }}>
          {dateLabel}
          {daysLeft > 0 && (
            <span style={{ marginLeft: 12, color: '#404060' }}>· {daysLeft} days to goal date</span>
          )}
        </div>
      </div>

      {/* Trend recommendation banner */}
      {trendMsg && (
        <div style={{
          background: trendColor + '10',
          border: `1px solid ${trendColor}40`,
          borderLeft: `4px solid ${trendColor}`,
          borderRadius: 10, padding: '13px 18px', marginBottom: 22
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: trendColor, textTransform: 'uppercase', letterSpacing: 0.9 }}>
              Trend · {trendStatus}
            </div>
            {recentCount > 0 && (
              <div style={{ fontSize: 10, color: confidenceColor }}>
                confidence: {confidence} · {recentCount} weigh-ins / 14 days
              </div>
            )}
          </div>
          <div style={{ fontSize: 13, color: '#b0b0cc', lineHeight: 1.65 }}>{trendMsg}</div>
        </div>
      )}

      {/* Row 1: Today + Weight */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>

        {/* Today card */}
        <div style={{ background: '#16162a', border: '1px solid #2a2a45', borderRadius: 12, padding: '18px 20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: '#e8e8f0' }}>Today</span>
            <span style={{
              fontSize: 10, padding: '3px 9px', borderRadius: 10, fontWeight: 700,
              background: target.color + '20', color: target.color
            }}>
              {todayLog ? target.label.toUpperCase() : 'NOT LOGGED'}
            </span>
          </div>

          <MiniBar
            label="Calories"
            value={cal}
            min={target.calMin}
            max={target.calMax}
            unit="kcal"
            color="#5bc8f5"
          />
          <MiniBar
            label="Protein"
            value={protein}
            min={PROTEIN_MIN}
            max={PROTEIN_MAX}
            unit="g"
            color="#a78bfa"
          />
          <MiniBar
            label="Steps"
            value={steps}
            min={STEP_TARGET}
            max={STEP_TARGET * 1.5}
            color="#f5a623"
            fmt={v => v.toLocaleString()}
          />

          {beers > 0 && (
            <div style={{ fontSize: 11, color: '#8080a0', marginTop: 4 }}>
              🍺 {beers} beer{beers !== 1 ? 's' : ''} · ~{Math.round(beers * BEER_CAL)} kcal
            </div>
          )}

          <NavBtn onClick={() => setView('daily')}>
            {todayLog ? '✏️  Edit today\'s log' : '➕  Log today'}
          </NavBtn>
        </div>

        {/* Weight trend card */}
        <div style={{ background: '#16162a', border: '1px solid #2a2a45', borderRadius: 12, padding: '18px 20px' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#e8e8f0', marginBottom: 16 }}>Weight Trend</div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <Stat label="Latest" value={latest !== null ? `${latest} kg` : '—'} />
            <Stat label="7-day avg" value={avg7 !== null ? `${avg7} kg` : '—'} color="#5bc8f5" />
            <Stat
              label={avg7 !== null ? 'To goal (avg)' : 'To goal'}
              value={toGoal !== null ? `${toGoal} kg` : '—'}
              color={toGoal !== null && toGoal <= 3 ? '#7cfc7c' : '#f5a623'}
            />
            <Stat
              label="Weekly rate"
              value={weeklyRate !== null ? `${weeklyRate > 0 ? '+' : ''}${weeklyRate} kg` : '—'}
              color={weeklyRate !== null ? (weeklyRate < 0 ? '#7cfc7c' : '#ff6b6b') : '#8080a0'}
            />
          </div>

          {reqWeekly !== null && toGoal > 0 && (
            <div style={{
              fontSize: 11, color: '#505070', borderTop: '1px solid #2a2a45',
              paddingTop: 10, marginTop: 2
            }}>
              Need <strong style={{ color: '#8080a0' }}>−{reqWeekly} kg/week</strong> to hit goal by {GOAL_DATE}
              {avg28 && (
                <span style={{ marginLeft: 10 }}>· 28-day avg: {avg28} kg</span>
              )}
            </div>
          )}

          <NavBtn onClick={() => setView('weight')}>📈  View full tracker</NavBtn>
        </div>
      </div>

      {/* Row 2: This week */}
      <div style={{ background: '#16162a', border: '1px solid #2a2a45', borderRadius: 12, padding: '18px 20px', marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: '#e8e8f0' }}>This Week</span>
          <button
            onClick={() => setView('weekly')}
            style={{ background: 'none', border: 'none', color: '#5bc8f5', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}
          >
            Full review →
          </button>
        </div>

        {summary ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
            <WeekPill
              label="Avg calories"
              value={`${summary.avgCal} kcal`}
              ok={summary.avgCal <= 2100}
              warn={summary.avgCal > 2400}
            />
            <WeekPill
              label="Protein days"
              value={`${proteinHitDays} / ${summary.totalDays}`}
              ok={proteinHitDays >= 5}
              warn={proteinHitDays <= 2}
            />
            <WeekPill
              label="Fast days"
              value={`${summary.lowCalDays} day${summary.lowCalDays !== 1 ? 's' : ''}`}
              ok={summary.lowCalDays >= 1}
            />
            <WeekPill
              label="Workouts"
              value={`${summary.totalWorkouts} session${summary.totalWorkouts !== 1 ? 's' : ''}`}
              ok={summary.totalWorkouts >= 2}
            />
            <WeekPill
              label="Beers"
              value={`${summary.totalBeers}`}
              ok={summary.totalBeers <= 4}
              warn={summary.totalBeers >= 8}
            />
            <WeekPill
              label="Avg steps"
              value={summary.avgSteps.toLocaleString()}
              ok={summary.avgSteps >= STEP_TARGET}
              warn={summary.avgSteps < 5000}
            />
          </div>
        ) : (
          <div style={{ fontSize: 13, color: '#404060', textAlign: 'center', padding: '12px 0' }}>
            No data logged this week yet.
          </div>
        )}
      </div>

      {/* Row 3: Suggested focus */}
      <div style={{ background: '#16162a', border: '1px solid #2a2a45', borderRadius: 12, padding: '16px 20px' }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#7cfc7c', textTransform: 'uppercase', letterSpacing: 0.9, marginBottom: 10 }}>
          💡  Suggested focus today
        </div>
        {suggestions.map((s, i) => (
          <div
            key={i}
            style={{
              fontSize: 13, color: '#c0c0d8', lineHeight: 1.6, padding: '5px 0',
              borderBottom: i < suggestions.length - 1 ? '1px solid #2a2a45' : 'none'
            }}
          >
            → {s}
          </div>
        ))}
      </div>

    </div>
  )
}
