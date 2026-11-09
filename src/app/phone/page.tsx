import { readFileSync } from 'node:fs';
import { headers } from 'next/headers';
import QRCode from 'qrcode';
import { requireUserId } from '@/lib/session';
import { localLoginEnabled, localLoginFile } from '@/server/local-login';
import { isLocalHost, lanAddresses } from '@/server/phone';
import { PageHeader } from '../page-header';

const LAND = '/diet';

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[var(--brand)] text-sm font-bold text-white">{n}</span>
      <div><div className="font-medium">{title}</div><div className="muted text-sm">{children}</div></div>
    </li>
  );
}

/** Scan once with the phone's camera: signed in, no password; then it's an app on the home screen. */
export default async function PhonePage() {
  await requireUserId();
  const host = (await headers()).get('host') ?? 'localhost:3000';
  const port = host.split(':')[1] ?? '80';

  // opened on the phone already (it reached the computer by its Wi-Fi address): just the home-screen step
  if (!isLocalHost(host)) {
    return (
      <div className="space-y-5">
        <PageHeader eyebrow="Phone" title="You're on your phone" subtitle="FreeToken is working here. Make it an app on your home screen:" />
        <div className="card card-pad">
          <ol className="space-y-4">
            <Step n={1} title="iPhone (Safari)">Tap Share <b>⎙</b>, then <b>Add to Home Screen</b>.</Step>
            <Step n={2} title="Android (Chrome)">Tap the menu <b>⋮</b>, then <b>Add to Home screen</b> (or <b>Install app</b>).</Step>
          </ol>
        </div>
      </div>
    );
  }

  const ips = lanAddresses();
  let token = '';
  try { token = readFileSync(localLoginFile(), 'utf8').trim(); } catch { /* started without npm run dev */ }
  const link = ips[0] && token && localLoginEnabled() ? `http://${ips[0]}:${port}/welcome?t=${token}&to=${encodeURIComponent(LAND)}` : null;
  const svg = link ? await QRCode.toString(link, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#0b1020', light: '#ffffff' } }) : null;

  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Phone" title="Use FreeToken on your phone" subtitle="Scan once — your phone is signed in, no password. It works while this computer is on and FreeToken is running." />
      {!link ? (
        <div className="card card-pad space-y-2 text-sm">
          <h2 className="font-semibold">Can&apos;t make a phone link</h2>
          <p className="muted">
            {!ips.length ? "This computer isn't on a Wi-Fi or wired network right now. Connect it, then reload this page."
              : 'Start FreeToken with npm run dev (it creates the sign-in link), then reload this page.'}
          </p>
        </div>
      ) : (
        <div className="grid gap-5 md:grid-cols-[auto_minmax(0,1fr)]">
          <div className="card card-pad flex flex-col items-center gap-3">
            <div className="w-56 overflow-hidden rounded-xl bg-white p-2 [&>svg]:h-auto [&>svg]:w-full" role="img" aria-label="QR code that signs your phone in to FreeToken" dangerouslySetInnerHTML={{ __html: svg! }} />
            <div className="faint text-center font-mono text-xs">{ips[0]}:{port}</div>
          </div>
          <div className="card card-pad space-y-5">
            <ol className="space-y-4">
              <Step n={1} title="Join the same Wi-Fi">Your phone and this computer need to be on the same network.</Step>
              <Step n={2} title="Scan the code with the camera">Open the camera app, point it at the code and tap the link. You land on Diet, signed in.</Step>
              <Step n={3} title="Add it to your home screen">iPhone: Share <b>⎙</b> → <b>Add to Home Screen</b>. Android: menu <b>⋮</b> → <b>Add to Home screen</b>. It then opens like an app.</Step>
            </ol>
            <details className="text-sm">
              <summary className="muted cursor-pointer">Phone can&apos;t open it?</summary>
              <ul className="muted mt-2 list-disc space-y-1 pl-5">
                <li>Check both are on the same Wi-Fi (not the phone&apos;s mobile data). Office and hotel Wi-Fi often keep devices apart — try your home Wi-Fi or your phone&apos;s hotspot.</li>
                <li>Windows may ask once whether Node.js can use the network: allow it on private networks.</li>
                <li>The code changes each time FreeToken restarts; a phone that&apos;s already signed in stays signed in.</li>
                {ips.length > 1 && <li>This computer has more than one address; if the code doesn&apos;t work, try {ips.slice(1).map((ip) => `${ip}:${port}`).join(' or ')} in the phone&apos;s browser and sign in again here.</li>}
              </ul>
            </details>
            <p className="faint text-xs">Anyone who scans this code can use your FreeToken — keep it to yourself.</p>
          </div>
        </div>
      )}
    </div>
  );
}
