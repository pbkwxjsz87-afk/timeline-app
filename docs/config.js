export const CONFIG = {
  /**
   * URL from the Google Apps Script deployment that fronts your Google Sheet.
   * Leave blank to work entirely offline with localStorage.
   */
  appsScriptUrl: '',
  /**
   * Shared secret that the Apps Script expects in its request payload.
   */
  apiKey: '',
  /**
   * Sheet/tab name that stores the timeline rows.
   */
  sheetName: 'Events',
  /**
   * Automatically fetch from Google Sheets on load when the URL/apiKey are set.
   */
  autoSyncOnLoad: true,
  /**
   * Optional background sync in milliseconds. Set to 0 to disable.
   */
  autoSyncIntervalMs: 5 * 60 * 1000
};
