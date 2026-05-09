# Tab Management

Tab Management is a small Chrome extension MVP for managing tabs that are already open. The first version stays intentionally compact: fast search, tab switching, closing, pinning, muting, and one-click duplicate cleanup.

## MVP Scope

- List all open tabs grouped by Chrome window.
- Refresh the tab list manually from the popup.
- Search tabs by title or URL.
- Press Enter in the search box to jump to the first match.
- Click a tab to focus its window and switch to it.
- Close individual tabs.
- Close all open tabs across all Chrome windows.
- Pin or unpin individual tabs.
- Mute or unmute individual tabs.
- Close duplicate tabs by normalized exact URL, keeping the active, pinned, or current-window tab when possible.
- Treat `chrome://newtab/` tabs as duplicates; exclude other Chrome internal pages and extension pages.
- Toggle between all windows and the current window when multiple Chrome windows are open; disable that control when only one window is open.

## Run Locally

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked**.
4. Select this folder: `/Users/tianhongw/codes/tabs_manage`.
5. Click the Tab Management icon in the Chrome toolbar.

## Files

- `manifest.json` declares the MV3 extension and `tabs` permission.
- `popup.html` defines the popup structure.
- `styles.css` handles the compact popup UI.
- `popup.js` reads and updates Chrome tabs with the `chrome.tabs` and `chrome.windows` APIs.
- `icons/` contains the extension icon source and generated PNG sizes.

## Useful Next Iterations

- Save and restore tab sessions.
- Add keyboard navigation for search results.
- Group tabs by domain.
- Close all tabs matching the current search.
