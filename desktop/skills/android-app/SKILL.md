---
name: android-app
description: "Turn a website into a native Android app (APK) with V-Run's Publish → Android app, and use what a web page can't: scanning nearby Wi-Fi networks for indoor positioning — which floor or room someone is on — through window.VRunWifi.scan(). Use when the user wants an Android app, an APK, to install the app on their phone, Wi-Fi scanning, indoor or floor detection, or anything a browser page is not allowed to do on a phone."
---

# Android app (Capacitor) and native Wi-Fi scanning

A web page on a phone can't scan Wi-Fi networks or read signal strengths. V-Run wraps the project's site
in a native Android app (Capacitor 8) that can, and builds an APK.

## How the user gets the app
- **Preview → Publish → Android app**: *Build APK* (needs Java 21 + the Android SDK — Android Studio
  installs both) or *Prepare only* (makes the `android/` project without those tools).
- *Install on phone (USB)* installs it with adb (USB debugging on). Or copy the APK to the phone.
- Rebuild after every change to the site: the app carries its own copy of the site.
- Don't edit `android/` by hand unless needed; V-Run adds the Wi-Fi plugin (`WifiScanPlugin.java`, its
  registration in `MainActivity.java`, the location/Wi-Fi permissions) every time it prepares.

## Using Wi-Fi in the page
V-Run adds `vrun-native.js` to the app's copy of the site and loads it before the page's scripts:

```js
if (window.VRunWifi?.available()) {
  const networks = await VRunWifi.scan(); // [{ bssid, ssid, level /* dBm, e.g. -55 */, frequency /* MHz */ }]
}
```
- In a normal browser `available()` is false and `scan()` rejects: always keep a fallback
  (a floor picker, GPS, or a QR code per floor) so the site still works on the web.
- The first `scan()` asks for the location permission (Android requires it to see Wi-Fi networks).
- Android throttles real scans to about 4 per 2 minutes per app; between them `scan()` returns the
  latest results (`fresh: false`). Scan every 30 s or so, not in a tight loop.

## Floor / room detection with Wi-Fi fingerprints (the reliable way)
GPS can't tell floors apart indoors; Wi-Fi signal patterns can.
1. **Calibrate**: on each floor, scan a few times and save a fingerprint: BSSID → average dBm.
   Store fingerprints in the app (localStorage) or on the server so everyone shares them.
2. **Locate**: scan, then compare against each floor's fingerprint — e.g. for every BSSID seen in both,
   sum (a − b)², count a BSSID missing on one side as −100 dBm, and pick the floor with the smallest
   distance (k-nearest-neighbours over several fingerprints per floor is more robust).
3. **Smooth**: use the floor that wins most of the last 3 scans, so a person doesn't flicker between floors.
4. Show the confidence, and let the user correct the floor (and save that as a new fingerprint).

## Sharing location live
Live sharing between phones needs a server (WebSocket or a hosted database): a static website host
can't do it. Keep the server's address configurable, and say so plainly to the user.
