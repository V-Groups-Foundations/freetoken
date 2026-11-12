import "./monaco";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { Intro } from "./Intro";
import "./styles.css";
import { api } from "./api";

// errors in the window are reported like main-process ones (nothing personal; Settings can turn it off)
window.addEventListener("error", (e) => { api.reportError(String(e.message), e.error?.stack).catch(() => {}); });
window.addEventListener("unhandledrejection", (e) => { const r = e.reason as Error | undefined; api.reportError(String(r?.message ?? r), r?.stack).catch(() => {}); });

createRoot(document.getElementById("root")!).render(<><App /><Intro /></>);
