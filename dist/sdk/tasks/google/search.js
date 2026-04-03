import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withWebBrowser } from '../../web.js';
import { GOOGLE_HUMAN_VERIFICATION_PREDICATE, waitForGoogleHumanVerificationIfNeeded, } from '../shared/human-verification.js';
const DEFAULT_RESULT_COUNT = 10;
const MAX_RESULT_COUNT = 100;
const GOOGLE_ADVANCED_SEARCH_URL = 'https://www.google.com/advanced_search';
const GOOGLE_SEARCH_RESULTS_SELECTOR = '#search';
const GOOGLE_RESULT_BLOCK_SELECTOR = '#search .MjjYud';
const GOOGLE_PAGINATION_ROOT_SELECTOR = '#botstuff, #foot, nav, [role="navigation"], table[role="presentation"]';
const GOOGLE_ADVANCED_SEARCH_READY_PREDICATE = `Boolean(
  document.querySelector('form[action="/search"]') ||
  document.querySelector('form[action="https://www.google.com/search"]')
)`;
const GOOGLE_SEARCH_RESULTS_READY_PREDICATE = `Boolean(
  document.querySelector(${JSON.stringify(GOOGLE_SEARCH_RESULTS_SELECTOR)}) ||
  /did not match any documents|no results found for/i.test((document.body?.innerText || ''))
)`;
export async function searchGoogle(options) {
    const resolvedOptions = resolveGoogleSearchOptions(options);
    const outcome = await withWebBrowser(async (browser) => {
        const tab = await browser.openTab(GOOGLE_ADVANCED_SEARCH_URL, {
            active: true,
        });
        try {
            await waitForGoogleAdvancedSearchReady(tab);
            const applied = await applyGoogleAdvancedSearchForm(tab, resolvedOptions);
            if (applied.errors.length > 0) {
                throw new Error(applied.errors.join('\n'));
            }
            if (applied.captcha) {
                return {
                    selectedOptions: applied.selectedOptions,
                    firstSnapshot: {
                        page: applied.page,
                        resultStats: null,
                        noResults: false,
                        captcha: true,
                        candidates: [],
                        nextPageUrl: null,
                        nextPageAvailable: false,
                    },
                    finalSnapshot: {
                        page: applied.page,
                        resultStats: null,
                        noResults: false,
                        captcha: true,
                        candidates: [],
                        nextPageUrl: null,
                        nextPageAvailable: false,
                    },
                    pagesVisited: 0,
                    results: [],
                };
            }
            await submitGoogleAdvancedSearch(tab);
            let snapshot = await waitForGoogleSearchResultsReady(tab);
            const firstSnapshot = snapshot;
            const selectedOptions = applied.selectedOptions;
            const seenKeys = new Set();
            const collectedResults = [];
            const pagesToScan = Math.max(1, Math.ceil(resolvedOptions.count / 10) + 3);
            let pagesVisited = 0;
            for (let pageIndex = 0; pageIndex < pagesToScan; pageIndex += 1) {
                pagesVisited += 1;
                if (snapshot.captcha) {
                    break;
                }
                const pageResults = selectOrganicGoogleSearchResults(snapshot.candidates);
                appendUniqueGoogleSearchResults(collectedResults, seenKeys, pageResults, resolvedOptions.count);
                if (collectedResults.length >= resolvedOptions.count) {
                    break;
                }
                if (snapshot.noResults || !snapshot.nextPageAvailable) {
                    break;
                }
                const firstResultKey = buildGoogleFirstResultKey(pageResults);
                const nextSnapshot = await goToNextGoogleResultsPage(tab, snapshot.nextPageUrl, snapshot.page.url, firstResultKey);
                if (!nextSnapshot) {
                    break;
                }
                snapshot = nextSnapshot;
            }
            return {
                selectedOptions,
                firstSnapshot,
                finalSnapshot: snapshot,
                pagesVisited,
                results: collectedResults.slice(0, resolvedOptions.count),
            };
        }
        finally {
            await tab.close().catch(() => undefined);
        }
    }, {
        launch: resolvedOptions.launch,
    });
    const status = outcome.finalSnapshot.captcha
        ? 'captcha'
        : outcome.firstSnapshot.noResults
            ? 'no-results'
            : outcome.results.length > 0
                ? 'ok'
                : 'search-unavailable';
    return {
        status,
        page: outcome.finalSnapshot.page,
        query: {
            allWords: resolvedOptions.allWords,
            exactPhrase: resolvedOptions.exactPhrase,
            anyWords: resolvedOptions.anyWords,
            noneWords: resolvedOptions.noneWords,
            minNumber: resolvedOptions.minNumber,
            maxNumber: resolvedOptions.maxNumber,
            siteOrDomain: resolvedOptions.siteOrDomain,
        },
        selectedOptions: outcome.selectedOptions,
        requestedCount: resolvedOptions.count,
        collectedCount: outcome.results.length,
        pagesVisited: outcome.pagesVisited,
        resultStats: outcome.firstSnapshot.resultStats,
        results: outcome.results,
    };
}
export function resolveGoogleSearchOptions(options) {
    const allWords = normalizeGoogleSearchTerms(options.allWords ?? options.query);
    const exactPhrase = normalizeGoogleSearchScalar(options.exactPhrase);
    const anyWords = normalizeGoogleSearchTerms(options.anyWords);
    const noneWords = normalizeGoogleSearchTerms(options.noneWords);
    const minNumber = normalizeGoogleSearchScalar(options.minNumber);
    const maxNumber = normalizeGoogleSearchScalar(options.maxNumber);
    const siteOrDomain = normalizeGoogleSearchScalar(options.siteOrDomain);
    if (!allWords &&
        !exactPhrase &&
        !anyWords &&
        !noneWords &&
        !minNumber &&
        !maxNumber &&
        !siteOrDomain) {
        throw new Error('Google search requires at least one of query/allWords, exactPhrase, anyWords, noneWords, numbers, or siteOrDomain.');
    }
    const resolved = {
        allWords,
        exactPhrase,
        anyWords,
        noneWords,
        minNumber,
        maxNumber,
        siteOrDomain,
        count: normalizeRequestedCount(options.count),
        launch: options.launch ?? true,
    };
    const language = normalizeOptionalRequestedOption(options.language);
    const region = normalizeOptionalRequestedOption(options.region);
    const lastUpdate = normalizeOptionalRequestedOption(options.lastUpdate);
    const termsAppearing = normalizeOptionalRequestedOption(options.termsAppearing);
    const fileType = normalizeOptionalRequestedOption(options.fileType);
    const usageRights = normalizeOptionalRequestedOption(options.usageRights);
    if (language) {
        resolved.language = language;
    }
    if (region) {
        resolved.region = region;
    }
    if (lastUpdate) {
        resolved.lastUpdate = lastUpdate;
    }
    if (termsAppearing) {
        resolved.termsAppearing = termsAppearing;
    }
    if (fileType) {
        resolved.fileType = fileType;
    }
    if (usageRights) {
        resolved.usageRights = usageRights;
    }
    return resolved;
}
export function findGoogleSelectOptionMatch(options, requested) {
    const normalizedRequested = normalizeGoogleSearchText(requested);
    if (!normalizedRequested) {
        return undefined;
    }
    return (options.find((option) => option.value === requested) ??
        options.find((option) => normalizeGoogleSearchText(option.label) === normalizedRequested) ??
        options.find((option) => normalizeGoogleSearchText(option.value) === normalizedRequested));
}
export function parseGoogleSearchCliArgs(argv) {
    if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
        throw new Error(createGoogleSearchUsage());
    }
    const options = {};
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (!arg) {
            continue;
        }
        if (arg === '--query' || arg === '--all-words' || arg === '-q') {
            const rawValue = argv[index + 1];
            if (rawValue === undefined) {
                throw new Error(`Missing value for ${arg}`);
            }
            options.allWords = rawValue;
            index += 1;
            continue;
        }
        if (arg.startsWith('--query=')) {
            options.allWords = arg.slice('--query='.length);
            continue;
        }
        if (arg.startsWith('--all-words=')) {
            options.allWords = arg.slice('--all-words='.length);
            continue;
        }
        if (arg.startsWith('-q=')) {
            options.allWords = arg.slice('-q='.length);
            continue;
        }
        if (arg === '--exact-phrase') {
            const rawValue = argv[index + 1];
            if (rawValue === undefined) {
                throw new Error('Missing value for --exact-phrase');
            }
            options.exactPhrase = rawValue;
            index += 1;
            continue;
        }
        if (arg.startsWith('--exact-phrase=')) {
            options.exactPhrase = arg.slice('--exact-phrase='.length);
            continue;
        }
        if (arg === '--any-words') {
            const rawValue = argv[index + 1];
            if (rawValue === undefined) {
                throw new Error('Missing value for --any-words');
            }
            options.anyWords = rawValue;
            index += 1;
            continue;
        }
        if (arg.startsWith('--any-words=')) {
            options.anyWords = arg.slice('--any-words='.length);
            continue;
        }
        if (arg === '--none-words') {
            const rawValue = argv[index + 1];
            if (rawValue === undefined) {
                throw new Error('Missing value for --none-words');
            }
            options.noneWords = rawValue;
            index += 1;
            continue;
        }
        if (arg.startsWith('--none-words=')) {
            options.noneWords = arg.slice('--none-words='.length);
            continue;
        }
        if (arg === '--min-number') {
            const rawValue = argv[index + 1];
            if (rawValue === undefined) {
                throw new Error('Missing value for --min-number');
            }
            options.minNumber = rawValue;
            index += 1;
            continue;
        }
        if (arg.startsWith('--min-number=')) {
            options.minNumber = arg.slice('--min-number='.length);
            continue;
        }
        if (arg === '--max-number') {
            const rawValue = argv[index + 1];
            if (rawValue === undefined) {
                throw new Error('Missing value for --max-number');
            }
            options.maxNumber = rawValue;
            index += 1;
            continue;
        }
        if (arg.startsWith('--max-number=')) {
            options.maxNumber = arg.slice('--max-number='.length);
            continue;
        }
        if (arg === '--language') {
            const rawValue = argv[index + 1];
            if (rawValue === undefined) {
                throw new Error('Missing value for --language');
            }
            options.language = rawValue;
            index += 1;
            continue;
        }
        if (arg.startsWith('--language=')) {
            options.language = arg.slice('--language='.length);
            continue;
        }
        if (arg === '--region') {
            const rawValue = argv[index + 1];
            if (rawValue === undefined) {
                throw new Error('Missing value for --region');
            }
            options.region = rawValue;
            index += 1;
            continue;
        }
        if (arg.startsWith('--region=')) {
            options.region = arg.slice('--region='.length);
            continue;
        }
        if (arg === '--last-update') {
            const rawValue = argv[index + 1];
            if (rawValue === undefined) {
                throw new Error('Missing value for --last-update');
            }
            options.lastUpdate = rawValue;
            index += 1;
            continue;
        }
        if (arg.startsWith('--last-update=')) {
            options.lastUpdate = arg.slice('--last-update='.length);
            continue;
        }
        if (arg === '--site-or-domain' || arg === '--site') {
            const rawValue = argv[index + 1];
            if (rawValue === undefined) {
                throw new Error(`Missing value for ${arg}`);
            }
            options.siteOrDomain = rawValue;
            index += 1;
            continue;
        }
        if (arg.startsWith('--site-or-domain=')) {
            options.siteOrDomain = arg.slice('--site-or-domain='.length);
            continue;
        }
        if (arg.startsWith('--site=')) {
            options.siteOrDomain = arg.slice('--site='.length);
            continue;
        }
        if (arg === '--terms-appearing') {
            const rawValue = argv[index + 1];
            if (rawValue === undefined) {
                throw new Error('Missing value for --terms-appearing');
            }
            options.termsAppearing = rawValue;
            index += 1;
            continue;
        }
        if (arg.startsWith('--terms-appearing=')) {
            options.termsAppearing = arg.slice('--terms-appearing='.length);
            continue;
        }
        if (arg === '--file-type') {
            const rawValue = argv[index + 1];
            if (rawValue === undefined) {
                throw new Error('Missing value for --file-type');
            }
            options.fileType = rawValue;
            index += 1;
            continue;
        }
        if (arg.startsWith('--file-type=')) {
            options.fileType = arg.slice('--file-type='.length);
            continue;
        }
        if (arg === '--usage-rights') {
            const rawValue = argv[index + 1];
            if (rawValue === undefined) {
                throw new Error('Missing value for --usage-rights');
            }
            options.usageRights = rawValue;
            index += 1;
            continue;
        }
        if (arg.startsWith('--usage-rights=')) {
            options.usageRights = arg.slice('--usage-rights='.length);
            continue;
        }
        if (arg === '--count' || arg === '-n') {
            const rawValue = argv[index + 1];
            if (!rawValue) {
                throw new Error(`Missing value for ${arg}`);
            }
            options.count = parsePositiveInteger(rawValue, arg);
            index += 1;
            continue;
        }
        if (arg.startsWith('--count=')) {
            options.count = parsePositiveInteger(arg.slice('--count='.length), '--count');
            continue;
        }
        if (arg === '--no-launch') {
            options.launch = false;
            continue;
        }
    }
    return resolveGoogleSearchOptions(options);
}
export function selectOrganicGoogleSearchResults(candidates) {
    const seenKeys = new Set();
    const results = [];
    let skippingSponsoredSection = false;
    for (const candidate of candidates) {
        if (isGoogleSponsoredSectionStart(candidate)) {
            skippingSponsoredSection = true;
            continue;
        }
        if (skippingSponsoredSection) {
            if (isGoogleSearchCandidateBlank(candidate)) {
                skippingSponsoredSection = false;
            }
            continue;
        }
        const url = normalizeNullableGoogleSearchField(candidate.resolvedHref);
        const title = normalizeNullableGoogleSearchField(candidate.title);
        if (!url || !title) {
            continue;
        }
        const rawHref = normalizeNullableGoogleSearchField(candidate.rawHref);
        if (isGoogleInternalSearchUrl(rawHref) || isGoogleInternalSearchUrl(url)) {
            continue;
        }
        const key = buildGoogleSearchResultKey(title, url);
        if (seenKeys.has(key)) {
            continue;
        }
        seenKeys.add(key);
        results.push({
            index: results.length,
            title,
            url,
            siteName: normalizeNullableGoogleSearchField(candidate.siteName),
            displayUrl: normalizeNullableGoogleSearchField(candidate.displayUrl),
            snippet: buildGoogleSearchSnippet(candidate),
            textSnippet: previewGoogleSearchText(candidate.text, 280),
        });
    }
    return results;
}
function normalizeGoogleSearchTerms(value) {
    if (value === undefined) {
        return '';
    }
    const rawValues = Array.isArray(value) ? value : [value];
    return rawValues
        .map((entry) => normalizeGoogleSearchScalar(entry))
        .filter((entry) => entry.length > 0)
        .join(' ');
}
function normalizeGoogleSearchScalar(value) {
    if (value === undefined) {
        return '';
    }
    return String(value).trim();
}
function normalizeOptionalRequestedOption(value) {
    const normalized = normalizeGoogleSearchScalar(value);
    return normalized.length > 0 ? normalized : undefined;
}
function normalizeRequestedCount(value) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        return DEFAULT_RESULT_COUNT;
    }
    return Math.max(1, Math.min(MAX_RESULT_COUNT, Math.floor(value)));
}
function parsePositiveInteger(value, flag) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`Expected a positive integer for ${flag}. Received: ${value}`);
    }
    return parsed;
}
function normalizeGoogleSearchText(value) {
    return cleanGoogleSearchText(value).toLowerCase();
}
function cleanGoogleSearchText(value) {
    return value.replace(/\s+/g, ' ').trim();
}
function normalizeNullableGoogleSearchField(value) {
    if (!value) {
        return null;
    }
    const normalized = value.replace(/\s+/g, ' ').trim();
    return normalized.length > 0 ? normalized : null;
}
function previewGoogleSearchText(value, maxLength) {
    const normalized = normalizeNullableGoogleSearchField(value) ?? '';
    if (normalized.length <= maxLength) {
        return normalized;
    }
    return `${normalized.slice(0, maxLength - 1)}…`;
}
function buildGoogleSearchSnippet(candidate) {
    const snippet = normalizeNullableGoogleSearchField(candidate.snippet);
    if (snippet) {
        return snippet;
    }
    const text = normalizeNullableGoogleSearchField(candidate.text) ?? '';
    if (!text) {
        return '';
    }
    const prefixes = [
        normalizeNullableGoogleSearchField(candidate.title),
        normalizeNullableGoogleSearchField(candidate.siteName),
        normalizeNullableGoogleSearchField(candidate.displayUrl),
    ].filter((value) => Boolean(value));
    let remainder = text;
    for (const prefix of prefixes) {
        if (remainder.startsWith(prefix)) {
            remainder = remainder.slice(prefix.length).trim();
        }
    }
    return remainder || text;
}
function isGoogleSponsoredSectionStart(candidate) {
    const text = normalizeNullableGoogleSearchField(candidate.text) ?? '';
    if (!text) {
        return false;
    }
    return (/^(ads?|sponsored)\b/i.test(text) ||
        /\boffers from advertisers\b/i.test(text) ||
        /\bthese searches help you find relevant offers from advertisers\b/i.test(text));
}
function isGoogleSearchCandidateBlank(candidate) {
    return (!normalizeNullableGoogleSearchField(candidate.title) &&
        !normalizeNullableGoogleSearchField(candidate.resolvedHref) &&
        !normalizeNullableGoogleSearchField(candidate.text));
}
function isGoogleInternalSearchUrl(rawUrl) {
    if (!rawUrl) {
        return false;
    }
    try {
        const url = new URL(rawUrl, 'https://www.google.com');
        const isGoogleHost = /(^|\.)google\./i.test(url.hostname);
        if (!isGoogleHost) {
            return false;
        }
        return url.pathname === '/search' || url.pathname === '/url';
    }
    catch {
        return rawUrl.startsWith('/search') || rawUrl.startsWith('/url?');
    }
}
function buildGoogleSearchResultKey(title, url) {
    return `${normalizeGoogleSearchText(title)}|${canonicalizeGoogleSearchResultUrl(url)}`;
}
function buildGoogleFirstResultKey(results) {
    const first = results[0];
    if (!first) {
        return null;
    }
    return buildGoogleSearchResultKey(first.title, first.url);
}
function canonicalizeGoogleSearchResultUrl(rawUrl) {
    try {
        const url = new URL(rawUrl);
        url.hash = '';
        return url.toString();
    }
    catch {
        return rawUrl;
    }
}
export function isGoogleSearchPaginationUrl(rawUrl, pageUrl) {
    if (!rawUrl) {
        return false;
    }
    try {
        const currentPageUrl = new URL(pageUrl);
        const resolvedUrl = new URL(rawUrl, currentPageUrl);
        if (resolvedUrl.origin !== currentPageUrl.origin) {
            return false;
        }
        if (resolvedUrl.pathname !== '/search') {
            return false;
        }
        return resolvedUrl.searchParams.has('start') || resolvedUrl.searchParams.get('sa') === 'N';
    }
    catch {
        return false;
    }
}
export function pickGoogleSearchNextPageCandidate(candidates, pageUrl) {
    const dedupedCandidates = new Map();
    for (const candidate of candidates) {
        const key = [
            candidate.href || '',
            candidate.id || '',
            normalizeGoogleSearchText(candidate.text),
            normalizeGoogleSearchText(candidate.ariaLabel || ''),
        ].join('|');
        if (!dedupedCandidates.has(key)) {
            dedupedCandidates.set(key, candidate);
        }
    }
    const scoredCandidates = Array.from(dedupedCandidates.values())
        .filter((candidate) => {
        const text = normalizeGoogleSearchText(candidate.text);
        const ariaLabel = normalizeGoogleSearchText(candidate.ariaLabel || '');
        const looksLikeNextControl = candidate.id === 'pnnext' || text === 'next' || /\bnext\b/.test(ariaLabel);
        return looksLikeNextControl && isGoogleSearchPaginationUrl(candidate.href, pageUrl);
    })
        .map((candidate) => ({
        candidate,
        score: (candidate.id === 'pnnext' ? 100 : 0) +
            (candidate.inResultsFooter ? 20 : 0) +
            (candidate.inPaginationTable ? 10 : 0) +
            (candidate.inNavigationRegion ? 5 : 0),
    }))
        .sort((left, right) => right.score - left.score);
    return scoredCandidates[0]?.candidate;
}
function appendUniqueGoogleSearchResults(target, seenKeys, pageResults, count) {
    for (const result of pageResults) {
        const key = buildGoogleSearchResultKey(result.title, result.url);
        if (seenKeys.has(key)) {
            continue;
        }
        seenKeys.add(key);
        target.push({
            ...result,
            index: target.length,
        });
        if (target.length >= count) {
            return;
        }
    }
}
async function waitForGoogleAdvancedSearchReady(tab) {
    await tab.waitForLoad({ timeoutMs: 30_000 });
    await tab.waitFor({ selector: 'body' });
    await tab.waitFor({
        predicate: `Boolean(
      ${GOOGLE_ADVANCED_SEARCH_READY_PREDICATE} ||
      ${GOOGLE_HUMAN_VERIFICATION_PREDICATE}
    )`,
        timeoutMs: 30_000,
    });
    await waitForGoogleHumanVerificationIfNeeded(tab, {
        readyPredicate: GOOGLE_ADVANCED_SEARCH_READY_PREDICATE,
        label: 'Google advanced search verification',
    });
    await tab.waitFor({
        predicate: GOOGLE_ADVANCED_SEARCH_READY_PREDICATE,
        timeoutMs: 30_000,
    });
    await tab.waitForIdle(1_000);
}
async function applyGoogleAdvancedSearchForm(tab, options) {
    return await tab.evaluate(`(() => {
      const payload = ${JSON.stringify(options)};
      const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim();
      const errors = [];
      const selectedOptions = {};

      const bodyText = normalize(document.body?.innerText || '');
      const captcha = Boolean(${GOOGLE_HUMAN_VERIFICATION_PREDICATE});

      if (captcha) {
        return {
          page: {
            title: document.title,
            url: window.location.href,
            route: \`\${window.location.pathname}\${window.location.search}\${window.location.hash}\`,
          },
          captcha,
          selectedOptions,
          errors,
        };
      }

      const fillTextInput = (name, value) => {
        const input = document.querySelector(\`input[name="\${name}"]\`);
        if (!(input instanceof HTMLInputElement)) {
          errors.push(\`Missing input field: \${name}\`);
          return;
        }

        input.focus();
        input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      };

      const findRequestedOptionMatch = (options, requestedValue) => {
        const normalizedRequested = normalize(requestedValue).toLowerCase();
        return (
          options.find((option) => option.value === requestedValue) ||
          options.find((option) => option.label.toLowerCase() === normalizedRequested) ||
          options.find((option) => option.value.toLowerCase() === normalizedRequested)
        );
      };

      const clickWidgetElement = (element) => {
        if (!(element instanceof HTMLElement)) {
          return;
        }

        element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
        element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
        element.click();
      };

      const setSelectField = (fieldName, requestedValue, resultKey) => {
        if (!requestedValue) {
          return;
        }

        const select = document.querySelector(\`select[name="\${fieldName}"]\`);
        if (select instanceof HTMLSelectElement) {
          const options = Array.from(select.options).map((option) => ({
            value: option.value,
            label: normalize(option.textContent || ''),
          }));
          const match = findRequestedOptionMatch(options, requestedValue);

          if (!match) {
            errors.push(
              \`Unknown option for \${fieldName}: \${requestedValue}. Available: \${options
                .map((option) => option.label || option.value)
                .filter(Boolean)
                .join(', ')}\`
            );
            return;
          }

          select.value = match.value;
          select.dispatchEvent(new Event('input', { bubbles: true }));
          select.dispatchEvent(new Event('change', { bubbles: true }));
          selectedOptions[resultKey] = {
            requested: requestedValue,
            value: match.value,
            label: match.label,
          };
          return;
        }

        const widgetInput =
          document.querySelector(\`input[name="\${fieldName}"]\`) ||
          document.getElementById(\`\${fieldName}_input\`);
        const widgetButton = document.getElementById(\`\${fieldName}_button\`);
        const widgetMenu = document.getElementById(\`\${fieldName}_menu\`);
        const widgetOptions =
          widgetMenu instanceof HTMLElement
            ? Array.from(widgetMenu.querySelectorAll('.goog-menuitem')).map((item) => ({
                value: item.getAttribute('value') || '',
                label: normalize(item.textContent || ''),
                element: item,
              }))
            : [];

        if (!(widgetInput instanceof HTMLInputElement) || widgetOptions.length === 0) {
          errors.push(\`Missing select field: \${fieldName}\`);
          return;
        }

        const match = findRequestedOptionMatch(widgetOptions, requestedValue);
        if (!match) {
          errors.push(
            \`Unknown option for \${fieldName}: \${requestedValue}. Available: \${widgetOptions
              .map((option) => option.label || option.value)
              .filter(Boolean)
              .join(', ')}\`
          );
          return;
        }

        if (widgetButton instanceof HTMLElement) {
          clickWidgetElement(widgetButton);
        }
        if (match.element instanceof HTMLElement) {
          clickWidgetElement(match.element);
        }

        widgetInput.value = match.value;
        widgetInput.dispatchEvent(new Event('input', { bubbles: true }));
        widgetInput.dispatchEvent(new Event('change', { bubbles: true }));

        const widgetCaption =
          widgetButton instanceof HTMLElement
            ? widgetButton.querySelector('.goog-flat-menu-button-caption')
            : null;
        if (widgetCaption instanceof HTMLElement) {
          widgetCaption.textContent = match.label;
        }

        selectedOptions[resultKey] = {
          requested: requestedValue,
          value: match.value,
          label: match.label,
        };
      };

      fillTextInput('as_q', payload.allWords);
      fillTextInput('as_epq', payload.exactPhrase);
      fillTextInput('as_oq', payload.anyWords);
      fillTextInput('as_eq', payload.noneWords);
      fillTextInput('as_nlo', payload.minNumber);
      fillTextInput('as_nhi', payload.maxNumber);
      fillTextInput('as_sitesearch', payload.siteOrDomain);

      setSelectField('lr', payload.language, 'language');
      setSelectField('cr', payload.region, 'region');
      setSelectField('as_qdr', payload.lastUpdate, 'lastUpdate');
      setSelectField('as_occt', payload.termsAppearing, 'termsAppearing');
      setSelectField('as_filetype', payload.fileType, 'fileType');
      setSelectField('as_rights', payload.usageRights, 'usageRights');

      return {
        page: {
          title: document.title,
          url: window.location.href,
          route: \`\${window.location.pathname}\${window.location.search}\${window.location.hash}\`,
        },
        captcha,
        selectedOptions,
        errors,
      };
    })()`, {
        returnByValue: true,
    });
}
async function submitGoogleAdvancedSearch(tab) {
    await tab.evaluate(`(() => {
      const submit = Array.from(
        document.querySelectorAll('input[type="submit"], button[type="submit"]')
      ).find((element) => {
        const text =
          element instanceof HTMLInputElement
            ? element.value
            : element instanceof HTMLElement
              ? element.innerText || element.textContent || ''
              : '';
        return /advanced search/i.test((text || '').trim());
      });

      if (!(submit instanceof HTMLElement)) {
        throw new Error('Could not find the Google Advanced Search submit control.');
      }

      submit.click();
      return true;
    })()`, {
        returnByValue: true,
        userGesture: true,
    });
}
async function waitForGoogleSearchResultsReady(tab) {
    await tab.waitFor({ selector: 'body' });
    await tab.waitFor({
        predicate: `Boolean(
      ${GOOGLE_SEARCH_RESULTS_READY_PREDICATE} ||
      ${GOOGLE_HUMAN_VERIFICATION_PREDICATE}
    )`,
        timeoutMs: 30_000,
    });
    await waitForGoogleHumanVerificationIfNeeded(tab, {
        readyPredicate: GOOGLE_SEARCH_RESULTS_READY_PREDICATE,
        label: 'Google search verification',
    });
    await tab.waitFor({
        predicate: GOOGLE_SEARCH_RESULTS_READY_PREDICATE,
        timeoutMs: 30_000,
    });
    await tab.waitForLoad({ timeoutMs: 30_000 });
    await tab.waitForIdle(1_500);
    return await readGoogleSearchPageSnapshot(tab);
}
async function readGoogleSearchPageSnapshot(tab) {
    const snapshot = await tab.evaluate(`(() => {
      const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim();
      const bodyText = normalize(document.body?.innerText || '');

      const pickPrimaryLink = (block) => {
        const anchors = Array.from(block.querySelectorAll('a[href]'));
        return (
          anchors.find((anchor) => anchor.querySelector('h3')) ||
          anchors.find((anchor) => {
            const href = anchor.getAttribute('href') || '';
            return href.length > 0 && !href.startsWith('#');
          }) ||
          null
        );
      };

      const candidates = Array.from(document.querySelectorAll(${JSON.stringify(GOOGLE_RESULT_BLOCK_SELECTOR)})).map((block, index) => {
        const link = pickPrimaryLink(block);
        const heading = normalize(
          block.querySelector('h3')?.textContent ||
            (link instanceof HTMLAnchorElement ? link.querySelector('h3')?.textContent || '' : '')
        );
        const siteName = normalize(block.querySelector('.VuuXrf')?.textContent || '');
        const displayUrl = normalize(block.querySelector('.tjvcx, cite, .qLRx3b')?.textContent || '');
        const snippet = normalize(
          block.querySelector('.VwiC3b, .yXK7lf, .s3v9rd, .st')?.textContent || ''
        );

        return {
          index,
          title: heading,
          rawHref: link instanceof HTMLAnchorElement ? link.getAttribute('href') : null,
          resolvedHref: link instanceof HTMLAnchorElement ? link.href : null,
          siteName: siteName || null,
          displayUrl: displayUrl || null,
          snippet: snippet || null,
          text: normalize(block.innerText || block.textContent || ''),
        };
      });
      const paginationRoots = Array.from(
        document.querySelectorAll(${JSON.stringify(GOOGLE_PAGINATION_ROOT_SELECTOR)})
      );
      const paginationAnchors =
        paginationRoots.length > 0
          ? paginationRoots.flatMap((root) => Array.from(root.querySelectorAll('a[href]')))
          : Array.from(document.querySelectorAll('a[href]'));
      const seenPaginationKeys = new Set();
      const nextPageCandidates = paginationAnchors.flatMap((anchor) => {
        if (!(anchor instanceof HTMLAnchorElement)) {
          return [];
        }

        const key = [
          anchor.href,
          anchor.id || '',
          normalize(anchor.textContent || ''),
          normalize(anchor.getAttribute('aria-label') || ''),
        ].join('|');
        if (seenPaginationKeys.has(key)) {
          return [];
        }

        seenPaginationKeys.add(key);
        return [
          {
            id: anchor.id || null,
            text: normalize(anchor.textContent || ''),
            ariaLabel: normalize(anchor.getAttribute('aria-label') || '') || null,
            href: anchor.href || anchor.getAttribute('href'),
            inResultsFooter: Boolean(anchor.closest('#botstuff') || anchor.closest('#foot')),
            inNavigationRegion: Boolean(
              anchor.closest('nav') || anchor.closest('[role="navigation"]')
            ),
            inPaginationTable: Boolean(anchor.closest('table[role="presentation"]')),
          },
        ];
      });

      return {
        page: {
          title: document.title,
          url: window.location.href,
          route: \`\${window.location.pathname}\${window.location.search}\${window.location.hash}\`,
        },
        resultStats: normalize(document.querySelector('#result-stats')?.textContent || '') || null,
        noResults: /did not match any documents|no results found for/i.test(bodyText),
        captcha: ${GOOGLE_HUMAN_VERIFICATION_PREDICATE},
        candidates,
        nextPageCandidates,
      };
    })()`, {
        returnByValue: true,
    });
    const nextPageCandidate = pickGoogleSearchNextPageCandidate(snapshot.nextPageCandidates, snapshot.page.url);
    return {
        ...snapshot,
        nextPageUrl: nextPageCandidate?.href ?? null,
        nextPageAvailable: Boolean(nextPageCandidate?.href),
    };
}
async function goToNextGoogleResultsPage(tab, nextPageUrl, previousPageUrl, previousFirstResultKey) {
    if (!nextPageUrl) {
        return null;
    }
    await tab.goto(nextPageUrl, { active: true });
    await tab.waitFor({
        predicate: `window.location.href !== ${JSON.stringify(previousPageUrl)}`,
        timeoutMs: 30_000,
    });
    await tab.waitForLoad({ timeoutMs: 30_000 });
    await tab.waitForIdle(1_000);
    const snapshot = await waitForGoogleSearchResultsReady(tab);
    if (snapshot.page.url === previousPageUrl) {
        return null;
    }
    const currentFirstResultKey = buildGoogleFirstResultKey(selectOrganicGoogleSearchResults(snapshot.candidates));
    if (previousFirstResultKey && currentFirstResultKey === previousFirstResultKey) {
        return null;
    }
    return snapshot;
}
export async function saveGoogleSearchResultToTemp(result) {
    const outputDir = await mkdtemp(join(tmpdir(), 'llm-agents-google-search-'));
    const outputPath = join(outputDir, 'google-search.json');
    await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf-8');
    return outputPath;
}
export function renderGoogleSearchMarkdown(result, outputPath) {
    const lines = [
        '# Google Search',
        '',
        `Raw JSON saved to: \`${outputPath}\``,
        `Status: \`${result.status}\``,
        `Page: ${result.page.title}`,
        `URL: ${result.page.url}`,
        `Result stats: ${result.resultStats ?? 'Unavailable'}`,
        `Pages visited: ${result.pagesVisited}`,
        `Requested organic results: ${result.requestedCount}`,
        `Collected organic results: ${result.collectedCount}`,
        '',
        'Query:',
    ];
    if (result.query.allWords) {
        lines.push(`- All words: ${result.query.allWords}`);
    }
    if (result.query.exactPhrase) {
        lines.push(`- Exact phrase: ${result.query.exactPhrase}`);
    }
    if (result.query.anyWords) {
        lines.push(`- Any words: ${result.query.anyWords}`);
    }
    if (result.query.noneWords) {
        lines.push(`- None words: ${result.query.noneWords}`);
    }
    if (result.query.minNumber || result.query.maxNumber) {
        lines.push(`- Number range: ${result.query.minNumber || '(none)'} to ${result.query.maxNumber || '(none)'}`);
    }
    if (result.query.siteOrDomain) {
        lines.push(`- Site or domain: ${result.query.siteOrDomain}`);
    }
    const selectedOptionLines = renderSelectedGoogleSearchOptions(result.selectedOptions);
    if (selectedOptionLines.length > 0) {
        lines.push('', 'Selected filters:');
        lines.push(...selectedOptionLines);
    }
    if (result.status === 'captcha') {
        lines.push('', 'Google appears to be asking for a CAPTCHA or robot verification, so the search results could not be collected automatically.');
        return `${lines.join('\n')}\n`;
    }
    if (result.status === 'no-results') {
        lines.push('', 'Google did not return any organic results for this advanced search.');
        return `${lines.join('\n')}\n`;
    }
    if (result.status === 'search-unavailable') {
        lines.push('', 'The Google search results page did not become available.');
        return `${lines.join('\n')}\n`;
    }
    if (result.results.length === 0) {
        lines.push('', 'No organic search results were collected.');
        return `${lines.join('\n')}\n`;
    }
    lines.push('', `Top ${result.results.length} collected organic results:`, '');
    for (const item of result.results) {
        lines.push(`${item.index + 1}. **${item.title}**`);
        lines.push(`   URL: ${item.url}`);
        if (item.siteName) {
            lines.push(`   Site: ${item.siteName}`);
        }
        if (item.displayUrl) {
            lines.push(`   Display URL: ${item.displayUrl}`);
        }
        if (item.snippet) {
            lines.push(`   Summary: ${item.snippet}`);
        }
        lines.push('');
    }
    lines.push('Sponsored results were skipped.');
    return `${lines.join('\n')}\n`;
}
export async function runGoogleSearchCli(argv = process.argv.slice(2)) {
    const options = parseGoogleSearchCliArgs(argv);
    const result = await searchGoogle(options);
    const outputPath = await saveGoogleSearchResultToTemp(result);
    process.stdout.write(renderGoogleSearchMarkdown(result, outputPath));
}
function renderSelectedGoogleSearchOptions(selectedOptions) {
    const lines = [];
    const entries = [
        ['Language', selectedOptions.language],
        ['Region', selectedOptions.region],
        ['Last update', selectedOptions.lastUpdate],
        ['Terms appearing', selectedOptions.termsAppearing],
        ['File type', selectedOptions.fileType],
        ['Usage rights', selectedOptions.usageRights],
    ];
    for (const [label, option] of entries) {
        if (!option) {
            continue;
        }
        lines.push(`- ${label}: ${option.label} (${option.value})`);
    }
    return lines;
}
function createGoogleSearchUsage() {
    return `Usage:
  npx @ank1015/llm-extension google search [options]

Options:
  --query, --all-words, -q <text>   Main Google query text for "all these words"
  --exact-phrase <text>             Exact phrase match
  --any-words <text>                Any of these words
  --none-words <text>               Excluded words
  --min-number <value>              Minimum numeric range value
  --max-number <value>              Maximum numeric range value
  --language <value>                Language label or raw Google select value such as "English" or "lang_en"
  --region <value>                  Region label or raw Google select value such as "India" or "countryIN"
  --last-update <value>             Last update filter such as "last 24 hours", "upto a week ago", or "d"
  --site-or-domain, --site <text>   Site or domain filter
  --terms-appearing <value>         "anywhere in the page", "in the title of the page", "title", etc.
  --file-type <value>               File type label or raw value such as "pdf"
  --usage-rights <value>            Usage rights label or raw Google value
  --count, -n <number>              Number of organic results to collect
  --no-launch                       Do not try to launch Chrome automatically

Examples:
  npx @ank1015/llm-extension google search --query "openai" --count 5
  npx @ank1015/llm-extension google search --query "sdk" --site openai.com --language English --count 10
  npx @ank1015/llm-extension google search --exact-phrase "multi agent" --file-type pdf --last-update d`;
}
//# sourceMappingURL=search.js.map