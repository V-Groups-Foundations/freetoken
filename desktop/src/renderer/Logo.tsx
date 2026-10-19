// V-Run brand art. The square glowing V is the app mark (also assets/icon.png / icon.ico for the window
// and taskbar); the banner ("V RUN — build it for free, use it for free") is the welcome-screen logo.
import banner from "./brand/banner.jpg";
import icon from "./brand/icon.png";

export function Logo({ size = 56 }: { size?: number }) {
  return <img src={icon} width={size} height={size} alt="" aria-hidden className="logo-mark" style={{ borderRadius: size * 0.22 }} />;
}

export function Banner({ width = 520 }: { width?: number }) {
  return <img src={banner} alt="V-Run — build it for free, use it for free" className="logo-banner" style={{ width, maxWidth: "100%" }} />;
}
