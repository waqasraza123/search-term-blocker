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

## Install (Firefox, permanent)

1. Build a ZIP with manifest.json at the archive root: `cd src && zip -r ../search-term-blocker.zip .`
2. Sign in to AMO Developer Hub: https://addons.mozilla.org/developers/
3. Click Submit a New Add-on
4. Choose self-distribution / unlisted (host it on your own)
5. Upload `search-term-blocker.zip` and complete submission
6. Open your add-on page and download the signed `.xpi` (Manage Status & Versions)
7. In Firefox, open `about:addons`
8. Go to the Extensions section
9. Click the gear icon and choose Install Add-on From File
10. Select the signed `.xpi` and approve the install prompt
11. More info: https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/ https://extensionworkshop.com/documentation/publish/package-your-extension/ https://support.mozilla.org/en-US/kb/find-and-install-add-ons-add-features-to-firefox

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
