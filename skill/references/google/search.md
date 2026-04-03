# Google Search

Use this reference for the built-in Google advanced-search command.

## What It Does

This action opens [Google Advanced Search](https://www.google.com/advanced_search), fills the real
form fields and advanced filters, submits the search from that page, and returns the top collected
organic Google results.

The script intentionally uses the live Advanced Search form instead of directly constructing a
search URL, because going through the form is more reliable for this workflow and helps avoid the
robot-verification issues that can happen with direct URL construction.

The script prints a readable Markdown summary to stdout and also saves the full structured JSON
result to a temp file.

It is useful for requests like:

- "search Google for OpenAI"
- "find the top 10 Google results for this query"
- "search Google for this exact phrase on a specific site"
- "search Google for PDFs from the last week in English"

## Command To Run

Run the package CLI:

```bash
npx @ank1015/llm-extension google search --query "openai" --count 5
```

## Options

- `--query, --all-words, -q <text>`
  - main Google query text for the "all these words" field
- `--exact-phrase <text>`
  - exact phrase match
- `--any-words <text>`
  - any of these words
- `--none-words <text>`
  - excluded words
- `--min-number <value>`
  - minimum numeric range value
- `--max-number <value>`
  - maximum numeric range value
- `--language <value>`
  - language label or raw Google select value such as `English` or `lang_en`
- `--region <value>`
  - region label or raw Google select value such as `India` or `countryIN`
- `--last-update <value>`
  - last update filter such as `last 24 hours`, `upto a week ago`, or `d`
- `--site-or-domain <text>`
  - site or domain filter
- `--site <text>`
  - alias for `--site-or-domain`
- `--terms-appearing <value>`
  - where the search terms should appear, such as `anywhere in the page` or `title`
- `--file-type <value>`
  - file type label or raw value such as `pdf`
- `--usage-rights <value>`
  - usage rights label or raw Google value
- `--count, -n <number>`
  - number of organic results to collect
  - default: `10`
- `--no-launch`
  - do not try to launch Chrome automatically if the browser bridge is unavailable

At least one query-like filter must be provided, such as `--query`, `--exact-phrase`,
`--any-words`, `--none-words`, a numeric range, or `--site`.

## Accepted Predefined Values

For fields with a fixed Google-controlled menu, the script matches either:

- the visible Google label, such as `English` or `last 24 hours`
- the raw Google value, such as `lang_en` or `d`

Use the visible label when possible. That is usually the easiest option for the agent to infer from
the user request.

Smaller fixed menus are listed below.

### `--last-update`

- `anytime`
  - raw value: `all`
- `last 24 hours`
  - raw value: `d`
- `upto a week ago`
  - raw value: `w`
- `upto a month ago`
  - raw value: `m`
- `upto a year ago`
  - raw value: `y`

### `--terms-appearing`

- `anywhere in the page`
  - raw value: `any`
- `in the title of the page`
  - raw value: `title`
- `in the text of the page`
  - raw value: `body`
- `in the URL of the page`
  - raw value: `url`
- `in links to the page`
  - raw value: `links`

### `--file-type`

- `any format`
  - raw value: empty / omitted
- `Adobe Acrobat PDF (.pdf)`
  - raw value: `pdf`
- `Adobe Postscript (.ps)`
  - raw value: `ps`
- `Autodesk DWF (.dwf)`
  - raw value: `dwf`
- `Google Earth KML (.kml)`
  - raw value: `kml`
- `Google Earth KMZ (.kmz)`
  - raw value: `kmz`
- `Microsoft Excel (.xls)`
  - raw value: `xls`
- `Microsoft PowerPoint (.ppt)`
  - raw value: `ppt`
- `Microsoft Word (.doc)`
  - raw value: `doc`
- `Rich Text Format (.rtf)`
  - raw value: `rtf`
- `Shockwave Flash (.swf)`
  - raw value: `swf`

### `--usage-rights`

- `not filtered by licence`
  - raw value: empty / omitted
- `free to use or share`
  - raw value: `f`
- `free to use or share, even commercially`
  - raw value: `fc`
- `free to use share or modify`
  - raw value: `fm`
- `free to use, share or modify, even commercially`
  - raw value: `fmc`

### `--language`

Google exposes a larger language list here. Prefer the visible label from the page, such as:

- `English`
  - raw value: `lang_en`
- `Hindi`
  - raw value: `lang_hi`
- `Japanese`
  - raw value: `lang_ja`
- `Spanish`
  - raw value: `lang_es`
- `French`
  - raw value: `lang_fr`

The menu currently contains many more languages than the examples above. If the user names a
language directly, pass that label.

### `--region`

Google exposes a large region list here as well. Prefer the visible label from the page, such as:

- `India`
  - raw value: `countryIN`
- `United States`
  - raw value: `countryUS`
- `United Kingdom`
  - raw value: `countryGB`
- `Japan`
  - raw value: `countryJP`

The region list is much larger than the examples above. If the user names a country or region
directly, pass that label.

## Output Behavior

Stdout is a Markdown summary, not raw JSON.

The summary includes:

- the search status
- the temp file path where the raw JSON was saved
- the Google results page title and URL
- result stats, pages visited, requested count, and collected count
- the query fields and selected advanced filters that were actually applied
- the collected organic results with title, URL, display URL, site name, and snippet

Sponsored results are skipped and should not appear in the returned result list.

The saved JSON file has this high-level shape:

```json
{
  "status": "ok",
  "page": {
    "title": "openai - Google Search",
    "url": "https://www.google.com/search?as_q=openai&as_epq=&as_oq=&as_eq=&as_nlo=&as_nhi=&lr=&cr=&as_qdr=all&as_sitesearch=&as_occt=any&as_filetype=&tbs=",
    "route": "/search?as_q=openai&as_epq=&as_oq=&as_eq=&as_nlo=&as_nhi=&lr=&cr=&as_qdr=all&as_sitesearch=&as_occt=any&as_filetype=&tbs="
  },
  "query": {
    "allWords": "openai",
    "exactPhrase": "",
    "anyWords": "",
    "noneWords": "",
    "minNumber": "",
    "maxNumber": "",
    "siteOrDomain": "openai.com"
  },
  "selectedOptions": {
    "language": {
      "requested": "English",
      "value": "lang_en",
      "label": "English"
    }
  },
  "requestedCount": 5,
  "collectedCount": 5,
  "pagesVisited": 1,
  "resultStats": "About 12,300 results (0.22s)",
  "results": [
    {
      "index": 0,
      "title": "OpenAI",
      "url": "https://openai.com/",
      "siteName": "OpenAI",
      "displayUrl": "https://openai.com",
      "snippet": "Official site",
      "textSnippet": "OpenAI https://openai.com Official site"
    }
  ]
}
```

## Status Values

- `ok`
  - the Google results page was read and at least one organic result was collected, or Google
    clearly returned an empty result set
- `no-results`
  - Google did not return any matching organic results for the requested advanced search
- `captcha`
  - Google appears to be asking for CAPTCHA or robot verification instead of returning results
- `search-unavailable`
  - Google loaded, but the expected results view did not become available

## Behavior Notes

- The script opens `https://www.google.com/advanced_search` first and fills the form from the page
  itself instead of constructing a direct search URL.
- It supports both free-text fields and Google-controlled advanced-filter menus by matching either
  the raw Google option value or the visible label.
- It extracts candidate result blocks from the Google results page and filters out sponsored and
  internal Google search blocks before returning results.
- If more results are needed, it follows Google's real `Next` results control and continues
  collecting organic results across pages.
- The JSON result is saved to a temp directory so the caller can still inspect or parse the raw
  structured output.

## When To Fall Back

Do not keep retrying the built-in script if the task is no longer a straightforward web search.

Fall back to the generic browser flow when:

- the user needs a Google property other than standard web search results
- the user needs a highly custom search exploration flow beyond the built-in filters above
- the user needs to inspect page-specific interaction after the search rather than only collecting
  result summaries
- the Google results DOM changed enough that the returned data is clearly wrong
