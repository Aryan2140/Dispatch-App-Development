# Aimex Dispatch

Mobile-first warehouse dispatch app running on a Windows PC host over local Wi-Fi, synced to Google Sheets & Google Drive.

## Features
- **First-Launch Staff Sign-In**: Stores the staff member's name on their phone/iPad and logs it in Google Sheets alongside every dispatch.
- **Tracking Slip OCR**:
  - **Windows Host OCR**: Uses built-in `Windows.Media.Ocr` on the Windows server (~400ms) so mobile devices don't burn battery.
  - **Pre-Warmed Local OCR + Illumination Normalization**: Fast client-side fallback when needed.
  - **Optional Gemini Vision AI**: Configurable in Settings.
- **Minimal Relevant Fields**: Captures Customer Name, Tracking Number, Order Date, Products & Quantities (pre-loaded with the 139-SKU Aimex catalog), and Packaging Photos.
- **Searchable Google Sheets & Drive**: Stores rows and clickable photo thumbnails/folders in Google Drive and Google Sheets (`Search & Dashboard`, `Dispatches`, `Products`).

## Quick Start (Windows Host)
1. Install [Node.js LTS](https://nodejs.org/) (v18+).
2. Right-click **`allow-windows-firewall-port.bat`** and choose **Run as administrator** (one-time setup for local Wi-Fi access).
3. Double-click **`start-dispatch-server.bat`** (opens `http://localhost:3000`).
4. Tap the Wi-Fi icon in the header to scan the QR code from phones or iPads on the same Wi-Fi.

## Quick Start (macOS Testing)
Run `./start-mac.sh` or `node server.js`.

## Google Sheets Setup
1. Open your Google Sheet -> **Extensions -> Apps Script**.
2. Paste the contents of [`google-apps-script/Code.gs`](./google-apps-script/Code.gs) and Save.
3. Click **Deploy -> New deployment -> Web app** (*Execute as: Me*, *Who has access: Anyone*).
4. Copy the Web app URL (`/exec`) into **Settings** in the Dispatch App and click **Initialize Sheet**.
