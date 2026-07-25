import { contextBridge, ipcRenderer } from "electron";

/**
 * Preload bridge (PRD §28.2).
 *
 * Deliberately tiny. Anything added here becomes attack surface reachable from
 * page content, so the rule is: no filesystem, no shell, no arbitrary IPC
 * channel names, and nothing that could bypass server authority.
 */
contextBridge.exposeInMainWorld("nightcell7", {
  isDesktop: true,

  getPlatform: (): Promise<{ platform: string; arch: string; appVersion: string }> =>
    ipcRenderer.invoke("nightcell7:platform"),

  /** Opens the CoinPay checkout in the system browser. Returns false if rejected. */
  openCheckout: (episodeId: string): Promise<boolean> =>
    ipcRenderer.invoke("nightcell7:open-checkout", episodeId),
});
