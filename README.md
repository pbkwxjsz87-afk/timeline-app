# Life Timeline

Interactive vertical timeline that can run on GitHub Pages and syncs events to a Google Sheet via a lightweight Apps Script API. Works fully offline with `localStorage`, but when configured it can `GET/POST/DELETE` events through Sheets so every device stays in sync.

## Quick start

1. Clone the repo and move into it.
2. Optional: copy `config.sample.js` to `config.js` and fill in your Apps Script URL/API key. The existing `config.js` ships with blank values which keeps the app in offline mode.
3. Serve the folder with any static server (required for the `import` used by `app.js`). For example:
   ```bash
   python3 -m http.server 4173
   ```
4. Visit `http://localhost:4173`.

## Deploying on GitHub Pages

1. Commit everything to `main` (or any branch).
2. In **Settings → Pages**, choose *Deploy from a branch*, pick `main` and the `/ (root)` folder. GitHub will publish the static site automatically.
3. Whenever you push to that branch, Pages updates and the app is ready under `https://<username>.github.io/<repo>/`.

## Connecting Google Sheets

### 1. Prepare the sheet
- Create a Google Sheet and name a tab `Events` (or any name that you later reference in `config.js`).
- Add a header row with the following columns: `id`, `dateISO`, `title`, `category`, `notes`, `image`.

### 2. Create an Apps Script web app
1. In the sheet choose **Extensions → Apps Script**.
2. Replace the auto-generated code with the snippet below and update the `API_KEY` and `SHEET_NAME` constants.
3. Click **Deploy → Test deployments → New deployment** (or **Deploy → Manage deployments** depending on the UI) and choose **Web app**.
4. Set *Execute as* to **Me** and *Who has access* to **Anyone**.
5. Deploy and copy the web app URL.

```javascript
const SHEET_NAME = 'Events';
const API_KEY = 'REPLACE_ME';

function doPost(e) {
  const payload = JSON.parse(e.postData.contents);
  if (payload.apiKey !== API_KEY) {
    return respond({ error: 'Unauthorized' }, 403);
  }

  const sheet = SpreadsheetApp.getActive().getSheetByName(payload.sheetName || SHEET_NAME);
  if (!sheet) {
    return respond({ error: 'Sheet not found' }, 404);
  }

  const action = payload.action;
  if (action === 'list') {
    return respond({ events: readRows(sheet) });
  }
  if (action === 'upsert') {
    upsertRow(sheet, payload.event);
    return respond({ ok: true });
  }
  if (action === 'delete') {
    deleteRow(sheet, payload.id);
    return respond({ ok: true });
  }
  return respond({ error: 'Unknown action' }, 400);
}

function readRows(sheet) {
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return [];
  const [headers, ...rows] = values;
  const mapIndex = headers.reduce((acc, key, idx) => ({ ...acc, [key]: idx }), {});
  return rows
    .filter(r => r[mapIndex.id])
    .map(row => ({
      id: row[mapIndex.id],
      dateISO: row[mapIndex.dateISO],
      title: row[mapIndex.title],
      category: row[mapIndex.category],
      notes: row[mapIndex.notes],
      image: row[mapIndex.image]
    }));
}

function upsertRow(sheet, event) {
  if (!event) return;
  const values = sheet.getDataRange().getValues();
  const headers = values[0];
  const mapIndex = headers.reduce((acc, key, idx) => ({ ...acc, [key]: idx }), {});
  const idIdx = mapIndex.id;
  for (let i = 1; i < values.length; i++) {
    if (values[i][idIdx] === event.id) {
      sheet.getRange(i + 1, 1, 1, headers.length).setValues([
        headers.map((h) => event[h] || '')
      ]);
      return;
    }
  }
  sheet.appendRow(headers.map((h) => event[h] || ''));
}

function deleteRow(sheet, id) {
  if (!id) return;
  const values = sheet.getDataRange().getValues();
  const idIdx = values[0].indexOf('id');
  for (let i = 1; i < values.length; i++) {
    if (values[i][idIdx] === id) {
      sheet.deleteRow(i + 1);
      return;
    }
  }
}

function respond(body, status = 200) {
  return ContentService
    .createTextOutput(JSON.stringify(body))
    .setMimeType(ContentService.MimeType.JSON)
    .setResponseCode(status);
}
```

### 3. Point the app to the web app
Edit `config.js`:
```js
export const CONFIG = {
  appsScriptUrl: 'https://script.google.com/macros/s/<deployment-id>/exec',
  apiKey: 'REPLACE_ME',
  sheetName: 'Events',
  autoSyncOnLoad: true,
  autoSyncIntervalMs: 300000
};
```
Commit or keep this file locally depending on whether you want the values in source control. When configured, the UI’s "Sync Sheet" button fetches Google Sheet data, and all saves/deletes propagate through the Apps Script endpoint.

## Data flow
- Local-first: every change immediately updates the in-memory state and `localStorage`.
- Remote (optional): the same payload is sent to the Apps Script endpoint for persistence in your Google Sheet.
- Clicking **Sync Sheet** forces a pull from Sheets; background sync runs every 5 minutes when enabled.

## Project structure
```
index.html       # Static markup
styles.css       # Theme and layout
app.js           # UI logic + Sheets API integration
config.js        # Runtime configuration (safe defaults provided)
config.sample.js # Copy helper for new environments
README.md        # Docs & setup steps
```

## Development tips
- The UI works without the Google backend, so you can iterate locally before enabling Sheets.
- To reset everything quickly, use the **Reset Data** button or clear `localStorage` for the site.
- Use the **Export JSON** / **Import JSON** buttons for manual backups.
