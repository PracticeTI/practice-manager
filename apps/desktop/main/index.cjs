/**
 * Electron main process.
 *
 * Thin on purpose: it decides *whether* the app may start, then hands the work to the
 * launch plan. The server runs on the operator's installed Node.js (a stated prerequisite),
 * not on Electron's embedded runtime, so the preflight check measures the system binary.
 *
 * CommonJS because Electron's ESM main-process support still has rough edges; the shared
 * modules are ESM and are loaded with dynamic `import()`.
 */

const path = require('node:path')

const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron')

const launched = { child: null, baseUrl: null }
let mainWindow = null

function formatChecks(checks) {
  return checks
    .map((check) => {
      const mark = check.ok ? '✔' : '✖'
      const fix = !check.ok && check.fix ? `\n     → ${check.fix}` : ''
      return `${mark} ${check.name}: ${check.detail}${fix}`
    })
    .join('\n')
}

async function stopWithError(title, message) {
  await dialog.showMessageBox({ type: 'error', title, message: title, detail: message, buttons: ['Quit'] })
  app.exit(1)
}

function stopServer() {
  if (launched.child && !launched.child.killed) {
    launched.child.kill('SIGTERM')
    launched.child = null
  }
}

async function createWindow(baseUrl) {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'Practice Manager',
    backgroundColor: '#ffffff',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  ipcMain.handle('pm:info', () => ({ baseUrl, version: app.getVersion() }))

  mainWindow.once('ready-to-show', () => mainWindow.show())
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // Anything that is not the local server belongs in the user's browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(baseUrl)) shell.openExternal(url)
    return { action: 'deny' }
  })

  await mainWindow.loadURL(baseUrl)
  console.log(`[shell] window loaded ${baseUrl}`)

  // Used by the automated smoke test; harmless in normal use.
  const smokeExitMs = Number(process.env.PM_SMOKE_EXIT_MS || 0)
  if (Number.isFinite(smokeExitMs) && smokeExitMs > 0) {
    setTimeout(() => app.quit(), smokeExitMs)
  }
}

async function boot() {
  const { probeSystemNode, runPreflight } = await import('../src/preflight.js')
  const { resolveStandaloneDir, startCoreServer } = await import('./launchPlan.js')

  const node = await probeSystemNode()
  if (!node.ok) {
    await stopWithError(
      'Node.js is required',
      `Practice Manager runs its server with your installed Node.js.\n\n${node.error}\n\nInstall Node.js 22 or 24, then reopen the app.`
    )
    return
  }

  const preflight = await runPreflight({ nodeVersion: node.version })
  if (!preflight.ok) {
    await stopWithError('Setup is incomplete', formatChecks(preflight.checks))
    return
  }

  const standaloneDir = resolveStandaloneDir({
    resourcesPath: app.isPackaged ? process.resourcesPath : undefined,
  })

  if (!standaloneDir) {
    await stopWithError(
      'Build missing',
      'The application has not been built yet.\n\nRun: npm run build, then npm run prepare:standalone --workspace @practice-manager/desktop'
    )
    return
  }

  console.log(`[shell] server root ${standaloneDir}`)

  const started = await startCoreServer({
    standaloneDir,
    // Use the same binary the checks just validated, not whatever `node` resolves to later.
    nodePath: node.path,
    onOutput: (line) => console.log(`[core] ${line}`),
  })
  if (!started.ok) {
    await stopWithError('The app did not start', started.error || 'The local server did not answer.')
    return
  }

  launched.child = started.child
  launched.baseUrl = started.baseUrl

  await createWindow(started.baseUrl)
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(() => {
    boot().catch((error) => {
      stopWithError('The app could not start', error?.message || String(error))
    })
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && launched.baseUrl) {
      createWindow(launched.baseUrl)
    }
  })

  app.on('window-all-closed', () => app.quit())
  app.on('before-quit', stopServer)
}
