// "V Groups presents V-Run": the opening title card on every launch (styles: .vg-* in styles.css, shared
// with FreeToken's intro). Click, Esc or any key skips it; tests turn it off with ?intro=0.
import { useEffect, useState } from "react";
import vgroups from "./brand/vgroups.jpg";
import banner from "./brand/banner.jpg";

const DURATION = 5000;

export function Intro() {
  const [state, setState] = useState<"play" | "leave" | "gone">(() => (new URLSearchParams(location.search).get("intro") === "0" ? "gone" : "play"));
  useEffect(() => {
    if (state !== "play") return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const t1 = setTimeout(() => setState("leave"), reduce ? 900 : DURATION - 450);
    const t2 = setTimeout(() => setState("gone"), reduce ? 1300 : DURATION);
    const skip = () => { setState("leave"); setTimeout(() => setState("gone"), 450); };
    window.addEventListener("keydown", skip, { once: true });
    return () => { clearTimeout(t1); clearTimeout(t2); window.removeEventListener("keydown", skip); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (state === "gone") return null;
  const leave = () => { setState("leave"); setTimeout(() => setState("gone"), 450); };
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
