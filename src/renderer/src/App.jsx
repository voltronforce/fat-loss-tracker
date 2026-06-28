import { useState } from 'react'
import Sidebar from './components/Sidebar'
import Dashboard from './components/Dashboard'
import DailyLog from './components/DailyLog'
import WeightTracker from './components/WeightTracker'
import WeeklySummary from './components/WeeklySummary'
import HealthImport from './components/HealthImport'

const VIEWS = {
  home:   Dashboard,
  daily:  DailyLog,
  weight: WeightTracker,
  weekly: WeeklySummary,
  import: HealthImport
}

export default function App() {
  const [view, setView] = useState('home')
  const View = VIEWS[view]

  return (
    <div style={{ display: 'flex', height: '100vh', background: '#0f0f1a', color: '#e8e8f0' }}>
      <Sidebar activeView={view} setView={setView} />
      <main style={{ flex: 1, overflowY: 'auto', padding: '28px 32px' }}>
        <View setView={setView} />
      </main>
    </div>
  )
}
