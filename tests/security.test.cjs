const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");
const { Tracker, parse, resources, resourceName } = require("../extension/tracker.js");

function browser(html = "") {
  const dom = new JSDOM(html, { url: "https://colonist.io/?private=test-only#room", runScripts: "outside-only" });
  for (const file of ["tracker.js", "log-reader.js", "content.js"]) {
    dom.window.eval(fs.readFileSync(path.join(__dirname, "../extension", file), "utf8"));
  }
  return dom;
}

test("resource icons accept only known CDN asset paths without credentials or tracking parameters", () => {
  const dom = browser();
  try {
    const safe = dom.window.CatanTrackLog.resourceImageUrl;
    const allowed = "https://cdn.colonist.io/dist/assets/card_lumber.fixture.svg";
    assert.equal(safe(allowed), allowed);
    for (const url of [
      "javascript:alert(1)", "data:image/svg+xml,test", "http://cdn.colonist.io/dist/assets/card_wood.svg",
      "https://cdn.colonist.io.attacker.invalid/dist/assets/card_wood.svg",
      "https://evil.colonist.io/dist/assets/card_wood.svg",
      "https://colonist.io/account/card_wood.svg",
      "https://cdn.colonist.io/account/card_wood.svg",
      "https://user:pass@cdn.colonist.io/dist/assets/card_wood.svg",
      "https://cdn.colonist.io:8443/dist/assets/card_wood.svg",
      allowed + "?token=test-only", allowed + "#tracking",
      "https://cdn.colonist.io/dist/assets/card_devcardback.fixture.svg"
    ]) assert.equal(safe(url), null, url);
  } finally { dom.window.close(); }
});

test("debug markup removes executable elements, form values, and arbitrary URL/attribute data", () => {
  const dom = browser('<div id="row"><span class="messagePart-fixture" data-secret="test-only" onclick="alert(1)"><span>Alice</span> got <img alt="Lumber" src="https://cdn.colonist.io/dist/assets/card_lumber.fixture.svg" onerror="alert(1)"><img alt="Ore" src="https://cdn.colonist.io/dist/assets/card_ore.fixture.svg?token=test-only"><input value="test-private-value"><script>test-private-script</script><a href="https://example.invalid/?token=test-only">details</a></span></div>');
  try {
    const html = dom.window.CatanTrackLog.diagnosticHtml(dom.window.document.querySelector("#row"));
    assert.match(html, /Alice/);
    assert.match(html, /alt="Lumber"/);
    assert.match(html, /card_lumber.fixture.svg/);
    assert.doesNotMatch(html, /onclick|onerror|data-secret|token=|test-private|<input|<script|href=/);
    assert.equal(dom.window.CatanTrackLog.diagnosticHtml(dom.window.document.createElement("script")), "");
  } finally { dom.window.close(); }
});

test("HTML-like usernames stay text and cannot create UI elements or handlers", () => {
  const dom = browser('<div id="game-log-text"><div data-index="0">You got wood</div></div>');
  try {
    const shadow = dom.window.document.querySelector("#catantrack-extension").shadowRoot;
    const name = '<img src=x onerror="alert(1)">';
    shadow.querySelector("#colonist-username").value = name;
    shadow.querySelector("form").dispatchEvent(new dom.window.Event("submit", { cancelable: true }));
    assert.equal(shadow.querySelector("tbody td").textContent, name);
    assert.equal(shadow.querySelectorAll("img").length, 5);
    assert.equal(shadow.querySelector("[onerror]"), null);
    assert.equal(shadow.querySelector('img[src="x"]'), null);
  } finally { dom.window.close(); }
});

test("malformed resource quantities cannot inject Infinity, NaN, or inherited object properties", () => {
  assert.equal(resourceName("constructor"), null);
  assert.equal(resourceName("__proto__"), null);
  assert.deepEqual(resources("0 wood"), {});
  assert.deepEqual(resources("999 wood wood"), {});
  const tracker = new Tracker();
  tracker.apply(parse("Alice got " + "9".repeat(400) + " wood"));
  tracker.apply(parse("x".repeat(8200) + " got wood"));
  assert.equal(tracker.players.size, 0);
  tracker.apply(parse("__proto__ got wood"));
  assert.equal(tracker.player("__proto__").resources.wood, 1);
  assert.equal({}.wood, undefined);
});

test("manifest limits injection to Colonist hosts and keeps packaged scripts isolated", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "../extension/manifest.json"), "utf8"));
  assert.deepEqual(manifest.content_scripts[0].matches, ["https://colonist.io/*", "https://www.colonist.io/*"]);
  assert.notEqual(manifest.content_scripts[0].world, "MAIN");
  assert.equal(manifest.permissions, undefined);
  assert.equal(manifest.externally_connectable, undefined);
  assert.equal(manifest.web_accessible_resources, undefined);
  assert.doesNotMatch(manifest.content_security_policy.extension_pages, /unsafe-eval|unsafe-inline|https?:/);
  for (const script of manifest.content_scripts[0].js) assert.ok(fs.existsSync(path.join(__dirname, "../extension", script)));
});

test("debug download remains user-triggered and omits page query parameters", () => {
  const dom = browser('<div id="game-log-text"><div data-index="0">Alice got wood</div></div>');
  try {
    let blobParts;
    dom.window.Blob = class { constructor(parts) { blobParts = parts; } };
    dom.window.URL.createObjectURL = () => "blob:test";
    dom.window.URL.revokeObjectURL = () => {};
    dom.window.HTMLAnchorElement.prototype.click = () => {};
    assert.equal(blobParts, undefined);
    const shadow = dom.window.document.querySelector("#catantrack-extension").shadowRoot;
    [...shadow.querySelectorAll("button")].find(b => b.textContent === "Export debug report").click();
    assert.equal(JSON.parse(blobParts[0]).room, "/#room");
    assert.doesNotMatch(blobParts[0], /private=test-only/);
  } finally { dom.window.close(); }
});
