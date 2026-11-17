/** The stylesheet inlined in the mobile report (lib/mobileReport.ts). The file must work offline, so
 *  no web font and no external asset: the system font stack, the app's light palette (zinc greys,
 *  green/red amounts, violet savings) and drawn chevrons. Text colours keep WCAG AA on white. */
export const MOBILE_CSS = `
:root{color-scheme:light;--ink:#18181b;--text:#3f3f46;--muted:#71717a;--line:#e4e4e7;--soft:#f4f4f5;--good:#15803d;--bad:#b91c1c;--save:#6d28d9;--warn:#b45309;--accent:#0f766e}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:#fff;color:var(--text);font:1rem/1.5 system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",sans-serif;font-variant-numeric:tabular-nums}
::selection{background:#ccfbf1}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
main{max-width:34rem;margin:0 auto;padding:1.25rem max(1rem,env(safe-area-inset-right)) 3rem max(1rem,env(safe-area-inset-left))}
h1,h2,h3,p,ul,dl,dd{margin:0}
h1,h2,h3{color:var(--ink);text-wrap:balance}
h1{font-size:1.0625rem;font-weight:600}
h2{font-size:1.25rem;font-weight:650;line-height:1.25}
h3{font-size:1.0625rem;font-weight:600;margin:2rem 0 .5rem}
.muted{color:var(--muted)}
.small{font-size:.875rem}
.good{color:var(--good)}.bad{color:var(--bad)}.save{color:var(--save)}.warn{color:var(--warn)}
.top{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:.5rem 1rem;padding-bottom:.75rem;border-bottom:1px solid var(--line)}
.picker{display:none;margin-top:.75rem}
.js .picker{display:block}
.picker select{width:100%;min-height:2.75rem;padding:0 .75rem;font:inherit;color:var(--ink);background:#fff;border:1px solid #a1a1aa;border-radius:.5rem}
.index{margin-top:.75rem;display:flex;flex-wrap:wrap;gap:.25rem 1rem;padding:0;list-style:none}
.index a{display:inline-block;padding:.5rem 0;color:var(--accent)}
.js .index{display:none}
article{padding-top:1.5rem}
.tag{font-size:.875rem;font-weight:400;color:var(--warn)}
.verdict{margin-top:.75rem;font-size:2rem;font-weight:700;line-height:1.1;letter-spacing:-.01em;text-wrap:balance}
.avg{margin-top:.25rem}
.story{margin-top:.75rem;font-size:1.0625rem;line-height:1.55;max-width:34rem}
.eq{margin-top:1.5rem;border-top:1px solid var(--line)}
.eq .row{display:grid;grid-template-columns:1fr auto;gap:0 1rem;align-items:baseline;padding:.625rem 0;border-bottom:1px solid var(--line)}
.eq dt{color:var(--text)}
.eq .op{display:inline-block;width:1.25rem;color:var(--muted)}
.eq dd{text-align:right;font-weight:600;color:var(--ink)}
.eq .sub{grid-column:1/-1;font-size:.875rem;font-weight:400;color:var(--muted);padding-left:1.25rem}
.eq .total dt,.eq .total dd{font-weight:700;color:var(--ink)}
.note{margin-top:.75rem;font-size:.875rem;color:var(--muted)}
.alert{margin-top:.75rem;font-size:.9375rem;color:var(--warn)}
.cat{border-bottom:1px solid var(--line)}
.cat>.line{padding:.625rem 0 .625rem 1.375rem}
.line{display:grid;grid-template-columns:1fr auto;gap:.25rem 1rem;align-items:baseline}
.line .amt{font-weight:600;color:var(--ink);text-align:right}
.line .bar{grid-column:1/-1}
.bar{display:block;height:.5rem;border-radius:.25rem;background:var(--soft);overflow:hidden}
.bar>i{display:block;height:100%;border-radius:.25rem;background:#52525b}
.bar.income>i{background:var(--good)}
.bar.ok>i{background:#16a34a}.bar.near>i{background:#f59e0b}.bar.over>i{background:#dc2626}
.line .amt.muted{color:var(--muted);font-weight:400}
.avgmonth{margin-top:2.5rem;padding-top:1.5rem;border-top:1px solid var(--line)}
.n-good{font-weight:700;color:var(--good)}.n-bad{font-weight:700;color:var(--bad)}
.cat>.line.flat{padding-left:0}
.leaves{padding:0 0 .625rem 1.375rem;list-style:none}
.detail{display:block;font-size:.8125rem;color:var(--muted)}
.leaves li{display:flex;justify-content:space-between;gap:1rem;padding:.25rem 0;font-size:.9375rem}
.leaves .nm{color:var(--text)}
.leaves .amt{white-space:nowrap}
details>summary{cursor:pointer;list-style:none;min-height:2.75rem;display:flex;align-items:center}
details>summary::-webkit-details-marker{display:none}
details>summary::before{content:"";flex:none;width:.75rem;height:.75rem;margin-right:.625rem;background:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 10'><path d='M3 1l4 4-4 4' fill='none' stroke='%2371717a' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'/></svg>") no-repeat center/contain;transition:transform .15s ease-out}
details[open]>summary::before{transform:rotate(90deg)}
.cat>summary{align-items:flex-start;min-height:0;padding:.625rem 0}
.cat>summary .line{flex:1}
.cat>summary::before{margin-top:.4rem}
.more{border-top:1px solid var(--line);margin-top:1.5rem}
.more>summary{font-weight:600;color:var(--ink)}
.more[open]{padding-bottom:.5rem}
.chart{display:block;width:100%;height:auto;margin-top:.25rem}
.tree{margin-top:.5rem}
.trow{display:flex;justify-content:space-between;gap:1rem;padding:.25rem 0;border-bottom:1px solid var(--line);font-size:.9375rem}
.trow.strong{font-weight:600;color:var(--ink)}
.op{display:flex;justify-content:space-between;gap:1rem;padding:.125rem 0;font-size:.8125rem;color:var(--text)}
.op .d{color:var(--muted);margin-right:.5rem}
.op .acc{margin-left:.5rem;color:var(--muted)}
.op .amt{white-space:nowrap}
.help{margin-top:2.5rem;border-top:1px solid var(--line)}
.help ul{padding-left:1.25rem;display:grid;gap:.5rem}
.help p{margin-top:.5rem}
@media (prefers-reduced-motion:reduce){details>summary::before{transition:none}}
@media print{.js article[hidden]{display:block!important}.picker,.index{display:none!important}}
`;
