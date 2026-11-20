/**
 * Preload bridge.
 *
 * The renderer is the ordinary Next.js app, so it needs almost nothing from the shell:
 * only where the local server is and which build it is talking to. Everything else stays
 * behind `contextIsolation`.
 */

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('practiceManager', {
  info: () => ipcRenderer.invoke('pm:info'),
})
