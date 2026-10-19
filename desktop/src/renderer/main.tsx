import "./monaco";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { Intro } from "./Intro";
import "./styles.css";

createRoot(document.getElementById("root")!).render(<><App /><Intro /></>);
