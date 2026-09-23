# Wiring Rules Reader

An offline app for Windows and Android that turns **your own PDF of AS/NZS 3000** into a digital book:

- **Contents**: the Standard's contents pages become a collapsible tree. Tap any entry to go to the clause. The contents pages inside the PDF are clickable too.
- **Tables**: every table in one list, grouped by section or appendix. Filter by number or words (`8.1`, `demand`, `conduit`). Star the tables you use most. The list goes to where each table actually starts, even when an amendment has moved it off the printed page number.
- **Index**: the back-of-book index is searchable, and every clause number in it is a link. The index pages in the PDF are clickable as well.
- **Cross-references**: "see Clause 2.6.3", "Table 3.2" and "Appendix C" are underlined links on every page. **Back** returns you to where you were. The Android back gesture does the same.
- **Search and jump**: type words for full-text search (put a phrase in "quotes"). Type `3.4.2`, `T 8.1`, `Table C1`, `fig 1.1`, `App C` or `p 158` and press Enter to jump straight there.
- **Bookmarks**: tap the bookmark icon (or press **B**) to save the page. Bookmarks are named after the clause or table on the page, and you can rename them. Use **Saved → Copy bookmarks** to move them to another device.
- **Changes (NZ quick reference)**: the biggest changes from AS/NZS 3000:2007 to 2018 for New Zealand. It covers RCDs, AFDDs, switchboards, earthing, EV charging, damp areas and testing, and each item links to its clause. It also lists the modifications made by the Electricity (Safety) Amendment Regulations 2025, a countdown to 13 November 2026 (when the 2018 edition becomes mandatory for new work), and every NZ-only clause found in your copy.
- **Zs check (Table 8.1)**: choose the MCB type (B, C or D) and rating, then type your earth fault-loop reading. The result turns green if the reading is at or below the maximum and red if it's over, and shows how much margin you have. Tap any cell in the table to select it. Add readings to a test log on the device and copy the log into a spreadsheet. The MCB limits are calculated as 230 V ÷ mean instantaneous trip current (4×, 7.5× and 12.5× In) and match Table 8.1 exactly. For fuses, see Table 8.1 in your PDF.
- **Amendment PDFs**: add a new amendment, ruling or corrigendum under **Changes → Add amendment PDF** (or ⋮ → Add amendment PDF). Every clause, table or figure it mentions gets a marker (e.g. `A4`) in Contents and Tables. A notice appears when you're reading one of those clauses, with a button that opens the change. Search covers the amendment PDFs too.
- Dark theme, an optional dark-page mode, pinch zoom and Ctrl+scroll zoom.

The PDF is processed and stored **only on the device**. Nothing is uploaded, and the app has no server.

## 1. Put the app online (once, free, about 5 minutes)

Windows and Android only install web apps from an `https://` address. Host this folder on a free static host. The folder contains only app code and none of the Standard.

**Easiest: Netlify Drop**
1. Unzip `wiring-rules-reader.zip`.
2. Go to https://app.netlify.com/drop and drag the unzipped `wiring-rules-reader` folder onto the page.
3. Sign up or claim the site so it stays up. You'll get an address such as `https://your-name.netlify.app`.

**Or GitHub Pages**: create a repository, upload the folder's contents, then turn on Settings → Pages (branch `main`, folder `/`).

## 2. Install it

**Windows (Edge or Chrome)**: open your site address. Click the install icon in the address bar (or ⋯ → Apps → *Install this site as an app*). The app gets a Start-menu entry, runs in its own window and works offline. Once installed on Windows, it can also appear in **Open with** for PDF files.

**Android (Chrome)**: open your site address. Tap ⋮ → **Install app** (or *Add to Home screen*). Open it from the home screen.

## 3. Open the Standard

Tap **Choose PDF** and select your AS/NZS 3000 PDF. The first open reads every page to build the contents, tables list and index. That takes roughly 20–60 seconds for about 600 pages, and a progress bar shows how far it has got. After that the app remembers the PDF, and it opens instantly at the page where you left off.

**⋮ → My documents** lists PDFs saved on the device. You can remove any of them there, for example when a new amendment arrives. **⋮ → Rebuild contents & index** re-reads the current PDF.

## Keyboard (Windows)

`Ctrl+F` or `/` search · `B` bookmark · `Backspace` or `Alt+←` back · `←` `→` previous/next page · `+` `−` zoom

## Notes

- Your copy of the Standard is licensed to you. Storing it in the app is the same as keeping the PDF on the device, so follow the terms your copy came with.
- The Changes section is a summary written for this app. It is not the Standard's text, so always read the clause. Its sources are the Standard's preface ("Changes in this edition") and amendment control sheet, the Electricity (Safety) Amendment Regulations 2025 (LI 2025/225) and WorkSafe's guidance. It was checked in September 2026.
- Built with Mozilla PDF.js (Apache 2.0, see `vendor/PDFJS-LICENSE.txt`).
- To update the app later, replace the files on your host. Installed copies pick up the change the next time they open while online.
