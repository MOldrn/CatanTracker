const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");
const { Tracker, DiceStats, parse, RESOURCES } = require("../extension/tracker.js");
function apply(tracker, ...lines) { for (const line of lines) tracker.apply(parse(line)); }
function amounts(tracker, name) { return RESOURCES.map(r => tracker.player(name).resources[r]); }

test("gains accumulate repeated icons, quantities, and Catan resource aliases", () => {
  const tracker = new Tracker();
  apply(tracker, "Alice received 2 wood, brick, 3 wool and 2 grain", "Alice got ore ore lumber");
  assert.deepEqual(amounts(tracker, "Alice"), [3, 1, 3, 2, 2]);
});

test("all standard purchases subtract the right cost", () => {
  for (const [item, expected] of [
    ["road", [9, 9, 10, 10, 10]], ["settlement", [9, 9, 9, 9, 10]],
    ["city", [10, 10, 10, 8, 7]], ["development card", [10, 10, 9, 9, 9]]
  ]) {
    const tracker = new Tracker();
    apply(tracker, "Alice rolled 8", "Alice got 10 wood 10 brick 10 sheep 10 wheat 10 ore", `Alice bought a ${item}`);
    assert.deepEqual(amounts(tracker, "Alice"), expected, item);
  }
});

test("opening placements do not consume resources; paid builds after a roll do", () => {
  const tracker = new Tracker();
  apply(tracker, "Alice built a settlement", "Alice built a road", "Alice built a settlement", "Alice got wood brick sheep wheat", "Alice built a road");
  assert.deepEqual(amounts(tracker, "Alice"), [1, 1, 1, 1, 0]);
  assert.equal(tracker.player("Alice").uncertain, false);
  apply(tracker, "Alice rolled 5", "Alice built a road");
  assert.deepEqual(amounts(tracker, "Alice"), [0, 0, 1, 1, 0]);
});

test("Road Building grants two free roads and the third is paid", () => {
  const tracker = new Tracker();
  apply(tracker, "Alice rolled 8", "Alice got 3 wood 3 brick", "Alice played Road Building", "Alice built a road", "Alice built a road", "Alice built a road");
  assert.deepEqual(amounts(tracker, "Alice"), [2, 2, 0, 0, 0]);
});

test("unused free roads expire on the next roll", () => {
  const tracker = new Tracker();
  apply(tracker, "Alice rolled 8", "Alice got wood brick", "Alice played Road Building", "Bob rolled 6", "Alice built a road");
  assert.deepEqual(amounts(tracker, "Alice"), [0, 0, 0, 0, 0]);
});

test("bank trades, player trades, and discards update both sides", () => {
  const tracker = new Tracker();
  apply(tracker, "Alice got 6 wood", "Bob got 2 ore", "Alice traded 4 wood for wheat with the bank", "Alice traded 2 wood for 2 ore with Bob", "Alice discarded ore");
  assert.deepEqual(amounts(tracker, "Alice"), [0, 0, 0, 1, 1]);
  assert.deepEqual(amounts(tracker, "Bob"), [2, 0, 0, 0, 0]);
  assert.equal(tracker.players.has("the bank"), false);
});

test("visible steals move resources; a hidden steal from a single-type hand is deduced", () => {
  const tracker = new Tracker();
  apply(tracker, "Bob got ore wood", "Alice stole ore from Bob");
  assert.deepEqual(amounts(tracker, "Alice"), [0, 0, 0, 0, 1]);
  assert.deepEqual(amounts(tracker, "Bob"), [1, 0, 0, 0, 0]);
  apply(tracker, "Alice stole 1 card from Bob");
  assert.equal(tracker.player("Alice").uncertain, false);
  assert.equal(tracker.player("Bob").uncertain, false);
  assert.deepEqual(amounts(tracker, "Alice"), [1, 0, 0, 0, 1]);
  assert.equal(tracker.player("Bob").totalMax, 0);
});

test("missing cards clamp at zero and flag uncertainty", () => {
  const tracker = new Tracker();
  apply(tracker, "Alice rolled 4", "Alice built a city", "Bob discarded 3 cards");
  assert.deepEqual(amounts(tracker, "Alice"), [0, 0, 0, 0, 0]);
  assert.equal(tracker.player("Alice").uncertain, true);
  assert.equal(tracker.player("Bob").uncertain, true);
});

test("player names with spaces and HTML-like characters remain literal", () => {
  const tracker = new Tracker();
  apply(tracker, "<Alice & Bob> got 2 ore");
  assert.equal(tracker.player("<Alice & Bob>").resources.ore, 2);
  assert.equal(parse("Waiting for players"), null);
});

test("a Monopoly with no result or chosen type flags missing information when play continues", () => {
  const tracker = new Tracker();
  apply(tracker, "Alice got wood", "Bob got brick", "Alice played Monopoly");
  assert.ok([...tracker.players.values()].every(p => !p.incomplete));
  apply(tracker, "Bob rolled 6");
  assert.ok([...tracker.players.values()].every(p => p.uncertain));
  apply(tracker, "Game started");
  assert.equal(tracker.players.size, 0);
  assert.equal(tracker.started, false);
});

test("DOM parser reads image alt text and filenames", () => {
  const dom = new JSDOM('<div><span>Alice</span> received <img alt="wood"><img alt="wood"><img src="/assets/card_brick.svg"></div>');
  assert.deepEqual(parse(dom.window.document.querySelector("div")).resources, { wood: 2, brick: 1 });
  dom.window.close();
});

const delay = () => new Promise(resolve => setTimeout(resolve, 200));
function browser(html, username = "Alice") {
  const dom = new JSDOM(html, { url: "https://colonist.io/#room", runScripts: "outside-only", pretendToBeVisual: true });
  for (const file of ["tracker.js", "log-reader.js", "dice-chart.js", "content.js"]) dom.window.eval(fs.readFileSync(path.join(__dirname, "../extension", file), "utf8"));
  if (username !== null) {
    const shadow = dom.window.document.querySelector("#catantrack-extension").shadowRoot;
    shadow.querySelector("#colonist-username").value = username;
    shadow.querySelector("form").dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
  }
  return dom;
}

test("observer processes real DOM updates, ignores chat, and deduplicates recycled indexed rows", async () => {
  const dom = browser('<div id="chat"><div>Alice got 99 wood</div></div><div id="game-log-text"><div data-index="0"><div class="message_post">Alice received <img alt="wood"></div></div></div>');
  try {
    const doc = dom.window.document, log = doc.querySelector("#game-log-text");
    const shadow = doc.querySelector("#catantrack-extension").shadowRoot;
    const value = () => shadow.querySelector('input[aria-label="Alice wood"]').value;
    assert.equal(value(), "1");
    log.replaceChildren(log.firstElementChild.cloneNode(true));
    await delay(); assert.equal(value(), "1");
    const next = doc.createElement("div"); next.dataset.index = "1"; next.textContent = "Alice got wood";
    log.append(next); await delay(); assert.equal(value(), "2");
    next.dataset.index = "2"; await delay(); assert.equal(value(), "3");
    const count = shadow.querySelector('input[aria-label="Alice wood"]');
    count.value = "7"; count.dispatchEvent(new dom.window.Event("change"));
    assert.equal(value(), "7");
    const buttons = [...shadow.querySelectorAll("button")];
    buttons.find(b => b.textContent === "Re-read visible log").click();
    assert.equal(value(), "2");
    buttons.find(b => b.textContent === "Clear counts").click();
    assert.equal(shadow.querySelectorAll("tbody tr").length, 0);
    const future = doc.createElement("div"); future.dataset.index = "3"; future.textContent = "Alice got 2 wood";
    log.append(future); await delay(); assert.equal(value(), "2");
    const collapse = buttons[0]; collapse.click(); assert.equal(collapse.getAttribute("aria-expanded"), "false");
  } finally { dom.window.close(); }
});

test("repeated identical unindexed messages each count once across rerenders", async () => {
  const dom = browser('<div id="game-log-text"><div class="message_post">Alice got wood</div><div class="message_post">Alice got wood</div></div>');
  try {
    const log = dom.window.document.querySelector("#game-log-text");
    log.replaceChildren(...[...log.children].map(n => n.cloneNode(true)));
    await delay();
    assert.equal(dom.window.document.querySelector("#catantrack-extension").shadowRoot.querySelector('input[aria-label="Alice wood"]').value, "2");
  } finally { dom.window.close(); }
});

test("navigation clears the previous game's players", async () => {
  const dom = browser('<div id="game-log-text"><div data-index="0">Alice got wood</div></div>');
  try {
    dom.window.history.pushState({}, "", "/#new-room");
    dom.window.document.querySelector("#game-log-text").replaceChildren();
    await delay();
    assert.equal(dom.window.document.querySelector("#catantrack-extension").shadowRoot.querySelectorAll("tbody tr").length, 0);
  } finally { dom.window.close(); }
});

test("indexed log history is applied chronologically even in reverse DOM order", () => {
  const dom = browser('<div id="game-log-text"><div data-index="3">Alice built a road</div><div data-index="2">Alice got wood brick</div><div data-index="1">Alice rolled 5</div></div>');
  try {
    const shadow = dom.window.document.querySelector("#catantrack-extension").shadowRoot;
    assert.equal(shadow.querySelector('input[aria-label="Alice wood"]').value, "0");
    assert.equal(shadow.querySelector('input[aria-label="Alice brick"]').value, "0");
    assert.equal(shadow.querySelector("tbody td").textContent, "Alice");
  } finally { dom.window.close(); }
});

test("a settlement proves the mystery card was sheep and leaves only one wood", () => {
  const tracker = new Tracker();
  apply(tracker, "Alice rolled 6", "Alice got 2 wood brick wheat", "Bob got sheep ore", "Alice stole 1 card from Bob");
  assert.deepEqual(amounts(tracker, "Alice"), [2, 1, 0, 1, 0]);
  assert.equal(tracker.player("Alice").unknown, 1);
  assert.equal(tracker.player("Alice").totalMax, 5);
  assert.equal(tracker.player("Bob").unknown, 1);
  assert.equal(tracker.player("Bob").totalMax, 1);
  apply(tracker, "Alice built a settlement");
  assert.deepEqual(amounts(tracker, "Alice"), [1, 0, 0, 0, 0]);
  assert.equal(tracker.player("Alice").unknown, 0);
  assert.equal(tracker.player("Alice").uncertain, false);
  assert.equal(tracker.player("Alice").totalMax, 1);
  assert.deepEqual(amounts(tracker, "Bob"), [0, 0, 0, 0, 1]);
  assert.equal(tracker.player("Bob").uncertain, false);
});

test("a covered purchase leaves the mystery card unresolved", () => {
  const tracker = new Tracker();
  apply(tracker, "Alice rolled 6", "Alice got wood brick", "Bob got sheep ore", "Alice stole 1 card from Bob", "Alice built a road");
  assert.deepEqual(amounts(tracker, "Alice"), [0, 0, 0, 0, 0]);
  assert.equal(tracker.player("Alice").unknown, 1);
  assert.equal(tracker.player("Alice").totalMax, 1);
  assert.equal(tracker.player("Alice").maximum.sheep, 1);
  assert.equal(tracker.player("Alice").maximum.ore, 1);
  assert.equal(tracker.player("Alice").maximum.wood, 0);
});

test("a victim's purchase resolves the thief's mystery card", () => {
  const tracker = new Tracker();
  apply(tracker, "Bob rolled 6", "Bob got 2 wood brick", "Alice stole 1 card from Bob", "Bob built a road");
  assert.deepEqual(amounts(tracker, "Alice"), [1, 0, 0, 0, 0]);
  assert.equal(tracker.player("Alice").unknown, 0);
  assert.equal(tracker.player("Bob").totalMax, 0);
  assert.equal(tracker.player("Bob").incomplete, false);
});

test("a city can resolve two stolen cards at once", () => {
  const tracker = new Tracker();
  apply(tracker, "Alice rolled 6", "Alice got ore 2 wheat", "Bob got 3 ore 2 wood", "Alice stole 1 card from Bob", "Alice stole 1 card from Bob");
  assert.equal(tracker.player("Alice").unknown, 2);
  apply(tracker, "Alice built a city");
  assert.equal(tracker.player("Alice").totalMax, 0);
  assert.equal(tracker.player("Alice").unknown, 0);
  assert.deepEqual(amounts(tracker, "Bob"), [2, 0, 0, 0, 1]);
  assert.equal(tracker.player("Bob").unknown, 0);
});

test("inference propagates through chained steals", () => {
  const tracker = new Tracker();
  apply(tracker, "Alice rolled 6", "Cara got wood ore", "Bob got brick", "Alice got brick", "Bob stole 1 card from Cara", "Alice stole 1 card from Bob", "Alice built a road");
  assert.equal(tracker.player("Alice").totalMax, 0);
  assert.deepEqual(amounts(tracker, "Bob"), [0, 1, 0, 0, 0]);
  assert.deepEqual(amounts(tracker, "Cara"), [0, 0, 0, 0, 1]);
  assert.ok([...tracker.players.values()].every(p => !p.uncertain));
});

test("unknown source hand permits all stolen types without blocking the thief's inference", () => {
  const tracker = new Tracker();
  apply(tracker, "Alice rolled 6", "Alice got 2 wood brick wheat", "Alice stole 1 card from Bob");
  assert.equal(tracker.player("Alice").unknown, 1);
  assert.equal(tracker.player("Bob").incomplete, true);
  apply(tracker, "Alice built a settlement");
  assert.deepEqual(amounts(tracker, "Alice"), [1, 0, 0, 0, 0]);
  assert.equal(tracker.player("Alice").uncertain, false);
});

test("free roads do not consume mystery cards", () => {
  const tracker = new Tracker();
  apply(tracker, "Alice rolled 6", "Bob got wood ore", "Alice stole 1 card from Bob", "Alice played Road Building", "Alice built a road", "Alice built a road");
  assert.equal(tracker.player("Alice").unknown, 1);
  assert.equal(tracker.player("Alice").totalMax, 1);
});

test("explicit spending and trades constrain mysteries just like builds", () => {
  for (const line of ["Alice spent sheep", "Alice discarded sheep", "Alice traded sheep for ore with the bank"]) {
    const tracker = new Tracker();
    apply(tracker, "Bob got sheep wood", "Alice stole 1 card from Bob", line);
    assert.equal(tracker.player("Alice").unknown, 0);
    assert.equal(tracker.player("Alice").incomplete, false);
    assert.deepEqual(amounts(tracker, "Bob"), [1, 0, 0, 0, 0]);
  }
});

test("impossible spending flags missing information instead of inventing cards", () => {
  const tracker = new Tracker();
  apply(tracker, "Alice rolled 6", "Bob got wood brick", "Alice stole 1 card from Bob", "Alice built a settlement");
  assert.equal(tracker.player("Alice").incomplete, true);
  assert.equal(tracker.player("Bob").unknown, 1);
  assert.ok(RESOURCES.every(r => tracker.player("Alice").resources[r] >= 0));
});

test("a later visible gain does not retroactively identify an already-held mystery", () => {
  const tracker = new Tracker();
  apply(tracker, "Alice rolled 6", "Alice got wood brick wheat", "Bob got sheep ore", "Alice stole 1 card from Bob", "Alice got sheep", "Alice built a settlement");
  assert.equal(tracker.player("Alice").unknown, 1);
  assert.equal(tracker.player("Alice").maximum.sheep, 1);
  assert.equal(tracker.player("Alice").maximum.ore, 1);
  assert.equal(tracker.player("Bob").unknown, 1);
});

test("many possibilities fall back conservatively instead of sampling a false certainty", () => {
  const tracker = new Tracker({ maxWorlds: 1 });
  apply(tracker, "Alice rolled 6", "Alice got 2 wood brick wheat", "Bob got sheep ore", "Alice stole 1 card from Bob");
  assert.equal(tracker.inferenceLimited, true);
  assert.equal(tracker.worlds, null);
  assert.equal(tracker.player("Alice").unknown, 1);
  assert.equal(tracker.player("Bob").unknown, 1);
  apply(tracker, "Alice built a settlement");
  assert.deepEqual(amounts(tracker, "Alice"), [1, 0, 0, 0, 0]);
  assert.equal(tracker.player("Alice").unknown, 0);
  // The fallback deliberately loses cross-player correlations, keeping Bob unknown.
  assert.equal(tracker.player("Bob").unknown, 1);
  apply(tracker, "Game started");
  assert.equal(tracker.inferenceLimited, false);
  assert.deepEqual(tracker.worlds, [[]]);
});

test("manual corrections are retained when subsequent events update possible hands", () => {
  const tracker = new Tracker();
  apply(tracker, "Bob got sheep ore", "Alice stole 1 card from Bob");
  tracker.setCount("Alice", "wood", 7);
  apply(tracker, "Alice got brick");
  assert.equal(tracker.player("Alice").resources.wood, 7);
  assert.equal(tracker.player("Alice").resources.brick, 1);
  assert.equal(tracker.player("Alice").unknown, 1);
});

test("editing a possible stolen type preserves uncertainty and total card count", () => {
  const tracker = new Tracker();
  apply(tracker, "Bob got wood ore", "Alice stole 1 card from Bob");
  tracker.setCount("Alice", "wood", 3);
  assert.equal(tracker.player("Alice").resources.wood, 3);
  assert.equal(tracker.player("Alice").maximum.wood, 4);
  assert.equal(tracker.player("Alice").unknown, 1);
  assert.equal(tracker.player("Alice").totalMin, 4);
  assert.equal(tracker.player("Alice").totalMax, 4);
});

test("two steals from a mostly single-type hand can guarantee one card before spending", () => {
  const tracker = new Tracker();
  apply(tracker, "Bob got 3 ore wood", "Alice stole 1 card from Bob", "Alice stole 1 card from Bob");
  assert.equal(tracker.player("Alice").resources.ore, 1);
  assert.equal(tracker.player("Alice").unknown, 1);
  assert.equal(tracker.player("Alice").totalMax, 2);
});

test("overlay shows unknown cards and removes them once a purchase resolves them", async () => {
  const dom = browser('<div id="game-log-text"><div data-index="0">Alice rolled 6</div><div data-index="1">Alice got 2 wood brick wheat</div><div data-index="2">Bob got sheep ore</div><div data-index="3">Alice stole <img alt="card back"> from Bob</div></div>');
  try {
    const doc = dom.window.document, shadow = doc.querySelector("#catantrack-extension").shadowRoot;
    const unknown = () => shadow.querySelector('[aria-label="Alice unknown cards"]');
    assert.equal(unknown().textContent, "? × 1");
    assert.equal(unknown().nextElementSibling.textContent, "5");
    assert.match(unknown().querySelector("span").title, /sheep, ore/);
    const row = doc.createElement("div"); row.dataset.index = "4"; row.textContent = "Alice built a settlement";
    doc.querySelector("#game-log-text").append(row);
    await delay();
    assert.equal(unknown().textContent, "0");
    assert.equal(unknown().nextElementSibling.textContent, "1");
    assert.equal(shadow.querySelector('input[aria-label="Alice wood"]').value, "1");
    assert.equal(shadow.querySelector('input[aria-label="Alice sheep"]').value, "0");
    assert.equal(shadow.querySelectorAll(".mystery").length, 0);
  } finally { dom.window.close(); }
});

const feedFixture = fs.readFileSync(path.join(__dirname, "fixtures/colonist-feed.html"), "utf8");
test("Colonist feed markup from the screenshot is detected without legacy IDs", async () => {
  const dom = browser(feedFixture);
  try {
    const doc = dom.window.document, shadow = doc.querySelector("#catantrack-extension").shadowRoot;
    const read = dom.window.CatanTrackLog.read(doc);
    assert.equal(read.mode, "virtual game feed");
    assert.equal(read.entries.length, 4);
    assert.equal(shadow.querySelector("tbody td").textContent, "Keelby");
    assert.equal(shadow.querySelectorAll("tbody tr").length, 1);
    assert.equal(shadow.querySelector('input[aria-label="Keelby wood"]').value, "0");
    assert.equal(shadow.querySelector('input[aria-label="Keelby brick"]').value, "0");
    assert.match(shadow.querySelector(".status").textContent, /1 players · 4 events/);
    const row = doc.createElement("div"); row.dataset.index = "52"; row.className = "scrollItemContainer-newSuffix";
    row.innerHTML = '<div class="feedMessage-newSuffix"><div><img alt="Bot"></div><span class="messagePart-newSuffix"><span style="font-weight:600">Keelby</span> got <img alt="Lumber"></span></div>';
    doc.querySelector(".virtualScroller-fixture").append(row);
    await delay();
    assert.equal(shadow.querySelector('input[aria-label="Keelby wood"]').value, "1");
    row.replaceWith(row.cloneNode(true)); await delay();
    assert.equal(shadow.querySelector('input[aria-label="Keelby wood"]').value, "1");
  } finally { dom.window.close(); }
});

test("indexed game feed detection survives a renamed scroller wrapper", () => {
  const dom = browser(feedFixture.replaceAll("virtualScroller-fixture", "renamedWrapper-fixture"));
  try {
    const doc = dom.window.document;
    const read = dom.window.CatanTrackLog.read(doc);
    assert.equal(read.mode, "indexed game feed");
    assert.equal(read.entries.length, 4);
    assert.equal(doc.querySelector("#catantrack-extension").shadowRoot.querySelectorAll("tbody tr").length, 1);
  } finally { dom.window.close(); }
});

test("chat with game-like text is excluded even in an unnamed shared feed", () => {
  const dom = browser('<div class="virtualScroller-chatFixture"><div class="scrollItemContainer-fixture" data-index="0"><div class="feedMessage-fixture"><span class="messagePart-fixture"><span style="font-weight:600">Alice</span>: got <img alt="Lumber"></span></div></div></div>');
  try {
    assert.equal(dom.window.CatanTrackLog.read(dom.window.document).entries.length, 0);
    assert.equal(dom.window.document.querySelector("#catantrack-extension").shadowRoot.querySelectorAll("tbody tr").length, 0);
  } finally { dom.window.close(); }
});

test("an unrelated virtual scroller is not treated as a game log", () => {
  const dom = browser('<div class="virtualScroller-bank"><div data-index="0">19 wood</div></div>');
  try {
    const read = dom.window.CatanTrackLog.read(dom.window.document);
    assert.equal(read.entries.length, 0);
    assert.equal(read.virtualCandidates, 1);
    const shadow = dom.window.document.querySelector("#catantrack-extension").shadowRoot;
    assert.match(shadow.querySelector(".status").textContent, /Game log not found/);
    assert.match(shadow.querySelector("pre").textContent, /virtual scrollers: 1/);
  } finally { dom.window.close(); }
});

test("diagnostics distinguish unsupported rows from a missing game log", () => {
  const dom = browser('<div id="game-log-text"><div class="message_post">Unsupported action example</div></div>');
  try {
    const shadow = dom.window.document.querySelector("#catantrack-extension").shadowRoot;
    assert.match(shadow.querySelector(".status").textContent, /Game log found · 1 rows · no recognized events/);
    assert.match(shadow.querySelector("pre").textContent, /Unsupported action example/);
  } finally { dom.window.close(); }
});

test("You and you share one canonical hand even before the username is known", () => {
  const tracker = new Tracker();
  apply(tracker, "You got wood", "you got brick");
  assert.equal(tracker.players.size, 1);
  assert.deepEqual(amounts(tracker, "You"), [1, 1, 0, 0, 0]);
  assert.equal(tracker.player("you"), tracker.player("You"));
});

test("local username resolves aliases as thief, victim, and named actor", () => {
  const tracker = new Tracker({ localPlayer: "Dalila7782" });
  apply(tracker, "dalila7782 got wood", "Bob got ore", "You stole ore from Bob", "Mercy stole wood from you");
  assert.deepEqual(amounts(tracker, "Dalila7782"), [0, 0, 0, 0, 1]);
  assert.equal(tracker.players.size, 3);
  assert.equal(tracker.players.has("You"), false);
  assert.equal(tracker.players.has("you"), false);
  assert.equal(tracker.player("Dalila7782").incomplete, false);
  assert.deepEqual(amounts(tracker, "Mercy"), [1, 0, 0, 0, 0]);
});

test("a named player's purchase resolves their You alias's hidden steal", () => {
  const tracker = new Tracker({ localPlayer: "Dalila7782" });
  apply(tracker, "Dalila7782 rolled 6", "Dalila7782 got 2 wood brick wheat", "Bob got sheep ore", "You stole 1 card from Bob", "Dalila7782 built a settlement");
  assert.deepEqual(amounts(tracker, "Dalila7782"), [1, 0, 0, 0, 0]);
  assert.equal(tracker.player("Dalila7782").unknown, 0);
  assert.equal(tracker.player("Dalila7782").incomplete, false);
  assert.equal(tracker.players.size, 2);
});

test("trade partners also resolve you without changing other players' names", () => {
  const tracker = new Tracker({ localPlayer: "Dalila7782" });
  apply(tracker, "Dalila7782 got brick", "Mercy got wood", "Mercy traded wood for brick with you");
  assert.deepEqual(amounts(tracker, "Dalila7782"), [1, 0, 0, 0, 0]);
  assert.deepEqual(amounts(tracker, "Mercy"), [0, 1, 0, 0, 0]);
  assert.equal(tracker.players.size, 2);
  assert.equal(tracker.resolveName("Yumuk"), "Yumuk");
  apply(tracker, "Game started", "You got ore");
  assert.equal(tracker.player("Dalila7782").resources.ore, 1);
  assert.equal(tracker.players.size, 1);
});

test("startup requests a username and replays events received before it was entered", async () => {
  const dom = browser('<div id="game-log-text"><div data-index="0">Dalila7782 rolled 6</div><div data-index="1">Dalila7782 got 2 wood brick wheat</div><div data-index="2">Bob got sheep ore</div><div data-index="3">You stole 1 card from Bob</div></div>', null);
  try {
    const doc = dom.window.document, shadow = doc.querySelector("#catantrack-extension").shadowRoot;
    const form = shadow.querySelector("form"), input = shadow.querySelector("#colonist-username");
    assert.equal(form.hidden, false);
    assert.equal(input.required, true);
    assert.equal(shadow.querySelector("table").hidden, true);
    input.value = "   "; form.dispatchEvent(new dom.window.Event("submit", { cancelable: true }));
    assert.equal(form.hidden, false);
    assert.equal(input.validity.valid, false);
    const row = doc.createElement("div"); row.dataset.index = "4"; row.textContent = "Dalila7782 built a settlement";
    doc.querySelector("#game-log-text").append(row); await delay();
    input.value = " Dalila7782 "; input.dispatchEvent(new dom.window.Event("input"));
    form.dispatchEvent(new dom.window.Event("submit", { cancelable: true }));
    assert.equal(form.hidden, true);
    assert.equal(shadow.querySelector("table").hidden, false);
    assert.equal(shadow.querySelectorAll("tbody tr").length, 2);
    assert.equal(shadow.querySelector("tbody td").textContent, "Dalila7782");
    assert.equal(shadow.querySelector('input[aria-label="Dalila7782 wood"]').value, "1");
    assert.equal(shadow.querySelector('[aria-label="Dalila7782 unknown cards"]').textContent, "0");
    assert.equal(shadow.querySelector('input[aria-label="You wood"]'), null);
    const count = shadow.querySelector('input[aria-label="Dalila7782 wood"]'); count.value = "2";
    count.dispatchEvent(new dom.window.Event("change"));
    const replay = [...shadow.querySelectorAll("button")].find(button => button.textContent === "Re-read visible log");
    replay.click();
    assert.equal(shadow.querySelector('input[aria-label="Dalila7782 wood"]').value, "1");
    assert.equal(shadow.querySelectorAll("tbody tr").length, 2);
  } finally { dom.window.close(); }
});

test("changing a mistaken username replays original events and preserves manual adjustments", () => {
  const dom = browser('<div id="game-log-text"><div data-index="0">You got wood</div><div data-index="1">Alice got brick</div></div>', "Wrong name");
  try {
    const shadow = dom.window.document.querySelector("#catantrack-extension").shadowRoot;
    const count = shadow.querySelector('input[aria-label="Wrong name wood"]'); count.value = "2";
    count.dispatchEvent(new dom.window.Event("change"));
    [...shadow.querySelectorAll("button")].find(button => button.textContent === "Change username").click();
    shadow.querySelector("#colonist-username").value = "Alice";
    shadow.querySelector("form").dispatchEvent(new dom.window.Event("submit", { cancelable: true }));
    assert.equal(shadow.querySelectorAll("tbody tr").length, 1);
    assert.equal(shadow.querySelector('input[aria-label="Alice wood"]').value, "2");
    assert.equal(shadow.querySelector('input[aria-label="Alice brick"]').value, "1");
    assert.equal(shadow.querySelector('input[aria-label="Wrong name wood"]'), null);
    const clear = [...shadow.querySelectorAll("button")].find(button => button.textContent === "Clear counts"); clear.click();
    [...shadow.querySelectorAll("button")].find(button => button.textContent === "Change username").click();
    shadow.querySelector("#colonist-username").value = "Another name";
    shadow.querySelector("form").dispatchEvent(new dom.window.Event("submit", { cancelable: true }));
    assert.equal(shadow.querySelectorAll("tbody tr").length, 0);
  } finally { dom.window.close(); }
});

test("completed gave/and/took bank exchanges subtract only the offered side", () => {
  for (const line of [
    "Mercy gave bank 4 sheep and took wood",
    "Mercy gave 4 sheep to bank and got wood",
    "Mercy gave the bank 4 sheep and received wood",
    "Mercy gave 4 sheep and took wood from the bank"
  ]) {
    const tracker = new Tracker();
    apply(tracker, "Mercy got 4 sheep", line);
    assert.deepEqual(amounts(tracker, "Mercy"), [1, 0, 0, 0, 0], line);
    assert.equal(tracker.player("Mercy").incomplete, false, line);
    assert.equal(tracker.players.size, 1);
  }
});

test("completed gave/and/got player exchanges update both players and keep resource-like usernames intact", () => {
  const tracker = new Tracker();
  apply(tracker, "Mercy got wheat", "Wood Sheep got 2 ore", "Mercy gave wheat and got 2 ore from Wood Sheep");
  assert.deepEqual(amounts(tracker, "Mercy"), [0, 0, 0, 0, 2]);
  assert.deepEqual(amounts(tracker, "Wood Sheep"), [0, 0, 0, 1, 0]);
  assert.ok([...tracker.players.values()].every(p => !p.incomplete));
});

test("trade offers are ignored and unfinished exchanges remain eligible for hydration", () => {
  assert.equal(parse("Marva wants to give ore for wood"), null);
  assert.equal(parse("Mercy gave bank 4 sheep and took"), null);
  assert.equal(parse("Mercy gave bank and took wood"), null);
  assert.equal(parse("Mercy gave bank card back and took wood").type, "unknown");
});

const transactionFixture = fs.readFileSync(path.join(__dirname, "fixtures/colonist-transactions.html"), "utf8");
test("screenshot purchase and discard markup parses alongside completed trades", () => {
  const dom = browser(transactionFixture, "Dalila7782");
  try {
    const doc = dom.window.document, shadow = doc.querySelector("#catantrack-extension").shadowRoot;
    const rows = dom.window.CatanTrackLog.read(doc).entries;
    const event = index => dom.window.CatanTrack.parse(dom.window.CatanTrackLog.messageText(rows[index]));
    assert.equal(event(2).type, "build");
    assert.equal(event(2).item, "development card");
    assert.equal(JSON.stringify(event(4).resources), JSON.stringify({ wood: 3, sheep: 2 }));
    assert.equal(event(7).type, "trade"); assert.equal(event(8).partner, "Yumuk");
    const counts = name => [...shadow.querySelectorAll("tbody tr")].find(row => row.firstElementChild.textContent === name);
    assert.equal(counts("Marva").lastElementChild.textContent, "0");
    assert.equal(counts("Dalila7782").lastElementChild.textContent, "3");
    assert.equal(counts("Mercy").lastElementChild.textContent, "2");
    assert.equal(counts("Yumuk").lastElementChild.textContent, "1");
    assert.equal(shadow.querySelectorAll("tbody tr").length, 4);
  } finally { dom.window.close(); }
});

test("a partially rendered exchange is applied once after its received icon arrives", async () => {
  const dom = browser('<div id="game-log-text"><div data-index="0">Alice got 4 sheep</div><div data-index="1">Alice gave bank 4 sheep and took</div></div>');
  try {
    const doc = dom.window.document, shadow = doc.querySelector("#catantrack-extension").shadowRoot;
    assert.equal(shadow.querySelector('input[aria-label="Alice sheep"]').value, "4");
    doc.querySelector('[data-index="1"]').append(doc.createTextNode(" wood"));
    await delay();
    assert.equal(shadow.querySelector('input[aria-label="Alice sheep"]').value, "0");
    assert.equal(shadow.querySelector('input[aria-label="Alice wood"]').value, "1");
  } finally { dom.window.close(); }
});

test("debug export includes unrecognized rows, original markup, events, and counts", () => {
  const dom = browser(transactionFixture, "Dalila7782");
  try {
    let blobParts, downloadName;
    dom.window.Blob = class { constructor(parts) { blobParts = parts; } };
    dom.window.URL.createObjectURL = () => "blob:test-report";
    dom.window.URL.revokeObjectURL = () => {};
    dom.window.HTMLAnchorElement.prototype.click = function () { downloadName = this.download; };
    const shadow = dom.window.document.querySelector("#catantrack-extension").shadowRoot;
    [...shadow.querySelectorAll("button")].find(button => button.textContent === "Export debug report").click();
    const report = JSON.parse(blobParts[0]);
    assert.equal(downloadName, "catantrack-debug.json");
    assert.equal(report.localPlayer, "Dalila7782");
    assert.equal(report.coverage.firstObservedIndex, 0);
    assert.equal(report.rows.length, 10);
    assert.equal(report.rows[9].parsed, null);
    assert.match(report.rows[2].html, /Development Card/);
    assert.equal(report.rows[7].parsed.type, "trade");
    assert.equal(report.players.find(p => p.name === "Mercy").totalMax, 2);
    assert.equal(report.journal.length, 9);
  } finally { dom.window.close(); }
});

test("Monopoly clears the chosen resource from every opponent and conserves cards", () => {
  const tracker = new Tracker();
  apply(tracker, "Alice got wood ore", "Bob got 2 wood brick", "Cara got 3 wood wheat", "Dave got sheep");
  const total = () => [...tracker.players.values()].reduce((sum, p) => sum + p.totalMax, 0);
  const before = total();
  apply(tracker, "Alice played Monopoly");
  assert.equal(tracker.player("Alice").resources.wood, 1);
  apply(tracker, "Alice stole 5 wood");
  assert.deepEqual(amounts(tracker, "Alice"), [6, 0, 0, 0, 1]);
  assert.deepEqual(amounts(tracker, "Bob"), [0, 1, 0, 0, 0]);
  assert.deepEqual(amounts(tracker, "Cara"), [0, 0, 0, 1, 0]);
  assert.deepEqual(amounts(tracker, "Dave"), [0, 0, 1, 0, 0]);
  assert.equal(total(), before);
  assert.equal(tracker.pendingMonopoly, null);
  assert.ok([...tracker.players.values()].every(p => !p.incomplete));
});

test("a Monopoly result works even when its play line was not captured", () => {
  const tracker = new Tracker();
  apply(tracker, "Alice got wheat", "Bob got 2 ore brick", "Cara got ore", "Alice stole ore ore ore");
  assert.deepEqual(amounts(tracker, "Alice"), [0, 0, 0, 1, 3]);
  assert.deepEqual(amounts(tracker, "Bob"), [0, 1, 0, 0, 0]);
  assert.equal(tracker.player("Cara").totalMax, 0);
  assert.equal(tracker.players.size, 3);
});

test("a reported Monopoly total resolves an earlier hidden steal", () => {
  const tracker = new Tracker();
  apply(tracker, "Bob got wood ore", "Alice stole 1 card from Bob", "Alice played Monopoly", "Alice stole wood");
  // Bob must still have had the wood, so Alice's earlier mystery was ore.
  assert.deepEqual(amounts(tracker, "Alice"), [1, 0, 0, 0, 1]);
  assert.equal(tracker.player("Alice").unknown, 0);
  assert.equal(tracker.player("Bob").totalMax, 0);
  assert.ok([...tracker.players.values()].every(p => !p.incomplete));
});

test("a zero-card Monopoly with a selected type also constrains unknown hands", () => {
  const tracker = new Tracker();
  apply(tracker, "Bob got wood ore", "Alice stole 1 card from Bob", "Alice played Monopoly wood", "Alice stole 0");
  assert.deepEqual(amounts(tracker, "Alice"), [1, 0, 0, 0, 0]);
  assert.deepEqual(amounts(tracker, "Bob"), [0, 0, 0, 0, 1]);
  assert.equal(tracker.player("Alice").unknown, 0);
  assert.equal(tracker.player("Bob").incomplete, false);
});

test("an untyped zero-card result makes no transfers or invented uncertainty", () => {
  const tracker = new Tracker();
  apply(tracker, "Bob got wood", "Alice played Monopoly", "Alice stole nothing");
  assert.equal(tracker.player("Alice").totalMax, 0);
  assert.equal(tracker.player("Bob").resources.wood, 1);
  assert.ok([...tracker.players.values()].every(p => !p.incomplete));
});

test("Monopoly results received as a gain are not added twice", () => {
  const tracker = new Tracker();
  apply(tracker, "Alice got ore", "Bob got 2 wheat", "Alice used Monopoly wheat", "Alice received 2 wheat");
  assert.deepEqual(amounts(tracker, "Alice"), [0, 0, 0, 2, 1]);
  assert.equal(tracker.player("Bob").totalMax, 0);
  assert.equal(tracker.player("Alice").incomplete, false);
});

test("a named Monopoly selection can settle without a separate result line", () => {
  const tracker = new Tracker();
  apply(tracker, "Bob got 2 ore", "Alice played Monopoly ore", "Alice got wheat");
  assert.deepEqual(amounts(tracker, "Alice"), [0, 0, 0, 1, 2]);
  assert.equal(tracker.player("Bob").resources.ore, 0);
  assert.ok([...tracker.players.values()].every(p => !p.incomplete));
});

test("reported Monopoly totals remain authoritative if earlier opponent information was missing", () => {
  const tracker = new Tracker();
  apply(tracker, "Bob got wood", "Alice played Monopoly", "Alice stole 3 wood");
  assert.equal(tracker.player("Alice").resources.wood, 3);
  assert.equal(tracker.player("Bob").resources.wood, 0);
  assert.equal(tracker.player("Bob").incomplete, true);
});

test("Monopoly still moves known resources after the scenario budget is exceeded", () => {
  const tracker = new Tracker({ maxWorlds: 1 });
  apply(tracker, "Bob got wood ore 2 wheat", "Alice stole 1 card from Bob", "Alice played Monopoly", "Alice stole 2 wheat");
  assert.equal(tracker.inferenceLimited, true);
  assert.equal(tracker.player("Alice").resources.wheat, 2);
  assert.equal(tracker.player("Bob").resources.wheat, 0);
  assert.equal(tracker.player("Bob").incomplete, true);
});

test("Monopoly actor aliases share the named player's existing hand", () => {
  const tracker = new Tracker({ localPlayer: "Dalila7782" });
  apply(tracker, "Dalila7782 got wood", "Bob got ore", "You played Monopoly", "You stole ore from everyone");
  assert.deepEqual(amounts(tracker, "Dalila7782"), [1, 0, 0, 0, 1]);
  assert.equal(tracker.players.size, 2);
  assert.equal(tracker.player("Bob").totalMax, 0);
});

test("DOM Monopoly rows update all hands once and keep names in their game colors", async () => {
  const dom = browser('<div id="game-log-text"><div data-index="0"><span class="messagePart-fixture"><span style="font-weight:600;color:#CF4449">Alice</span> got <img alt="Lumber"></span></div><div data-index="1"><span class="messagePart-fixture"><span style="font-weight:600;color:#228103">Bob</span> got <img alt="Grain"><img alt="Grain"></span></div><div data-index="2"><span class="messagePart-fixture"><span style="font-weight:600;color:#CF4449">Alice</span> played <img alt="Monopoly"></span></div><div data-index="3"><span class="messagePart-fixture">You stole <img alt="Grain"><img alt="Grain"></span></div></div>');
  try {
    const doc = dom.window.document, shadow = doc.querySelector("#catantrack-extension").shadowRoot;
    const cells = () => [...shadow.querySelectorAll("tbody tr")].map(row => row.firstElementChild);
    assert.equal(cells()[0].style.color, "rgb(207, 68, 73)");
    assert.equal(cells()[1].style.color, "rgb(34, 129, 3)");
    assert.equal(shadow.querySelector('input[aria-label="Alice wheat"]').value, "2");
    assert.equal(shadow.querySelector('input[aria-label="Bob wheat"]').value, "0");
    const log = doc.querySelector("#game-log-text");
    const last = log.lastElementChild.cloneNode(true);
    log.replaceChildren(last); await delay();
    assert.equal(cells()[0].style.color, "rgb(207, 68, 73)");
    assert.equal(cells()[1].style.color, "rgb(34, 129, 3)");
    assert.equal(shadow.querySelector('input[aria-label="Alice wheat"]').value, "2");
    [...shadow.querySelectorAll("button")].find(b => b.textContent === "Change username").click();
    shadow.querySelector("#colonist-username").value = "ALICE";
    shadow.querySelector("form").dispatchEvent(new dom.window.Event("submit", { cancelable: true }));
    assert.equal(cells()[0].style.color, "rgb(207, 68, 73)");
    assert.equal(shadow.querySelector('input[aria-label="ALICE wheat"]').value, "2");
  } finally { dom.window.close(); }
});

test("resized panel dimensions survive collapse and reset without changing counts", () => {
  const dom = browser('<div id="game-log-text"><div>Alice got wood</div></div>');
  try {
    const host = dom.window.document.querySelector("#catantrack-extension"), shadow = host.shadowRoot;
    const panel = shadow.querySelector(".panel");
    panel.style.width = "500px"; panel.style.height = "350px";
    const collapse = shadow.querySelector("header button"); collapse.click();
    assert.ok(panel.classList.contains("collapsed"));
    collapse.click();
    assert.equal(panel.style.width, "500px"); assert.equal(panel.style.height, "350px");
    host.getBoundingClientRect = () => ({ left: 900, top: 700, width: 500, height: 350 });
    dom.window.dispatchEvent(new dom.window.Event("resize"));
    assert.equal(host.style.left, `${dom.window.innerWidth - 500}px`);
    assert.equal(host.style.top, `${dom.window.innerHeight - 350}px`);
    [...shadow.querySelectorAll("button")].find(b => b.textContent === "Reset panel size").click();
    assert.equal(panel.style.width, ""); assert.equal(panel.style.height, "");
    assert.equal(shadow.querySelector('input[aria-label="Alice wood"]').value, "1");
  } finally { dom.window.close(); }
});

test("roll parsing reads totals and pairs without guessing incomplete dice", () => {
  for (let sum = 2; sum <= 12; sum++) assert.equal(parse(`Alice rolled ${sum}`).sum, sum);
  assert.equal(parse("Alice rolled 3 + 4").sum, 7);
  assert.equal(parse("Alice rolled dice_3 dice_4").sum, 7);
  assert.equal(parse("Alice rolled dice_6").sum, null);
  assert.equal(parse("Alice rolled 13").sum, null);
  assert.equal(parse("Alice rolled").sum, null);
});

test("roll parsing reads both icon alt labels and dice asset filenames", () => {
  const dom = new JSDOM('<div id="a">Alice rolled <img alt="dice_6"><img alt="dice_6"></div><div id="b">Bob rolled <img src="https://cdn.colonist.io/dist/assets/dice_red_2.fixture.svg"><img alt="Dice 5"></div>');
  try {
    assert.equal(parse(dom.window.document.querySelector("#a")).sum, 12);
    assert.equal(parse(dom.window.document.querySelector("#b")).sum, 7);
  } finally { dom.window.close(); }
});

test("dice stats deduplicate IDs and upgrade unreadable rolls without inflating totals", () => {
  const stats = new DiceStats();
  stats.record("first", null); stats.record("second", 8);
  assert.equal(stats.unreadable, 1);
  stats.record("first", 7); stats.record("first", 7); stats.record("first", null);
  assert.equal(stats.total, 2); assert.equal(stats.unreadable, 0);
  assert.equal(stats.counts[7], 1); assert.equal(stats.counts[8], 1);
  assert.equal(stats.last, 8);
  stats.record("second", 9);
  assert.equal(stats.total, 2); assert.equal(stats.counts[8], 0); assert.equal(stats.counts[9], 1);
  assert.deepEqual(JSON.parse(JSON.stringify(stats)).recent, [7, 9]);
});

test("resource events do not change dice counts and a new game resets them", () => {
  const tracker = new Tracker();
  apply(tracker, "Alice rolled 7", "Alice got wood", "Alice rolled 7", "Bob rolled 12");
  assert.equal(tracker.dice.total, 3); assert.equal(tracker.dice.counts[7], 2);
  assert.equal(tracker.dice.counts[12], 1);
  apply(tracker, "Game started");
  assert.equal(tracker.dice.total, 0); assert.equal(tracker.dice.unreadable, 0);
});

test("resources remain the default view and the secondary Dice tab renders distribution details", () => {
  const dom = browser('<div id="game-log-text"><div data-index="0">Alice rolled <img alt="dice_3"><img alt="dice_4"></div><div data-index="1">Alice got wood</div><div data-index="2">Bob rolled 8</div></div>');
  try {
    const shadow = dom.window.document.querySelector("#catantrack-extension").shadowRoot;
    assert.equal(shadow.querySelector("#resources-tab").getAttribute("aria-selected"), "true");
    assert.equal(shadow.querySelector("#dice-view").hidden, true);
    shadow.querySelector("#dice-tab").click();
    assert.equal(shadow.querySelector("#resource-view").hidden, true);
    assert.equal(shadow.querySelector('[data-dice-stat="total"]').textContent, "2");
    assert.equal(shadow.querySelector('[data-dice-stat="last"]').textContent, "8");
    assert.equal(shadow.querySelector('[data-dice-stat="sevens"]').textContent, "1");
    assert.equal(shadow.querySelectorAll(".dice-column").length, 11);
    assert.equal(shadow.querySelector('.dice-column[data-sum="7"]').getAttribute("data-count"), "1");
    assert.match(shadow.querySelector('.dice-column[data-sum="7"] title').textContent, /50.0%/);
    assert.doesNotMatch(shadow.querySelector(".dice-chart").outerHTML, /NaN|Infinity/);
    shadow.querySelector("#resources-tab").click();
    assert.equal(shadow.querySelector('input[aria-label="Alice wood"]').value, "1");
    assert.equal(shadow.querySelector("#resource-view").hidden, false);
    shadow.querySelector("#resources-tab").dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    assert.equal(shadow.querySelector("#dice-tab").getAttribute("aria-selected"), "true");
    assert.equal(shadow.activeElement, shadow.querySelector("#dice-tab"));
  } finally { dom.window.close(); }
});

test("indexed rerenders count once while two identical rolls with different indices count twice", async () => {
  const dom = browser('<div id="game-log-text"><div data-index="0">Alice rolled 8</div></div>');
  try {
    const doc = dom.window.document, shadow = doc.querySelector("#catantrack-extension").shadowRoot, log = doc.querySelector("#game-log-text");
    const copy = log.firstElementChild.cloneNode(true); log.replaceChildren(copy); await delay();
    const second = copy.cloneNode(true); second.dataset.index = "1"; log.append(second); await delay();
    shadow.querySelector("#dice-tab").click();
    assert.equal(shadow.querySelector('[data-dice-stat="total"]').textContent, "2");
    assert.equal(shadow.querySelector('.dice-column[data-sum="8"]').getAttribute("data-count"), "2");
  } finally { dom.window.close(); }
});

test("late-loading dice icons fill in a skipped roll and survive username replay", async () => {
  const dom = browser('<div id="game-log-text"><div data-index="0">Alice rolled <img alt="dice_6"></div></div>');
  try {
    const doc = dom.window.document, shadow = doc.querySelector("#catantrack-extension").shadowRoot;
    shadow.querySelector("#dice-tab").click();
    assert.equal(shadow.querySelector('[data-dice-stat="total"]').textContent, "0");
    assert.match(shadow.querySelector(".dice-note").textContent, /1 unreadable roll/);
    const second = doc.createElement("img"); second.alt = "dice_1";
    doc.querySelector('[data-index="0"]').append(second); await delay();
    assert.equal(shadow.querySelector('[data-dice-stat="total"]').textContent, "1");
    assert.equal(shadow.querySelector('[data-dice-stat="last"]').textContent, "7");
    assert.doesNotMatch(shadow.querySelector(".dice-note").textContent, /unreadable/);
    [...shadow.querySelectorAll("button")].find(b => b.textContent === "Change username").click();
    shadow.querySelector("#colonist-username").value = "ALICE";
    shadow.querySelector("form").dispatchEvent(new dom.window.Event("submit", { cancelable: true }));
    assert.equal(shadow.querySelector('[data-dice-stat="total"]').textContent, "1");
    assert.equal(shadow.querySelector('.dice-column[data-sum="7"]').getAttribute("data-count"), "1");
  } finally { dom.window.close(); }
});

test("clearing resources and rereading a partial log preserve previously observed dice history", async () => {
  const dom = browser('<div id="game-log-text"><div data-index="0">Game started</div><div data-index="1">Alice rolled 7</div><div data-index="2">Alice rolled 8</div><div data-index="3">Alice got wood</div></div>');
  try {
    const doc = dom.window.document, shadow = doc.querySelector("#catantrack-extension").shadowRoot, log = doc.querySelector("#game-log-text");
    [...shadow.querySelectorAll("button")].find(b => b.textContent === "Clear counts").click();
    assert.equal(shadow.querySelectorAll("tbody tr").length, 0);
    shadow.querySelector("#dice-tab").click();
    assert.equal(shadow.querySelector('[data-dice-stat="total"]').textContent, "2");
    // Simulate scrolling to the beginning: only the start and first roll remain.
    log.replaceChildren(log.children[0].cloneNode(true), log.children[1].cloneNode(true)); await delay();
    [...shadow.querySelectorAll("button")].find(b => b.textContent === "Re-read visible log").click();
    shadow.querySelector("#dice-tab").click();
    assert.equal(shadow.querySelector('[data-dice-stat="total"]').textContent, "2");
    assert.equal(shadow.querySelector('.dice-column[data-sum="8"]').getAttribute("data-count"), "1");
  } finally { dom.window.close(); }
});

test("a new game discards old dice even if old rows remain in the DOM", async () => {
  const dom = browser('<div id="game-log-text"><div data-index="0">Alice rolled 7</div></div>');
  try {
    const doc = dom.window.document, shadow = doc.querySelector("#catantrack-extension").shadowRoot, log = doc.querySelector("#game-log-text");
    for (const [index, text] of [[1, "Game started"], [2, "Alice rolled 12"]]) {
      const row = doc.createElement("div"); row.dataset.index = index; row.textContent = text; log.append(row);
    }
    await delay();
    // Force another scan of the still-present old row.
    log.firstElementChild.replaceWith(log.firstElementChild.cloneNode(true)); await delay();
    shadow.querySelector("#dice-tab").click();
    assert.equal(shadow.querySelector('[data-dice-stat="total"]').textContent, "1");
    assert.equal(shadow.querySelector('.dice-column[data-sum="7"]').getAttribute("data-count"), "0");
    assert.equal(shadow.querySelector('.dice-column[data-sum="12"]').getAttribute("data-count"), "1");
  } finally { dom.window.close(); }
});

test("scrolling into older indexed rolls does not replace the actual latest roll", () => {
  const stats = new DiceStats();
  stats.record("index:100", 8); stats.record("index:120", 9); stats.record("index:20", 3);
  assert.equal(stats.total, 3);
  assert.equal(stats.last, 9);
  assert.deepEqual(stats.recent, [3, 8, 9]);
});

test("changing rooms resets dice history and returns to the main Resources tab", async () => {
  const dom = browser('<div id="game-log-text"><div data-index="0">Alice rolled 7</div></div>');
  try {
    const doc = dom.window.document, shadow = doc.querySelector("#catantrack-extension").shadowRoot;
    shadow.querySelector("#dice-tab").click();
    dom.window.history.pushState({}, "", "/#another-room");
    const row = doc.createElement("div"); row.dataset.index = "0"; row.textContent = "Alice rolled 8";
    doc.querySelector("#game-log-text").replaceChildren(row); await delay();
    assert.equal(shadow.querySelector("#resources-tab").getAttribute("aria-selected"), "true");
    shadow.querySelector("#dice-tab").click();
    assert.equal(shadow.querySelector('[data-dice-stat="total"]').textContent, "1");
    assert.equal(shadow.querySelector('.dice-column[data-sum="7"]').getAttribute("data-count"), "0");
    assert.equal(shadow.querySelector('.dice-column[data-sum="8"]').getAttribute("data-count"), "1");
  } finally { dom.window.close(); }
});
