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
        <h1 id="title">Loading reference…</h1>
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
button, select {
  border: 1px solid var(--border-color-default, #d0d7de);
  border-radius: 6px;
  padding: 7px 10px;
  background: var(--background-color-default, #fff);
  color: inherit;
  font: inherit;
}
button { cursor: pointer; font-weight: var(--font-weight-semibold, 600); }
a { color: var(--true-color-blue, #0969da); overflow-wrap: anywhere; }
code { font-family: var(--font-mono, monospace); font-size: var(--text-code-inline, 12px); overflow-wrap: anywhere; }
.eyebrow { margin-bottom: 4px; color: var(--text-color-muted, #656d76); font-weight: var(--font-weight-semibold, 600); text-transform: uppercase; letter-spacing: .04em; }
.muted { color: var(--text-color-muted, #656d76); }
.panel { border: 1px solid var(--border-color-default, #d0d7de); border-radius: 8px; padding: 16px; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }
.meta { margin: 0; }
.meta dt { color: var(--text-color-muted, #656d76); font-size: 12px; }
.meta dd { margin: 0 0 8px; overflow-wrap: anywhere; }
.claim, .source { border-top: 1px solid var(--border-color-default, #d0d7de); padding-top: 12px; margin-top: 12px; }
.claim:first-child, .source:first-child { border-top: 0; padding-top: 0; margin-top: 0; }
.pill { display: inline-block; border: 1px solid var(--border-color-default, #d0d7de); border-radius: 999px; padding: 1px 7px; margin-right: 6px; font-size: 12px; }
.excerpt { border-left: 3px solid var(--border-color-default, #d0d7de); padding-left: 12px; white-space: pre-wrap; overflow-wrap: anywhere; }
.toolbar { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
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

function addMeta(parent, entries) {
  const list = node("dl", undefined, "meta");
  for (const [label, value] of entries) {
    list.append(node("dt", label), node("dd", value ?? "Not recorded"));
  }
  parent.append(list);
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
  title.textContent = data.question.original;
  subtitle.textContent = data.view + " · version " + data.version + " · " + data.status;

  const summary = panel("Research summary");
  summary.append(node("p", data.summary || "No claims are recorded for this evidence version."));
  content.append(summary);

  const provenance = panel("Scope and provenance");
  const provenanceGrid = node("div", undefined, "grid");
  addMeta(provenanceGrid, [
    ["Product", data.scope.product],
    ["Product version", data.scope.version],
    ["Platform", data.scope.platform],
    ["Task intent", data.scope.taskIntent],
  ]);
  addMeta(provenanceGrid, [
    ["Official skill", data.officialSkill.skillName],
    ["Plugin", data.officialSkill.pluginName + " " + data.officialSkill.pluginVersion],
    ["Skill generated", data.officialSkill.generatedAt],
    ["Researcher", data.researcherAgent],
  ]);
  provenance.append(provenanceGrid);
  content.append(provenance);

  const claims = panel("Claim support");
  const toolbar = node("div", undefined, "toolbar");
  toolbar.append(node("label", "Support state", "muted"));
  const select = node("select");
  for (const value of ["all", "supported", "partially-supported", "unsupported", "conflicting"]) {
    const option = node("option", value.replace("-", " "));
    option.value = value;
    option.selected = data.supportFilter === value;
    select.append(option);
  }
  select.addEventListener("change", async () => {
    await fetch("/filter", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ support: select.value }),
    });
  });
  toolbar.append(select);
  claims.append(toolbar);
  for (const claim of data.claims) {
    if (data.supportFilter !== "all" && claim.support !== data.supportFilter) continue;
    const article = node("article", undefined, "claim");
    const heading = node("h3", claim.text);
    heading.tabIndex = 0;
    article.append(heading, node("span", claim.support, "pill"));
    article.append(node("span", claim.id, "muted"));
    if (claim.sourceIds.length) article.append(node("p", "Sources: " + claim.sourceIds.join(", "), "muted"));
    heading.addEventListener("click", () => {
      const source = document.getElementById("source-" + claim.sourceIds[0]);
      if (source) source.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    claims.append(article);
  }
  content.append(claims);

  const sources = panel("Sources");
  for (const source of data.sources) {
    const article = node("article", undefined, "source");
    article.id = "source-" + source.id;
    article.append(node("h3", source.title));
    article.append(node("p", source.sectionHeading, "muted"));
    article.append(node("p", source.exactExcerpt, "excerpt"));
    article.append(node("p", source.whyItMatters));
    addMeta(article, [
      ["Verification", source.verificationState],
      ["Retrieved", source.retrievedAt],
      ["Method", source.retrievalMethod],
      ["Content hash", source.contentHash],
    ]);
    const canonical = safeLearnLink(source.canonicalUrl, "Open canonical Microsoft Learn page");
    const retrieval = safeLearnLink(source.retrievalUrl, "Open exact retrieval URL");
    if (canonical) article.append(canonical);
    if (retrieval && source.retrievalUrl !== source.canonicalUrl) {
      article.append(document.createTextNode(" · "), retrieval);
    }
    sources.append(article);
  }
  content.append(sources);

  const unresolved = panel("Unresolved items and conflicts");
  const conflicts = data.claims.filter((claim) => claim.support === "conflicting");
  if (!data.unresolvedItems.length && !conflicts.length) {
    unresolved.append(node("p", "No unresolved items or conflicting claims are recorded."));
  }
  for (const item of data.unresolvedItems) unresolved.append(node("p", item.text));
  for (const claim of conflicts) unresolved.append(node("p", "Conflicting claim: " + claim.text));
  content.append(unresolved);

  const lifecycle = panel("Lifecycle and integrity");
  const lifecycleGrid = node("div", undefined, "grid");
  addMeta(lifecycleGrid, Object.entries(data.lifecycle));
  addMeta(lifecycleGrid, [
    ["Research ID", data.researchId],
    ["Version", data.version],
    ["Status", data.status],
    ["Content hash", data.contentHash],
  ]);
  lifecycle.append(lifecycleGrid);
  content.append(lifecycle);
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
