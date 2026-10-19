/**
 * Bridge the V-Run desktop app injects into FreeToken pages it shows (desktop/src/preload/freetoken-bridge.ts).
 * Absent in a normal browser.
 */
interface Window {
  vrun?: {
    /** Open a project in V-Run: its Desktop folder plus the whole conversation. */
    openProject(id: string): Promise<void>;
    /** Give V-Run an ft_ token for this server and switch it to FreeToken. */
    connect(token: string): Promise<void>;
    /** Leave the FreeToken page and go back to V-Run's editor. */
    focus(): Promise<void>;
  };
}
