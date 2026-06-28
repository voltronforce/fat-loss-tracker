const NAV = [
  { id: 'home',   label: 'Dashboard',     icon: '\u{1F3E0}' },
  { id: 'daily',  label: 'Today',         icon: '\u{1F4CB}' },
  { id: 'weight', label: 'Weight',         icon: '\u2696\uFE0F' },
  { id: 'weekly', label: 'Weekly Review',  icon: '\u{1F4CA}' },
  { id: 'import', label: 'Import Health',  icon: '\u{1F4E5}' }
]

const GOAL_DATE   = '2026-09-30'
const GOAL_WEIGHT = 75

function daysRemaining() {
  return Math.max(0, Math.round((new Date(GOAL_DATE) - new Date()) / 86_400_000))
}

export default function Sidebar({ activeView, setView }) {
  const days = daysRemaining()
  const weeksLeft = Math.round(days / 7)

  return (
    <aside style={{
      width: 200,
      background: '#16162a',
      borderRight: '1px solid #2a2a45',
      display: 'flex',
      flexDirection: 'column',
      padding: '20px 0',
      flexShrink: 0
    }}>
      <div style={{ padding: '0 20px 20px', borderBottom: '1px solid #2a2a45' }}>
        <div style={{ fontSize: 22, lineHeight: 1.1 }}>{String.fromCodePoint(0x1F525)}</div>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#a0a0c0', marginTop: 4 }}>Fat Loss</div>
        <div style={{ fontSize: 10, color: '#505070', marginTop: 3 }}>85 {String.fromCharCode(8594)} {GOAL_WEIGHT} kg {String.fromCharCode(183)} Sep 2026</div>
      </div>

      <nav style={{ flex: 1, padding: '14px 0' }}>
        {NAV.map(({ id, label, icon }) => {
          const active = activeView === id
          return (
            <button
              key={id}
              onClick={() => setView(id)}
              style={{
                width: '100%',
                textAlign: 'left',
                padding: '10px 20px',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                background: active ? '#2a2a50' : 'transparent',
                color: active ? '#e8e8f0' : '#8080a0',
                fontSize: 13,
                fontWeight: active ? 600 : 400,
                cursor: 'pointer',
                border: 'none',
                borderLeft: active ? '3px solid #7cfc7c' : '3px solid transparent',
                transition: 'all 0.15s'
              }}
            >
              <span style={{ fontSize: 14 }}>{icon}</span>
              <span>{label}</span>
            </button>
          )
        })}
      </nav>

      <div style={{ padding: '12px 20px', borderTop: '1px solid #2a2a45' }}>
        <div style={{ fontSize: 10, color: '#505070', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
          Goal deadline
        </div>
        <div style={{ fontSize: 11, color: '#7cfc7c', fontWeight: 600 }}>
          {days} days left
        </div>
        <div style={{ fontSize: 10, color: '#404060', marginTop: 2 }}>
          {String.fromCharCode(8776)} {weeksLeft} weeks {String.fromCharCode(183)} 30 Sep 2026
        </div>
      </div>
    </aside>
  )
}
