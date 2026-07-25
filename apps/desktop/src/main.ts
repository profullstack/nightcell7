import { app, BrowserWindow, shell, ipcMain, session } from "electron";
import path from "node:path";

/**
 * Electron main process (PRD §28.2).
 *
 * Security posture, all non-negotiable:
 *   - context isolation on, node integration off, sandbox on;
 *   - a narrow preload with validated IPC;
 *   - a navigation allowlist;
 *   - no remote code execution and no embedded secrets.
 *
 * The desktop client is a wrapper around the same web build and the same
 * public API. It has no privileged path to entitlements or match authority.
 */

const PUBLIC_ORIGIN = process.env.NIGHTCELL7_ORIGIN ?? "https://nightcell7.com";
const isDevelopment = !app.isPackaged;

/** Only these origins may ever be loaded in a renderer. */
const ALLOWED_ORIGINS = new Set([
  new URL(PUBLIC_ORIGIN).origin,
  ...(isDevelopment ? ["http://localhost:8080", "http://localhost:5173"] : []),
]);

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 1024,
    minHeight: 576,
    backgroundColor: "#07090c",
    title: "NIGHTCELL 7",
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, "preload.js"),
      // The desktop build must not run a service worker: offline content is
      // managed by the app, not by a second caching layer (PRD §28.2).
      partition: "persist:nightcell7",
      devTools: isDevelopment,
    },
  });

  window.once("ready-to-show", () => window.show());

  // External links open in the system browser, never in a game window.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event, url) => {
    if (!ALLOWED_ORIGINS.has(new URL(url).origin)) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });

  void window.loadURL(`${PUBLIC_ORIGIN}/play/`);
  return window;
}

app.whenReady().then(() => {
  // Deny every permission request by default; the game needs none of them.
  session
    .fromPartition("persist:nightcell7")
    .setPermissionRequestHandler((_webContents, permission, callback) => {
      callback(permission === "fullscreen" || permission === "pointerLock");
    });

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

/**
 * Deep links open a private lobby invitation, but still require login and a
 * fresh one-time ticket — the link is never an authentication bypass
 * (PRD §28.4).
 */
app.setAsDefaultProtocolClient("nightcell7");

app.on("open-url", (event, url) => {
  event.preventDefault();
  const target = new URL(url);
  const code = target.searchParams.get("code");
  const window = BrowserWindow.getAllWindows()[0];
  if (!window || !code) return;
  if (!/^[A-Z0-9]{4,12}$/.test(code)) return;
  void window.loadURL(
    `${PUBLIC_ORIGIN}/play/?mode=multiplayer&private=${encodeURIComponent(code)}`,
  );
});

/** The only IPC the renderer is given: platform identity for diagnostics. */
ipcMain.handle("nightcell7:platform", () => ({
  platform: process.platform,
  arch: process.arch,
  appVersion: app.getVersion(),
}));

/** Purchase opens in the system browser (PRD §28.3). */
ipcMain.handle("nightcell7:open-checkout", (_event, episodeId: unknown) => {
  if (typeof episodeId !== "string" || !/^[a-z0-9-]{1,64}$/.test(episodeId)) return false;
  void shell.openExternal(`${PUBLIC_ORIGIN}/checkout/${episodeId}/coinpay`);
  return true;
});
