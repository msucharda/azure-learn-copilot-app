export const REFERENCE_CANVAS_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Microsoft Learn references</title>
    <link rel="stylesheet" href="/app.css">
    <script src="/app.js" defer></script>
  </head>
  <body>
    <header>
      <div>
        <p class="eyebrow">Microsoft Learn evidence</p>
        <h1 id="title">Microsoft Learn references</h1>
        <p id="subtitle" class="muted"></p>
      </div>
      <button id="refresh" type="button">Refresh</button>
    </header>
    <main id="content" aria-live="polite"></main>
    <div id="error" class="error" role="alert" hidden></div>
  </body>
</html>`;

export const REFERENCE_CANVAS_CSS = `
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body {
  margin: 0;
  padding: 24px;
  background: var(--background-color-default, #fff);
  color: var(--text-color-default, #1f2328);
  font: var(--text-body-medium, 14px)/var(--leading-body-medium, 20px) var(--font-sans, system-ui);
}
header { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; max-width: 1040px; margin: 0 auto 20px; }
main { max-width: 1040px; margin: 0 auto; display: grid; gap: 16px; }
h1, h2, h3, p { margin-top: 0; }
h1 { margin-bottom: 4px; font-size: var(--text-title-large, 26px); line-height: var(--leading-title-large, 32px); }
h2 { margin-bottom: 12px; font-size: var(--text-title-medium, 20px); }
h3 { margin-bottom: 6px; font-size: var(--text-title-small, 16px); }
button {
  border: 1px solid var(--border-color-default, #d0d7de);
  border-radius: 6px;
  padding: 7px 10px;
  background: var(--background-color-default, #fff);
  color: inherit;
  font: inherit;
}
button { cursor: pointer; font-weight: var(--font-weight-semibold, 600); }
a { color: var(--true-color-blue, #0969da); overflow-wrap: anywhere; }
.eyebrow { margin-bottom: 4px; color: var(--text-color-muted, #656d76); font-weight: var(--font-weight-semibold, 600); text-transform: uppercase; letter-spacing: .04em; }
.muted { color: var(--text-color-muted, #656d76); }
.panel { border: 1px solid var(--border-color-default, #d0d7de); border-radius: 8px; padding: 16px; }
.source { border-top: 1px solid var(--border-color-default, #d0d7de); padding-top: 12px; margin-top: 12px; }
.source:first-child { border-top: 0; padding-top: 0; margin-top: 0; }
.excerpt { border-left: 3px solid var(--border-color-default, #d0d7de); padding-left: 12px; white-space: pre-wrap; overflow-wrap: anywhere; }
.error { max-width: 1040px; margin: 20px auto; border: 1px solid var(--true-color-red, #cf222e); border-radius: 8px; padding: 16px; color: var(--true-color-red, #cf222e); white-space: pre-wrap; }
`;

export const REFERENCE_CANVAS_JS = `
const content = document.getElementById("content");
const errorBox = document.getElementById("error");
const title = document.getElementById("title");
const subtitle = document.getElementById("subtitle");
const refreshButton = document.getElementById("refresh");

function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = String(text);
  if (className) element.className = className;
  return element;
}

function safeLearnLink(value, label) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || parsed.hostname !== "learn.microsoft.com"
      || parsed.username || parsed.password || parsed.port) return null;
    const link = node("a", label);
    link.href = parsed.href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    return link;
  } catch {
    return null;
  }
}

function panel(heading) {
  const section = node("section", undefined, "panel");
  section.append(node("h2", heading));
  return section;
}

function render(data) {
  content.replaceChildren();
  errorBox.hidden = true;
  title.textContent = "Microsoft Learn references";
  const count = data.sources.length;
  subtitle.textContent = count + " source" + (count === 1 ? "" : "s")
    + " · " + data.view + " · version " + data.version;

  const sources = panel("Source excerpts");
  if (!count) sources.append(node("p", "No Microsoft Learn sources are recorded."));
  for (const source of data.sources) {
    const article = node("article", undefined, "source");
    article.append(node("h3", source.title));
    article.append(node("p", source.sectionHeading, "muted"));
    article.append(node("p", source.exactExcerpt, "excerpt"));
    const canonical = safeLearnLink(source.canonicalUrl, source.canonicalUrl);
    if (canonical) article.append(canonical);
    sources.append(article);
  }
  content.append(sources);
}

async function load() {
  const response = await fetch("/state", { cache: "no-store" });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error?.message || "The evidence record could not be loaded.");
  render(value);
}

function showError(error) {
  content.replaceChildren();
  title.textContent = "Reference unavailable";
  subtitle.textContent = "";
  errorBox.textContent = error instanceof Error ? error.message : String(error);
  errorBox.hidden = false;
}

refreshButton.addEventListener("click", async () => {
  try {
    const response = await fetch("/refresh", { method: "POST" });
    if (!response.ok) throw new Error("Refresh failed.");
  } catch (error) {
    showError(error);
  }
});

const events = new EventSource("/events");
events.addEventListener("refresh", () => load().catch(showError));
events.onerror = () => { subtitle.textContent = "Refresh connection interrupted"; };
load().catch(showError);
`;
