# Install Bracket Builder on your iPhone (Windows + Sideloadly)

Same routine as SetMetric.

## 1. Get the IPA

1. Open the repository on GitHub → **Actions** → **Build Bracket Builder iPhone App**.
2. Open the latest run with a green tick. (To start one yourself: **Run workflow** → **Run workflow**. It takes about 10 minutes.)
3. Under **Artifacts**, download **BracketBuilder-iPhone-for-Windows** and unzip it once. Inside is `BracketBuilder-iPhone-unsigned.ipa`.

A new build also starts automatically whenever the app's code changes on `main`.

## 2. Install with Sideloadly

1. Connect the iPhone by USB, unlock it, tap **Trust** if asked.
2. Open **Sideloadly**, drag `BracketBuilder-iPhone-unsigned.ipa` in, and use the same Apple ID you use for your other apps.
3. Choose your iPhone and click **Start**.
4. On the phone, trust the developer profile if iOS asks (Settings → General → VPN & Device Management) and turn on Developer Mode if prompted.

Needs iOS 15 or later. It also runs on iPad.

## 3. Keeping your tournaments safe

The app works with no internet and keeps everything on the phone.

- A free Apple ID signature lasts **7 days**. Refresh it with Sideloadly before it expires, using the **same Apple ID**, and **do not delete the app first** — deleting the app deletes its tournaments.
- After each event, open the app's first screen → **On this device** → **Save a backup file** and keep the file somewhere else (Files, WhatsApp to yourself, email).
- **Restore from a backup file** on the same menu brings a backup back. It replaces what is on the phone.
- A free Apple ID can have three sideloaded apps active at once.

## What is different from the server version

- No login, no public live link and no emailed results (those need a server).
- **Big screen** on a tournament shows the tables, queue and rotating brackets on the device itself; mirror the screen to a TV to use it at a venue.
- **Export** opens the iPhone share sheet (Save to Files, AirDrop, Mail, WhatsApp). The two "to print" items share a web page you can open and print.
