# Production library verification — 11 September 2026

Target: `https://ted.littlemissscarlett.co/library`.
Netlify published deploy: `6a9fc526610f2efb8c05454f`, locked.
Deployed Git revision: `e1d514ddda3b557a10ef1836a2fb7e1c6f327d1b`.
Local/GitHub source at verification: `c3c2ef6dd49bbdf12330b8a4ae5a0c87b2fc3316`.

## Real-account persistence

Passed through the existing signed-in Chrome session against the production
application, without mocks or a service-role impersonation:

1. An existing item's initial bookmark was false.
2. Saving it returned a selected bookmark.
3. A full page reload still showed the selected bookmark.
4. A separate Saved-tab read included that same item.
5. Removing the bookmark returned it to false.
6. A second full reload retained false.
7. A new Saved-tab read excluded the item and retained the three previously
   saved items.
8. A final reload again showed the original unsaved state.

The test restored the bookmark value. The ordinary server-side update changes
recent ordering; its timestamp was not rewritten. No document wording, account
entitlement or authentication metadata was changed. No records were created or
deleted. Account identity, document identifiers, wording and credentials are
intentionally omitted from this committed report.

This proves bookmark persistence for one real account on the deployed revision.
It does not prove that the newer library fixes are deployed, nor does it claim
cross-user RLS isolation, document-edit persistence or export acceptance.

## Live desktop performance samples

Three full authenticated reloads were measured in the user's existing Chrome
profile with its ordinary cache/network and installed extensions. Native
Navigation/Paint Timing and buffered PerformanceObserver entries were read via
the browser's supported developer connection. Observers were disconnected after
each read. No persistent page instrumentation or browser setting was changed.

| Metric | Sample 1 | Sample 2 | Sample 3 | Median |
| --- | ---: | ---: | ---: | ---: |
| Request-to-first-byte | 753 ms | 722 ms | 411 ms | 722 ms |
| First contentful paint | 1,156 ms | 892 ms | 532 ms | 892 ms |
| Largest contentful paint | 1,640 ms | 1,800 ms | 964 ms | 1,640 ms |
| Last observed outcome read completed after navigation | 2,188 ms | 2,432 ms | 1,527 ms | 2,188 ms |
| Layout shift | 0.163 | 0.163 | 0.163 | 0.163 |
| Total observed long-task duration | 383 ms | 797 ms | 383 ms | 383 ms |

All three samples rendered ten library cards. The final sample's layout-shift
buffer contained a single non-input shift at 1,544 ms with value
0.16271278449144996, so the result is not an inflated sum across separate
layout-shift session windows.

Loading was responsive in these samples, but visual stability needs improvement:
the measured LCP values were below the 2.5-second good threshold, while layout
shift exceeded the good threshold of 0.1. This is a repeated diagnostic finding,
not proof of its exact component or extension cause. See Google's
[LCP guidance](https://web.dev/articles/lcp) and
[CLS guidance](https://web.dev/articles/cls).

These three desktop samples are not a population-level Core Web Vitals pass.
They do not measure mobile throttling, cold-cache behaviour, INP, server load
capacity, other product routes or a new deployment. Long-task duration is not
reported as INP or Total Blocking Time. The exact layout-shift cause remains to
be isolated before claiming a production-performance fix.
