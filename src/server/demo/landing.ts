const escape = (text: string) => text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

// What the browser tab and link previews (WhatsApp, LinkedIn, Slack, ...) show for the demo.
const PAGE_TITLE = 'InterlinkERP Planning: Live demo';
const PAGE_DESCRIPTION = 'Live demo of a workforce scheduling app: drag-and-drop shift board, Auto Plan, open shifts and shift switches, and utilisation reports.';

export interface LandingOptions {
  publicUrl: string;
  error: string | null;
  credit: { name: string; url: string | null } | null;
}

/** The demo's front door, matching the HR Recruitment demo's. Self-contained, so it needs no client code. */
export function demoLandingPage({ publicUrl, error, credit }: LandingOptions): string {
  const previewUrl = escape(`${publicUrl}/`);
  const previewImage = escape(`${publicUrl}/og-image.png`);
  const errorHtml = error === null ? '' : `<p class="error" role="alert">${escape(error)}</p>`;
  const who = credit && (credit.url ? `<a href="${escape(credit.url)}" rel="noopener">${escape(credit.name)}</a>` : escape(credit.name));
  const creditHtml = who ? `<p class="credit">Built by ${who}</p>` : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${PAGE_TITLE}</title>
  <meta name="description" content="${PAGE_DESCRIPTION}" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="InterlinkERP" />
  <meta property="og:url" content="${previewUrl}" />
  <meta property="og:title" content="${PAGE_TITLE}" />
  <meta property="og:description" content="${PAGE_DESCRIPTION}" />
  <meta property="og:image" content="${previewImage}" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta name="twitter:card" content="summary_large_image" />
  <link rel="icon" href="/favicon.ico" sizes="48x48" />
  <link rel="icon" type="image/svg+xml" href="/icon.svg" />
  <link rel="apple-touch-icon" href="/apple-icon.png" />
  <link rel="preload" href="/fonts/inter-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin />
  <style>
    @font-face { font-family: Inter; font-style: normal; font-weight: 100 900; font-display: swap; src: url(/fonts/inter-latin-wght-normal.woff2) format("woff2"); }
    :root { --bg: #f2f4f7; --card: #ffffff; --text: #00003f; --muted: #5f6b78; --border: #d6dbe1; --accent: #00005f; --accent-text: #ffffff; --chip: #e8ebef; --error: #b42318; }
    @media (prefers-color-scheme: dark) {
      :root { --bg: #16191d; --card: #22272e; --text: #e6e9ed; --muted: #a3acb6; --border: #3a424c; --accent: #e6e9ed; --accent-text: #16191d; --chip: #2d333b; --error: #f97066; }
    }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 16px; background: var(--bg); color: var(--text); font-family: Inter, system-ui, sans-serif; }
    main { width: 100%; max-width: 560px; background: var(--card); border: 1px solid var(--border); border-radius: 16px; padding: 32px; }
    img { display: block; height: 44px; width: auto; max-width: 100%; margin-bottom: 24px; }
    .tag { display: inline-block; font-size: 0.75rem; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; padding: 3px 10px; border-radius: 999px; background: var(--chip); color: var(--muted); margin-bottom: 12px; }
    h1 { font-size: 1.5rem; line-height: 1.25; margin: 0 0 10px; }
    h2 { font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); margin: 24px 0 8px; }
    p, li { color: var(--muted); font-size: 0.95rem; line-height: 1.55; }
    p { margin: 0; }
    ul { margin: 0; padding-left: 20px; }
    li { margin: 4px 0; }
    li strong { color: var(--text); font-weight: 600; }
    .stack { display: flex; flex-wrap: wrap; gap: 6px; }
    .stack span { font-size: 0.8rem; padding: 4px 10px; border-radius: 6px; background: var(--chip); color: var(--text); }
    .note { margin-top: 24px; font-size: 0.85rem; }
    button { width: 100%; margin-top: 20px; padding: 12px; font: inherit; font-weight: 600; color: var(--accent-text); background: var(--accent); border: 0; border-radius: 8px; cursor: pointer; }
    button:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
    .error { color: var(--error); margin-top: 12px; }
    .credit { margin-top: 16px; text-align: center; font-size: 0.85rem; }
    .credit a { color: var(--text); }
    @media (max-width: 480px) { main { padding: 24px 20px; } h1 { font-size: 1.3rem; } }
  </style>
</head>
<body>
  <main>
    <picture>
      <source srcset="/brand/interlinkerp-logo-dark.svg" media="(prefers-color-scheme: dark)" />
      <img src="/brand/interlinkerp-logo-light.svg" alt="InterlinkERP" />
    </picture>
    <span class="tag">Live demo</span>
    <h1>Services Planning &amp; Shift Scheduling</h1>
    <p>The planning module of the InterlinkERP suite: managers build and publish the Services team's schedule, and employees see their shifts, pick up open ones and swap the ones they can't work.</p>

    <h2>Things to try</h2>
    <ul>
      <li><strong>Move and resize shifts</strong> on the schedule board by dragging them. Clashes with leave or other shifts are flagged as you go.</li>
      <li><strong>Run Auto Plan</strong> to fill the week's open shifts, then publish the result.</li>
      <li><strong>Open My Planning</strong> to claim an open shift, take over a colleague's, or ask for cover on your own.</li>
      <li><strong>Check Reports</strong> for planned hours, utilisation and open shifts, and download them as CSV.</li>
    </ul>

    <h2>Built with</h2>
    <div class="stack"><span>Next.js 16</span><span>React 19</span><span>TypeScript</span><span>PostgreSQL</span><span>Drizzle ORM</span><span>Vercel</span></div>

    <p class="note">Every visitor shares the same sample data, so you may see other people's changes. Nothing is emailed. Restore the original data any time with <em>Reset demo data</em> in the profile menu.</p>

    <form method="post">
      <input type="hidden" name="demo_action" value="sign_in" />
      ${errorHtml}
      <button type="submit">Explore the demo</button>
    </form>
    ${creditHtml}
  </main>
</body>
</html>`;
}
