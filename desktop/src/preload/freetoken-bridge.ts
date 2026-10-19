// Preload for FreeToken pages shown inside V-Run. Exposes window.vrun so the web app can hand things to
// the desktop app ("Continue in V-Run", "Connect V-Run"). The main process only honours these calls
// from the FreeToken view, on the configured FreeToken origin.
import { contextBridge, ipcRenderer } from "electron";

async function call(ch: string, ...args: unknown[]) {
  const r = (await ipcRenderer.invoke(ch, ...args)) as { ok: true; value: unknown } | { ok: false; error: string };
  if (!r.ok) throw new Error(r.error);
}

contextBridge.exposeInMainWorld("vrun", {
  openProject: (id: string) => call("ftbridge:open-project", String(id)),
  connect: (token: string) => call("ftbridge:connect", String(token)),
  focus: () => call("ftbridge:focus"),
});
