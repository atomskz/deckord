import path from 'node:path';
import { app, BrowserWindow, Menu, Tray, nativeImage } from 'electron';
import {
  configureLogging,
  FileSettingsStore,
  loadConfig,
  mergeConfig,
  secretsPath,
  ServiceRunner,
  settingsPath,
  type Logger,
} from 'deckord-service';
import { SafeStorageSecretStore } from './SafeStorageSecretStore';

/**
 * Deckord desktop shell (Phase 9, Electron).
 *
 * It runs the whole Deckord service IN-PROCESS via ServiceRunner, shows the config
 * UI (the built debug deck) in a window, and lives in the system tray. Because the
 * UI already talks to the service over the loopback WebSocket, the shell only owns
 * the window + tray + OS integration — no business logic.
 *
 * NOTE: this is a scaffold. It cannot be built or run in the headless CI sandbox
 * (no display, no Electron install); see README.md for how to build it locally.
 */

let tray: Tray | null = null;
let win: BrowserWindow | null = null;
let runner: ServiceRunner | null = null;
let log: Logger | null = null;
let quitting = false;

// Single instance: a second launch just focuses the running window.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());
  app.whenReady().then(main).catch((error) => {
    // eslint-disable-next-line no-console
    console.error('[deckord-desktop] failed to start:', error);
    app.quit();
  });
}

async function main(): Promise<void> {
  const base = loadConfig();
  const settings = new FileSettingsStore(settingsPath(base.dataDir));
  const secrets = new SafeStorageSecretStore(secretsPath(base.dataDir));
  log = configureLogging(mergeConfig(base, await settings.load()).logLevel);

  runner = new ServiceRunner(log, settings, secrets);
  await runner.start();

  createTray();
  createWindow();

  app.on('before-quit', () => {
    quitting = true;
    void runner?.stop();
  });
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1200,
    height: 900,
    show: false,
    title: 'Deckord',
    backgroundColor: '#1e1f22',
    webPreferences: { contextIsolation: true },
  });
  // The built debug-deck UI is copied to <appRoot>/renderer by the build step.
  void win.loadFile(path.join(app.getAppPath(), 'renderer', 'index.html'));
  win.once('ready-to-show', () => win?.show());
  win.on('close', (event) => {
    // Hide to tray instead of quitting, unless the user chose Quit.
    if (!quitting) {
      event.preventDefault();
      win?.hide();
    }
  });
}

function showWindow(): void {
  if (!win) createWindow();
  win?.show();
  win?.focus();
}

function createTray(): void {
  const icon = nativeImage.createFromPath(path.join(app.getAppPath(), 'assets', 'tray.png'));
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip('Deckord');
  tray.on('click', () => showWindow());
  refreshTrayMenu();
}

function refreshTrayMenu(): void {
  const openAtLogin = app.getLoginItemSettings().openAtLogin;
  const menu = Menu.buildFromTemplate([
    { label: 'Open Deckord', click: () => showWindow() },
    {
      label: 'Restart service',
      click: () => {
        void runner?.restart();
      },
    },
    { type: 'separator' },
    {
      label: 'Launch at login',
      type: 'checkbox',
      checked: openAtLogin,
      click: (item) => {
        app.setLoginItemSettings({ openAtLogin: item.checked });
        refreshTrayMenu();
      },
    },
    { type: 'separator' },
    {
      label: 'Quit Deckord',
      click: () => {
        quitting = true;
        app.quit();
      },
    },
  ]);
  tray?.setContextMenu(menu);
}
