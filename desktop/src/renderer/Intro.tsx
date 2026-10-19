// "V Groups presents V-Run": the opening title card on every launch (styles: .vg-* in styles.css, shared
// with FreeToken's intro). Click, Esc or any key skips it; tests turn it off with ?intro=0.
import { useEffect, useState } from "react";
import vgroups from "./brand/vgroups.jpg";
import banner from "./brand/banner.jpg";

const DURATION = 5000;

export function Intro() {
  const [state, setState] = useState<"play" | "leave" | "gone">(() => (new URLSearchParams(location.search).get("intro") === "0" ? "gone" : "play"));
  // only a *playing* intro can be skipped: the key listener lives exactly as long as that state, and
  // "skip" never brings back an intro that has already left (that was the half-second flash on the
  // first key press after the intro had ended by itself)
  const leave = () => setState((s) => (s === "play" ? "leave" : s));
  useEffect(() => {
    if (state !== "play") return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const t = setTimeout(leave, reduce ? 900 : DURATION - 450);
    window.addEventListener("keydown", leave);
    return () => { clearTimeout(t); window.removeEventListener("keydown", leave); };
  }, [state]);
  useEffect(() => {
    if (state !== "leave") return;
    const t = setTimeout(() => setState("gone"), 450);
    return () => clearTimeout(t);
  }, [state]);

  if (state === "gone") return null;
  return (
    <div className={`vg-intro${state === "leave" ? " vg-leave" : ""}`} role="presentation" onClick={leave}>
      <div className="vg-stage vg-group">
        <img src={vgroups} alt="" className="vg-art" />
        <div className="vg-sweep" />
        <div className="vg-presents">presents</div>
      </div>
      <div className="vg-stage vg-product">
        <img src={banner} alt="" className="vg-banner" />
        <div className="vg-sweep" style={{ animationDelay: "2.6s" }} />
      </div>
      <button className="vg-skip" onClick={(e) => { e.stopPropagation(); leave(); }}>Skip intro</button>
      <span className="sr-only">V Groups presents V-Run</span>
    </div>
  );
}
