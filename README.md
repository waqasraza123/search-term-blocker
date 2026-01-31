# Search Term Blocker (Chrome Extension)

A tiny Manifest V3 Chrome extension I built for myself to stop searching for “news”.
It blocks searches that contain configured terms and either closes the tab, opens a new tab, or shows a blocked page.

## What it does

- Watches navigations to supported search engines
- If the query contains a blocked term (default: `news`), it blocks the request
- Behavior options:
  - Close tab
  - Replace with New Tab
  - Show a blocked page
- Terms are editable in the extension Options UI

## Supported engines

- Google (all country domains)
- Bing
- DuckDuckGo
- Brave Search

## Install (Developer Mode)

1. Clone this repo
2. Open `chrome://extensions`
3. Enable **Developer mode**
4. Click **Load unpacked**
5. Select the `src/` folder

## Configure

- Open extension **Details → Extension options**
- Add blocked terms (one per line)
- Pick the behavior

## Notes

- This extension cannot stop you from typing a term, it blocks the results page from loading.
- To use in Incognito: Extension **Details → Allow in incognito**

## Development

No build step. Edit files in `src/`, then click **Reload** on `chrome://extensions`.

## License

MIT
