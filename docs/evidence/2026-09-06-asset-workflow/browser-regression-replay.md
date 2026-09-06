# Browser regression evidence replay

This dated test harness is evidence, not an engine API or current product contract.
`browser-regression-harness.js` is the exact main-agent fixture executed against
the immutable package at `C:/Temp/unone-asset-gate-20260906/engine`.

Original test page: `C:/Temp/unone-asset-gate-20260906/web-regression.html`.
Original project fixture: sibling `browser-probe`, with published content bundle,
`asset://web/probe` declared as texture2d at `assets/probe.svg`.
Serve that parent at loopback only, port8120; page loads
`/engine/web/runtime/unone_web_live_smoke.js` with `Module.noInitialRun=true`,
then the harness as a module. DOM requirements: button#run, #status, pre#result,
img#asset; enable the button only in Module.onRuntimeInitialized.

Click Run once, preserve the first result. Each execution creates only new
UUID-named test databases, never deletes or modifies an existing game database.
The two corrupt-pointer cases intentionally modify only databases they just
created. Persistence comparisons cover meta and generation records; partial
verified cache writes are not represented as generation changes.

2026-09-06 observed result: all5 cases passed (see platform-and-browser.json and
web-regressions-resumed.png). This is integration coverage, not a blind user test
or cross-platform rendering approval. The separate runner screenshot retains
the known center-offset issue rather than hiding it.
