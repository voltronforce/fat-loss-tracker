import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import fs from 'fs'
import readline from 'readline'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const isDev = !app.isPackaged

class DB {
  constructor(sqlJs, dbPath) {
    this._path = dbPath
    const data = fs.existsSync(dbPath) ? fs.readFileSync(dbPath) : null
    this._db = data ? new sqlJs.Database(data) : new sqlJs.Database()
    this._inTx = false
  }
  _save() { fs.writeFileSync(this._path, Buffer.from(this._db.export())) }
  exec(sql) { this._db.run(sql) }
  run(sql, params) {
    this._db.run(sql, params || [])
    if (!this._inTx) this._save()
    return { changes: this._db.getRowsModified() }
  }
  runNoSave(sql, params) {
    this._db.run(sql, params || [])
    return { changes: this._db.getRowsModified() }
  }
  get(sql, params) {
    const s = this._db.prepare(sql); s.bind(params || [])
    const row = s.step() ? s.getAsObject() : null; s.free(); return row
  }
  all(sql, params) {
    const s = this._db.prepare(sql); s.bind(params || [])
    const rows = []; while (s.step()) rows.push(s.getAsObject()); s.free(); return rows
  }
  begin()    { this._db.run('BEGIN TRANSACTION'); this._inTx = true }
  commit()   { this._db.run('COMMIT'); this._inTx = false; this._save() }
  rollback() { try { this._db.run('ROLLBACK') } catch (_) {} this._inTx = false }
  close()    { this._db.close() }
}

let db, mainWindow

async function initDatabase() {
  const initSqlJs = require('sql.js')
  const wasmPath = app.isPackaged
    ? join(process.resourcesPath, 'sql-wasm.wasm')
    : join(app.getAppPath(), 'node_modules/sql.js/dist/sql-wasm.wasm')
  const SQL = await initSqlJs({ locateFile: () => wasmPath })
  const dbPath = join(app.getPath('userData'), 'fatloss.db')
  db = new DB(SQL, dbPath)
  db.exec(`
    CREATE TABLE IF NOT EXISTS daily_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT UNIQUE NOT NULL,
      day_type TEXT NOT NULL DEFAULT 'normal', calories INTEGER DEFAULT 0,
      protein INTEGER DEFAULT 0, steps INTEGER DEFAULT 0,
      workout TEXT DEFAULT '', beers REAL DEFAULT 0, notes TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS weight_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL,
      weight REAL NOT NULL, source TEXT DEFAULT 'manual',
      created_at TEXT DEFAULT (datetime('now')), UNIQUE(date, source)
    );
    CREATE TABLE IF NOT EXISTS imported_daily_metrics (
      date TEXT PRIMARY KEY, steps INTEGER,
      active_energy_kcal REAL, basal_energy_kcal REAL,
      exercise_minutes REAL, stand_hours REAL,
      resting_hr REAL, vo2max REAL, sleep_hours REAL
    );
    CREATE TABLE IF NOT EXISTS workouts (
      id INTEGER PRIMARY KEY AUTOINCREMENT, start_time TEXT NOT NULL,
      end_time TEXT, date TEXT NOT NULL, type TEXT,
      duration_min REAL, energy_kcal REAL, distance_km REAL, source_name TEXT,
      UNIQUE(start_time)
    );
    CREATE TABLE IF NOT EXISTS imports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      imported_at TEXT NOT NULL DEFAULT (datetime('now')),
      source_file TEXT, weight_entries INTEGER DEFAULT 0,
      step_days INTEGER DEFAULT 0, workout_entries INTEGER DEFAULT 0,
      status TEXT DEFAULT 'ok'
    );
  `)
}

ipcMain.handle('db:getLog', (_e, date) =>
  db.get('SELECT * FROM daily_logs WHERE date = ?', [date]))

ipcMain.handle('db:saveLog', (_e, log) =>
  db.run(
    `INSERT INTO daily_logs (date,day_type,calories,protein,steps,workout,beers,notes)
     VALUES (?,?,?,?,?,?,?,?)
     ON CONFLICT(date) DO UPDATE SET
       day_type=excluded.day_type, calories=excluded.calories,
       protein=excluded.protein, steps=excluded.steps,
       workout=excluded.workout, beers=excluded.beers, notes=excluded.notes`,
    [log.date, log.day_type, log.calories, log.protein,
     log.steps, log.workout, log.beers, log.notes]
  ))

ipcMain.handle('db:getRecentLogs', (_e, days) =>
  db.all('SELECT * FROM daily_logs ORDER BY date DESC LIMIT ?', [days || 30]))

ipcMain.handle('db:getLogsInRange', (_e, start, end) =>
  db.all('SELECT * FROM daily_logs WHERE date >= ? AND date <= ? ORDER BY date ASC', [start, end]))

ipcMain.handle('db:getWeightLogs', (_e, days) =>
  db.all('SELECT * FROM weight_logs ORDER BY date DESC LIMIT ?', [days || 90]))

// FIXED: weight is param 2, source is a literal
ipcMain.handle('db:saveWeight', (_e, date, weight) =>
  db.run(
    `INSERT INTO weight_logs (date, weight, source)
     VALUES (?, ?, 'manual')
     ON CONFLICT(date, source) DO UPDATE SET weight = excluded.weight`,
    [date, weight]
  ))

ipcMain.handle('db:deleteWeight', (_e, id) =>
  db.run('DELETE FROM weight_logs WHERE id = ?', [id]))

ipcMain.handle('db:getWeeklySummary', (_e, weekStart) => {
  const logs = db.all(
    `SELECT * FROM daily_logs WHERE date >= ? AND date < date(?, '+7 days') ORDER BY date ASC`,
    [weekStart, weekStart]
  )
  if (!logs.length) return null
  const n = logs.length
  const sum = (f) => logs.reduce((s, l) => s + (l[f] || 0), 0)
  const ws = db.get(`SELECT weight FROM weight_logs WHERE date >= ? ORDER BY date ASC LIMIT 1`, [weekStart])
  const we = db.get(`SELECT weight FROM weight_logs WHERE date < date(?, '+7 days') ORDER BY date DESC LIMIT 1`, [weekStart])
  return {
    logs, totalDays: n,
    avgCal:        Math.round(sum('calories') / n),
    avgProtein:    Math.round(sum('protein') / n),
    avgSteps:      Math.round(sum('steps') / n),
    totalWorkouts: logs.filter(l => l.workout && l.workout.trim()).length,
    totalBeers:    sum('beers'),
    lowCalDays:    logs.filter(l => l.day_type === 'low_cal').length,
    normalDays:    logs.filter(l => l.day_type === 'normal').length,
    weightChange:  ws && we ? parseFloat((we.weight - ws.weight).toFixed(2)) : null
  }
})

ipcMain.handle('db:getImportedMetrics', (_e, date) =>
  db.get('SELECT * FROM imported_daily_metrics WHERE date = ?', [date]))

ipcMain.handle('db:getImportedMetricsInRange', (_e, start, end) =>
  db.all('SELECT * FROM imported_daily_metrics WHERE date >= ? AND date <= ? ORDER BY date ASC', [start, end]))

ipcMain.handle('dialog:openFile', () =>
  dialog.showOpenDialog(mainWindow, {
    title: 'Select Apple Health Export',
    filters: [{ name: 'Apple Health Export', extensions: ['zip', 'xml'] }],
    properties: ['openFile']
  }))

ipcMain.handle('health:importXML', async (_e, filePath) => {
  const sendProgress = (data) => {
    if (mainWindow && !mainWindow.isDestroyed())
      mainWindow.webContents.send('import:progress', data)
  }
  const attr = (line, name) => {
    const m = line.match(new RegExp(name + '="([^"]*)"'))
    return m ? m[1] : null
  }
  try {
    const stepsByDay = {}, activeEnergyByDay = {}, basalEnergyByDay = {}, exerciseMinsByDay = {}
    const weightEntries = [], workoutRecords = []
    let linesRead = 0

    const processLine = (line) => {
      linesRead++
      if (linesRead % 100_000 === 0) sendProgress({ stage: 'reading', linesRead })
      const t = line.trimStart()
      if (t.startsWith('<Record ')) {
        const type = attr(t, 'type'), startDate = attr(t, 'startDate')?.slice(0, 10)
        const value = parseFloat(attr(t, 'value') || '0')
        if (!type || !startDate || isNaN(value)) return
        switch (type) {
          case 'HKQuantityTypeIdentifierStepCount':
            stepsByDay[startDate] = (stepsByDay[startDate] || 0) + value; break
          case 'HKQuantityTypeIdentifierBodyMass': {
            let w = value
            if ((attr(t, 'unit') || 'kg') === 'lb') w *= 0.453592
            if (w > 20 && w < 300) weightEntries.push({ date: startDate, weight_kg: parseFloat(w.toFixed(2)) })
            break
          }
          case 'HKQuantityTypeIdentifierActiveEnergyBurned':
            activeEnergyByDay[startDate] = (activeEnergyByDay[startDate] || 0) + value; break
          case 'HKQuantityTypeIdentifierBasalEnergyBurned':
            basalEnergyByDay[startDate] = (basalEnergyByDay[startDate] || 0) + value; break
          case 'HKQuantityTypeIdentifierAppleExerciseTime':
            exerciseMinsByDay[startDate] = (exerciseMinsByDay[startDate] || 0) + value; break
        }
      }
      if (t.startsWith('<Workout ')) {
        const startTime = attr(t, 'startDate'), endTime = attr(t, 'endDate')
        const startDate = startTime?.slice(0, 10)
        const type = (attr(t, 'workoutActivityType') || '').replace('HKWorkoutActivityType', '')
        const dur = parseFloat(attr(t, 'duration') || '0')
        const energy = parseFloat(attr(t, 'totalEnergyBurned') || '0')
        const dist = parseFloat(parseFloat(attr(t, 'totalDistance') || '0').toFixed(3))
        const sourceName = attr(t, 'sourceName') || ''
        if (startDate && startTime && type)
          workoutRecords.push([startTime, endTime || null, startDate, type,
            parseFloat(dur.toFixed(1)), parseFloat(energy.toFixed(1)), dist, sourceName])
      }
    }

    const streamLines = (readable) => new Promise((resolve, reject) => {
      const rl = readline.createInterface({ input: readable, crlfDelay: Infinity })
      rl.on('line', processLine)
      rl.on('close', resolve)
      rl.on('error', reject)
    })

    const isZip = filePath.toLowerCase().endsWith('.zip')
    if (isZip) {
      sendProgress({ stage: 'opening_zip' })
      const unzipper = require('unzipper')
      const directory = await unzipper.Open.file(filePath)
      const xmlEntry = directory.files.find(f =>
        f.path === 'apple_health_export/export.xml' || f.path.endsWith('/export.xml'))
      if (!xmlEntry) throw new Error('Could not find export.xml inside the ZIP file.')
      sendProgress({ stage: 'reading', linesRead: 0 })
      await streamLines(xmlEntry.stream())
    } else {
      sendProgress({ stage: 'reading', linesRead: 0 })
      await streamLines(fs.createReadStream(filePath, { encoding: 'utf8' }))
    }

    sendProgress({ stage: 'saving' })
    db.begin()
    try {
      for (const { date, weight_kg } of weightEntries)
        db.runNoSave(
          `INSERT INTO weight_logs (date, weight, source) VALUES (?, ?, 'apple_health')
           ON CONFLICT(date, source) DO UPDATE SET weight = excluded.weight`,
          [date, weight_kg])
      for (const [date, rawSteps] of Object.entries(stepsByDay)) {
        const steps = Math.round(rawSteps)
        db.runNoSave(
          `INSERT INTO daily_logs (date, day_type, steps) VALUES (?, 'normal', ?)
           ON CONFLICT(date) DO UPDATE SET steps = excluded.steps`, [date, steps])
        db.runNoSave(
          `INSERT INTO imported_daily_metrics (date, steps) VALUES (?, ?)
           ON CONFLICT(date) DO UPDATE SET steps = excluded.steps`, [date, steps])
      }
      for (const [date, kcal] of Object.entries(activeEnergyByDay))
        db.runNoSave(
          `INSERT INTO imported_daily_metrics (date, active_energy_kcal) VALUES (?, ?)
           ON CONFLICT(date) DO UPDATE SET active_energy_kcal = excluded.active_energy_kcal`,
          [date, parseFloat(kcal.toFixed(1))])
      for (const [date, kcal] of Object.entries(basalEnergyByDay))
        db.runNoSave(
          `INSERT INTO imported_daily_metrics (date, basal_energy_kcal) VALUES (?, ?)
           ON CONFLICT(date) DO UPDATE SET basal_energy_kcal = excluded.basal_energy_kcal`,
          [date, parseFloat(kcal.toFixed(1))])
      for (const [date, mins] of Object.entries(exerciseMinsByDay))
        db.runNoSave(
          `INSERT INTO imported_daily_metrics (date, exercise_minutes) VALUES (?, ?)
           ON CONFLICT(date) DO UPDATE SET exercise_minutes = excluded.exercise_minutes`,
          [date, parseFloat(mins.toFixed(1))])
      for (const w of workoutRecords) {
        db.runNoSave(
          `INSERT OR IGNORE INTO workouts
             (start_time,end_time,date,type,duration_min,energy_kcal,distance_km,source_name)
           VALUES (?,?,?,?,?,?,?,?)`, w)
        const label = `${w[3]} ${Math.round(w[4])}min`
        db.runNoSave(`INSERT INTO daily_logs (date,day_type) VALUES (?,'normal') ON CONFLICT(date) DO NOTHING`, [w[2]])
        db.runNoSave(`UPDATE daily_logs SET workout=? WHERE date=? AND (workout IS NULL OR workout='')`, [label, w[2]])
      }
      db.runNoSave(
        `INSERT INTO imports (source_file,weight_entries,step_days,workout_entries,status) VALUES (?,?,?,?,'ok')`,
        [filePath.split(/[\\/]/).pop(), weightEntries.length,
         Object.keys(stepsByDay).length, workoutRecords.length])
      db.commit()
    } catch (err) { db.rollback(); throw err }

    const stats = {
      weight: weightEntries.length, steps: Object.keys(stepsByDay).length,
      workouts: workoutRecords.length, activeEnergyDays: Object.keys(activeEnergyByDay).length
    }
    sendProgress({ stage: 'done', stats })
    return { success: true, stats }
  } catch (err) {
    sendProgress({ stage: 'error', error: err.message })
    return { success: false, error: err.message }
  }
})

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100, height: 750, minWidth: 800, minHeight: 600,
    show: false, autoHideMenuBar: true, title: 'Fat Loss Tracker',
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: false }
  })
  mainWindow.on('ready-to-show', () => mainWindow.show())
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url); return { action: 'deny' }
  })
  if (isDev && process.env['ELECTRON_RENDERER_URL'])
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  else
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
}

app.whenReady().then(async () => {
  app.setAppUserModelId('com.captain.fatloss')
  await initDatabase()
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') { if (db) db.close(); app.quit() }
})
