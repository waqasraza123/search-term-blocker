# Search Term Blocker (Chrome Extension)

A small Manifest V3 Chrome extension I made for myself to stop spiraling into searching for news.
It blocks searches that match your terms and can also block specific websites or URL paths, then it closes the tab, opens a new tab, or shows a blocked page.

## What it does

- Intercepts top-level navigations on supported search engines
- Blocks searches when the query contains a blocked term
- Blocks direct visits to configured URLs and URL paths
  - You can paste URLs with or without http or https
  - You can paste with or without www
  - The blocker will match both versions automatically
- Behavior options:
  - Close tab
  - Replace with New Tab
  - Show a blocked page
- Rules are editable in the extension Options UI

## Supported engines

- Google (all country domains)
- Bing
- DuckDuckGo
- Brave Search

## Install (Developer Mode)

1. Clone this repo
2. Open `chrome://extensions`
3. Enable Developer mode
4. Click Load unpacked
5. Select the `src/` folder

## Configure

- Open extension Details then Extension options
- Add blocked search terms one per line
- Add blocked URLs one per line
  - Examples: `bbc.com`, `bbc.com/news`, `www.reuters.com`
- Pick the behavior

## Notes

- This extension cannot stop you from typing a term, it blocks the navigation before results fully load.
- To use in Incognito: Extension Details then Allow in incognito.
- If you add a lot of terms and URLs, Chrome has a limit on the number of dynamic rules. The extension will stop adding new rules before hitting that limit.

## Development

No build step. Edit files in `src/`, then click Reload on `chrome://extensions`.

## License

MIT
