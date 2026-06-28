import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  // Daily logs
  getLog:          (date)        => ipcRenderer.invoke('db:getLog', date),
  saveLog:         (log)         => ipcRenderer.invoke('db:saveLog', log),
  getRecentLogs:   (days)        => ipcRenderer.invoke('db:getRecentLogs', days),
  getLogsInRange:  (start, end)  => ipcRenderer.invoke('db:getLogsInRange', start, end),

  // Weight
  getWeightLogs:   (days)        => ipcRenderer.invoke('db:getWeightLogs', days),
  saveWeight:      (date, weight) => ipcRenderer.invoke('db:saveWeight', date, weight),
  deleteWeight:    (id)          => ipcRenderer.invoke('db:deleteWeight', id),

  // Weekly summary
  getWeeklySummary: (weekStart)  => ipcRenderer.invoke('db:getWeeklySummary', weekStart),

  // Imported metrics (from Apple Health)
  getImportedMetrics:        (date)         => ipcRenderer.invoke('db:getImportedMetrics', date),
  getImportedMetricsInRange: (start, end)   => ipcRenderer.invoke('db:getImportedMetricsInRange', start, end),

  // Health import
  openFileDialog:   ()           => ipcRenderer.invoke('dialog:openFile'),
  importHealthXML:  (filePath)   => ipcRenderer.invoke('health:importXML', filePath),

  // Import progress events from main process
  onImportProgress: (cb) => {
    const handler = (_e, data) => cb(data)
    ipcRenderer.on('import:progress', handler)
    return () => ipcRenderer.removeListener('import:progress', handler)
  }
})
