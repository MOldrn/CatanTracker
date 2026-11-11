(function () {
  "use strict";
  if (document.getElementById("catantrack-extension")) return;
  const { RESOURCES, Tracker, parse, resourceName } = globalThis.CatanTrack;
  const { read: readLog, messageText, resourceImageUrl, diagnosticHtml, playerColors } = globalThis.CatanTrackLog;
  const pageKey = () => location.pathname + location.search + location.hash;
  let tracker = new Tracker(), seen = new Set(), lastPath = pageKey();
  let localPlayer = "", journal = [];
  let activeTab = "resources", rollEvents = new Map();
  let colorsByName = new Map();
  let observedRows = new Map(), captureTruncated = false, firstObservedIndex = null;
  let lastEvent = "Waiting for a game log…", timer, rowCount = 0, baseline = false;
  let logInfo = { entries: [], containers: 0, virtualCandidates: 0, mode: "not scanned" };
  const host = document.createElement("div");
  host.id = "catantrack-extension";
  host.style.cssText = "position:fixed;right:18px;top:90px;z-index:2147483647;max-width:calc(100vw - 24px);";
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = `
    :host{all:initial;color-scheme:dark;font-family:system-ui,sans-serif;font-size:12px;color:#edf2ed}
    *{box-sizing:border-box}[hidden]{display:none!important}
    .identity{padding:7px 0}.identity label{display:block;font-size:12px;font-weight:600;margin-bottom:5px}.identity-entry{display:flex;gap:5px}.identity input{flex:1;min-width:0;width:100%;text-align:left;padding:5px 7px;border-color:#57705c}.identity p{margin:5px 0 0}.identity button{white-space:nowrap}.identity-info{display:flex;align-items:center;justify-content:space-between;gap:6px}.identity-info span{overflow-wrap:anywhere}
    .panel{width:340px;max-width:calc(100vw - 24px);background:#172722;box-shadow:0 8px 26px #0005;border:1px solid #456254;border-radius:10px;overflow:hidden}.panel.collapsed{width:174px}
    .panel{resize:both;overflow:auto;min-width:min(280px,calc(100vw - 24px));min-height:min(140px,calc(100vh - 24px));max-height:calc(100vh - 24px);container-type:inline-size}
    .panel.collapsed{width:174px!important;height:auto!important;min-width:0;min-height:0;resize:none}
    header{position:sticky;top:0;z-index:1}
    .mystery{display:inline-block;border:1px solid #967540;border-radius:4px;padding:1px 3px;color:#f1c56c;background:#463c29;white-space:nowrap;font-size:10px}
    header{display:flex;align-items:center;gap:5px;padding:5px 8px;background:#20382d;cursor:move;touch-action:none}header strong{flex:1;font-size:12px}header button{padding:1px;width:25px;height:25px;font-size:15px}
    button{font:inherit;cursor:pointer;border:1px solid #496252;border-radius:5px;background:#283f32;color:#eef5eb;padding:4px 7px}button:hover{background:#3a5542}button:focus-visible,input:focus-visible,summary:focus-visible{outline:2px solid #d4e98c;outline-offset:2px}
    .body{padding:4px 8px 6px}p{font-size:10px;color:#b9c9bd;line-height:1.45;margin:6px 0}.status{color:#b4cf92;margin:0 0 3px;font-size:9px}table{border-collapse:collapse;table-layout:fixed;width:100%;font-variant-numeric:tabular-nums}th{color:#b9c9bd;font-size:11px;font-weight:500;height:29px;padding:2px 0}th:first-child{width:25%;text-align:left}th:nth-last-child(-n+2){width:12%}td{height:27px;padding:2px 0;text-align:center;border-top:1px solid #344a3b}td:first-child{text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}td:last-child{font-size:10px}input{font:inherit;color:#eef5eb;text-align:center;width:26px;max-width:100%;background:transparent;border:1px solid transparent;border-radius:4px;padding:2px 0}input:hover{border-color:#57705c}input::-webkit-inner-spin-button{appearance:none}.resource-icon{display:inline-flex;align-items:center;justify-content:center;width:21px;height:24px;font-size:18px;vertical-align:middle}.resource-icon img{width:17px;height:24px;object-fit:contain}.uncertain{color:#f1c56c}.empty{padding:10px 4px;text-align:center;color:#b9c9bd;font-size:11px}.extras{max-height:40vh;overflow:auto;border-top:1px solid #344a3b;margin-top:5px;padding-top:4px}.tools{display:flex;gap:6px;margin-top:7px}.activity{overflow-wrap:anywhere;max-height:42px;overflow:auto}.legend{margin-top:2px}details{font-size:10px;color:#b9c9bd;margin-top:7px}summary{cursor:pointer}.log{max-height:80px;overflow:auto}.log p{margin:4px 0}
    .body{font-size:clamp(11px,3.5cqi,18px)}.body th{font-size:.9em;height:2.4em}.body td{height:2.25em}.body td:first-child{font-weight:600}.body td:last-child{font-size:.85em}.body input[type=number]{width:2.2em}.mystery{font-size:.85em}.resource-icon{width:1.8em;height:2em;font-size:1em}.resource-icon>span{font-size:1.5em}.resource-icon img{width:1.4em;height:2em}.incomplete-flag{color:#f1c56c}
    .view-tabs{display:flex;gap:4px;padding:4px 0 6px;border-bottom:1px solid #344a3b;margin-bottom:3px}.view-tabs button{font-size:10px;padding:4px 9px;background:transparent;border-color:transparent;color:#a5b9aa}.view-tabs button:first-child{font-weight:600}.view-tabs button[aria-selected=true]{background:#2c4934;border-color:#58764f;color:#e2f1c8}
  `;
  shadow.append(style);
  function el(tag, text, parent, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    if (parent) parent.append(node);
    return node;
  }
  const panel = el("section", undefined, shadow, "panel");
  panel.setAttribute("aria-label", "CatanTrack resource tracker");
  const header = el("header", undefined, panel);
  el("strong", "CatanTrack - Moldrn :P", header);
  const collapse = el("button", "−", header); collapse.title = "Collapse tracker";
  collapse.setAttribute("aria-expanded", "true");
  const more = el("button", "⋯", header);
  more.title = "Show help and controls";
  more.setAttribute("aria-label", "Show help and controls");
  more.setAttribute("aria-expanded", "false");
  more.setAttribute("aria-controls", "tracker-controls");
  const body = el("div", undefined, panel, "body");
  const identityForm = el("form", undefined, body, "identity");
  const identityLabel = el("label", "What's your Colonist username?", identityForm);
  identityLabel.htmlFor = "colonist-username";
  const identityEntry = el("div", undefined, identityForm, "identity-entry");
  const username = el("input", undefined, identityEntry);
  username.id = "colonist-username"; username.type = "text"; username.required = true; username.maxLength = 100;
  username.autocomplete = "username"; username.placeholder = "Your in-game name";
  username.setAttribute("list", "colonist-player-names");
  const suggestions = el("datalist", undefined, identityForm); suggestions.id = "colonist-player-names";
  const saveUsername = el("button", "Start tracking", identityEntry); saveUsername.type = "submit";
  const cancelUsername = el("button", "Cancel", identityEntry); cancelUsername.type = "button"; cancelUsername.hidden = true;
  el("p", 'Enter your exact game name so "You" and "you" update your hand.', identityForm);
  const status = el("p", undefined, body, "status");
  const tabs = el("div", undefined, body, "view-tabs"); tabs.setAttribute("role", "tablist"); tabs.setAttribute("aria-label", "Tracker views");
  const resourceTab = el("button", "Resources", tabs), diceTab = el("button", "Dice", tabs);
  const resourceView = el("div", undefined, body); resourceView.id = "resource-view";
  const dicePanel = el("div", undefined, body); dicePanel.id = "dice-view";
  const diceView = globalThis.CatanTrackDiceView.create(dicePanel);
  for (const [button, id, view] of [[resourceTab, "resources", resourceView], [diceTab, "dice", dicePanel]]) {
    button.type = "button"; button.id = `${id}-tab`; button.setAttribute("role", "tab"); button.setAttribute("aria-controls", view.id);
    view.setAttribute("role", "tabpanel"); view.setAttribute("aria-labelledby", button.id);
    button.addEventListener("click", () => { activeTab = id; render(); });
    button.addEventListener("keydown", event => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      const target = event.key === "Home" ? resourceTab : event.key === "End" ? diceTab : button === resourceTab ? diceTab : resourceTab;
      target.click(); target.focus();
    });
  }
  const table = el("table", undefined, resourceView);
  const tr = el("tr", undefined, el("thead", undefined, table));
  const icons = new Map();
  const fallbackIcons = { wood: "🌲", brick: "🧱", sheep: "🐑", wheat: "🌾", ore: "🪨" };
  for (const label of ["Player", "Wood", "Brick", "Sheep", "Wheat", "Ore", "Unknown", "Total"]) {
    const th = el("th", undefined, tr); th.scope = "col";
    th.title = label; th.setAttribute("aria-label", label);
    const resource = label.toLowerCase();
    if (RESOURCES.includes(resource)) {
      const icon = el("span", undefined, th, "resource-icon"); icon.setAttribute("aria-hidden", "true");
      const fallback = el("span", fallbackIcons[resource], icon);
      const img = el("img", undefined, icon); img.alt = ""; img.hidden = true; img.referrerPolicy = "no-referrer";
      img.addEventListener("load", () => { img.hidden = false; fallback.hidden = true; });
      img.addEventListener("error", () => { img.hidden = true; fallback.hidden = false; });
      icons.set(resource, img);
    } else th.textContent = label === "Unknown" ? "?" : label === "Total" ? "Σ" : label;
  }
  const tbody = el("tbody", undefined, table);
  const empty = el("div", "Start a game with the English game log open.", resourceView, "empty");
  const extras = el("div", undefined, body, "extras"); extras.id = "tracker-controls"; extras.hidden = true;
  const identityInfo = el("div", undefined, extras, "identity-info");
  const identityName = el("span", undefined, identityInfo);
  const changeUsername = el("button", "Change username", identityInfo); changeUsername.type = "button";
  el("p", "Drag the header to move or the bottom-right corner to resize. Hover a picture for its resource name. Edit counts to correct them. ? cards have unknown types; purchases can resolve them. ! means missing information. Load before opening placements.", extras, "legend");
  const resetSize = el("button", "Reset panel size", extras);
  resetSize.addEventListener("click", () => { panel.style.removeProperty("width"); panel.style.removeProperty("height"); keepInViewport(); });
  const activity = el("p", undefined, extras, "activity");
  const tools = el("div", undefined, extras, "tools");
  const reset = el("button", "Clear counts", tools);
  reset.title = "Clear counts and track only future log entries";
  const replay = el("button", "Re-read visible log", tools);
  replay.title = "Rebuild from currently available log entries; older entries may be missing";
  const exportReport = el("button", "Export debug report", extras);
  exportReport.style.marginTop = "7px";
  exportReport.title = "Download observed game-log entries, parsed events, and tracker counts as JSON";
  el("p", "For count mismatches, export a report before refreshing. It contains your username and the game log observed in this tab; nothing is sent automatically.", extras);
  const details = el("details", undefined, extras);
  el("summary", "Recent recognized events", details);
  const history = el("div", undefined, details, "log");
  const diagnostics = el("details", undefined, extras);
  el("summary", "Game log diagnostics", diagnostics);
  const diagnosticText = el("pre", undefined, diagnostics);
  diagnosticText.style.cssText = "white-space:pre-wrap;overflow-wrap:anywhere;max-height:220px;overflow:auto;user-select:text;font-size:10px";
  const recent = [];
  function render() {
    status.textContent = rowCount ? tracker.events ? `${tracker.players.size} players · ${tracker.events} events${baseline ? " · counts cleared" : ""}` : `Game log found · ${rowCount} rows · no recognized events yet` : logInfo.containers ? "Game log found · waiting for entries…" : "Game log not found · see ⋯ → Game log diagnostics";
    if (!localPlayer) status.textContent = "Enter your username above to start tracking.";
    table.hidden = !localPlayer;
    tabs.hidden = !localPlayer;
    resourceView.hidden = !localPlayer || activeTab !== "resources";
    dicePanel.hidden = !localPlayer || activeTab !== "dice";
    resourceTab.setAttribute("aria-selected", String(activeTab === "resources")); resourceTab.tabIndex = activeTab === "resources" ? 0 : -1;
    diceTab.setAttribute("aria-selected", String(activeTab === "dice")); diceTab.tabIndex = activeTab === "dice" ? 0 : -1;
    diceTab.textContent = `Dice${tracker.dice.total ? ` · ${tracker.dice.total}` : ""}`;
    if (activeTab === "dice") diceView.render(tracker.dice);
    identityInfo.hidden = !localPlayer;
    identityName.textContent = localPlayer ? `Playing as ${localPlayer}` : "";
    suggestions.replaceChildren();
    for (const name of tracker.players.keys()) if (!/^you$/i.test(name)) el("option", name, suggestions).value = name;
    activity.textContent = lastEvent;
    empty.hidden = !localPlayer || tracker.players.size > 0;
    tbody.replaceChildren();
    for (const player of tracker.players.values()) {
      const row = el("tr", undefined, tbody);
      const name = el("td", player.name, row, player.uncertain ? "uncertain" : "");
      const matches = [...colorsByName].filter(([rawName]) => tracker.resolveName(rawName) === player.name);
      const color = matches.find(([rawName]) => !/^you$/i.test(rawName))?.[1] || matches[0]?.[1];
      if (color) name.style.color = color;
      if (player.incomplete) el("span", " !", name, "incomplete-flag");
      name.title = player.incomplete ? "Missing or unsupported information: these counts may be incomplete." : player.name;
      for (const resource of RESOURCES) {
        const input = el("input", undefined, el("td", undefined, row));
        input.type = "number"; input.min = "0"; input.max = "999"; input.step = "1"; input.value = player.resources[resource];
        input.setAttribute("aria-label", `${player.name} ${resource}`);
        input.title = player.maximum[resource] > player.resources[resource] ? `${player.resources[resource]} guaranteed; up to ${player.maximum[resource]} possible including unknown cards.` : `${player.resources[resource]} known ${resource}`;
        input.addEventListener("change", () => {
          const value = Number(input.value);
          if (input.value.trim() && Number.isInteger(value) && value >= 0 && value <= 999) {
            journal.push({ kind: "correction", player: player.name === localPlayer ? "You" : player.name, resource, delta: value - player.resources[resource] });
            tracker.setCount(player.name, resource, value);
          }
          render();
        });
      }
      const unknown = el("td", undefined, row);
      unknown.setAttribute("aria-label", `${player.name} unknown cards`);
      if (player.unknown) {
        const card = el("span", `? × ${player.unknown}`, unknown, "mystery");
        const possible = RESOURCES.filter(r => player.maximum[r] > player.resources[r]);
        card.title = `Unresolved cards. Possible types: ${possible.join(", ")}.${tracker.inferenceLimited ? " Using conservative inference after many hidden transfers." : ""}`;
      } else unknown.textContent = "0";
      const total = player.totalMin === player.totalMax ? String(player.totalMin) : `${player.totalMin}–${player.totalMax}`;
      el("td", total + (player.incomplete ? " !" : ""), row);
    }
    history.replaceChildren();
    recent.forEach(text => el("p", text, history));
    diagnosticText.textContent = [
      "CatanTrack 0.5.0", `Reader: ${logInfo.mode}`, `Local player: ${localPlayer || "not set"}`,
      `Log containers: ${logInfo.containers}; virtual scrollers: ${logInfo.virtualCandidates}; rows: ${rowCount}; events: ${tracker.events}`,
      ...logInfo.entries.slice(-3).map(row => `Message: ${messageText(row)}\nHTML: ${diagnosticHtml(row).slice(0, 2500)}`),
      !rowCount ? "DOM hints: " + [...document.querySelectorAll('[class*="scroll" i], [class*="feed" i], [id*="log" i], [class*="log" i]')].filter(node => node !== host).slice(0, 25).map(node => `${node.tagName.toLowerCase()}#${node.id}.${String(node.className).replace(/\s+/g, ".")}`).join("\n") : ""
    ].filter(Boolean).join("\n\n");
  }
  exportReport.addEventListener("click", () => {
    const report = {
      version: "0.5.0", exportedAt: new Date().toISOString(), room: location.pathname + location.hash, localPlayer,
      coverage: { firstObservedIndex, retainedRows: observedRows.size, captureTruncated, countsCleared: baseline },
      reader: { mode: logInfo.mode, containers: logInfo.containers, visibleRows: rowCount },
      eventsApplied: tracker.events, inferenceLimited: tracker.inferenceLimited, dice: tracker.dice,
      players: [...tracker.players.values()], journal, rows: [...observedRows.values()]
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob), link = document.createElement("a");
    link.href = url; link.download = "catantrack-debug.json";
    shadow.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  function rebuildForUsername() {
    const dice = tracker.dice;
    tracker = new Tracker({ localPlayer });
    tracker.dice = dice;
    tracker.started = baseline;
    // Replay original events rather than adding already-clamped duplicate hands.
    // This also restores theft constraints and preserves manual adjustments.
    for (const entry of journal) {
      if (entry.kind !== "correction") { tracker.apply(entry); continue; }
      const player = tracker.player(entry.player);
      const value = player.resources[entry.resource] + entry.delta;
      if (value < 0 || value > 999) player.incomplete = true;
      tracker.setCount(entry.player, entry.resource, Math.max(0, Math.min(999, value)));
    }
  }
  username.addEventListener("input", () => username.setCustomValidity(""));
  identityForm.addEventListener("submit", event => {
    event.preventDefault();
    const name = username.value.replace(/\s+/g, " ").trim();
    if (!name) { username.setCustomValidity("Enter your Colonist username."); username.reportValidity(); return; }
    localPlayer = name;
    username.value = name; username.setCustomValidity("");
    identityForm.hidden = true; cancelUsername.hidden = false; saveUsername.textContent = "Save";
    rebuildForUsername(); render();
  });
  changeUsername.addEventListener("click", () => {
    identityForm.hidden = false; username.value = localPlayer; username.focus(); username.select();
  });
  cancelUsername.addEventListener("click", () => { identityForm.hidden = true; username.value = localPlayer; username.setCustomValidity(""); });
  function refreshResourceIcons() {
    // Reuse resource-card images already present in the game. No external asset
    // lookup or extension-hosted images are needed; emoji remain as fallbacks.
    const matched = new Set();
    for (const image of document.querySelectorAll('img[src*="card_"]')) {
      const url = resourceImageUrl(image.currentSrc || image.getAttribute("src"), document.baseURI);
      if (!url) continue;
      const resource = resourceName(new URL(url).pathname.split("/").pop());
      const icon = icons.get(resource);
      if (matched.has(resource)) continue;
      matched.add(resource);
      if (icon && icon.getAttribute("src") !== url) icon.src = url;
    }
  }
  function scan() {
    timer = undefined;
    const path = pageKey();
    if (path !== lastPath) {
      lastPath = path; tracker = new Tracker({ localPlayer }); journal = []; seen.clear(); recent.length = 0; baseline = false;
      activeTab = "resources"; rollEvents = new Map();
      colorsByName = new Map();
      observedRows = new Map(); captureTruncated = false; firstObservedIndex = null;
      lastEvent = "New page — rebuilding from available game log.";
    }
    const previousMode = logInfo.mode;
    logInfo = readLog(document);
    refreshResourceIcons();
    const entries = logInfo.entries, occurrences = new Map();
    const previousCount = rowCount;
    rowCount = entries.length;
    let changed = previousCount !== rowCount || previousMode !== logInfo.mode;
    for (const row of entries) {
      for (const { name, color } of playerColors(row)) if (colorsByName.get(name) !== color) { colorsByName.set(name, color); changed = true; }
      const text = messageText(row);
      const occurrence = (occurrences.get(text) || 0) + 1;
      occurrences.set(text, occurrence);
      const index = row.getAttribute("data-index");
      const key = index !== null ? `index:${index}` : row.id ? `id:${row.id}` : `text:${text}:${occurrence}`;
      if (firstObservedIndex === null && index !== null && /^\d+$/.test(index)) firstObservedIndex = Number(index);
      if (observedRows.get(key)?.text !== text) {
        observedRows.set(key, { key, index, text, html: diagnosticHtml(row), parsed: parse(text) });
        if (observedRows.size > 5000) { observedRows.delete(observedRows.keys().next().value); captureTruncated = true; }
      }
      const event = parse(text);
      if (event?.type === "roll") event.id = key;
      if (seen.has(key)) {
        if (rollEvents.has(key) && event?.type === "roll" && event.sum !== null && tracker.dice.record(key, event.sum)) {
          const original = rollEvents.get(key);
          if (original) Object.assign(original, event);
          changed = true;
        }
        continue;
      }
      // Leave incomplete/unsupported entries eligible for a later DOM update.
      if (!event) continue;
      seen.add(key);
      if (tracker.apply(event)) {
        if (event.type === "start") { journal = []; baseline = false; rollEvents = new Map(); activeTab = "resources"; }
        if (event.type === "roll") rollEvents.set(key, event);
        journal.push(event);
        changed = true; lastEvent = event.text;
        recent.unshift(event.text); recent.splice(8);
      }
    }
    // Avoid destroying a count field while the user is typing.
    if ((changed || diagnostics.open) && shadow.activeElement?.tagName !== "INPUT") render();
  }
  function schedule() { if (!timer) timer = setTimeout(scan, 120); }
  reset.addEventListener("click", () => {
    const dice = tracker.dice;
    tracker = new Tracker({ localPlayer }); journal = []; tracker.started = true; baseline = true; recent.length = 0;
    tracker.dice = dice;
    lastEvent = "Counts cleared. Tracking future entries only; enter existing hands manually."; render();
  });
  replay.addEventListener("click", () => {
    const dice = tracker.dice;
    const previousRolls = rollEvents;
    tracker = new Tracker({ localPlayer }); journal = []; seen.clear(); recent.length = 0; baseline = false;
    tracker.dice = dice;
    scan();
    if (tracker.dice !== dice) {
      for (const [id, sum] of tracker.dice.rolls) dice.record(id, sum);
      tracker.dice = dice;
      rollEvents = new Map([...previousRolls, ...rollEvents]);
    }
    lastEvent = tracker.events ? "Rebuilt from available log. Missing earlier history can make counts incomplete." : "No events read. Expand Game log diagnostics to inspect detection."; render();
  });
  collapse.addEventListener("click", () => {
    body.hidden = !body.hidden; collapse.textContent = body.hidden ? "+" : "−";
    panel.classList.toggle("collapsed", body.hidden);
    if (body.hidden) {
      extras.hidden = true; more.title = "Show help and controls";
      more.setAttribute("aria-label", more.title); more.setAttribute("aria-expanded", "false");
    }
    collapse.setAttribute("aria-expanded", String(!body.hidden));
    collapse.title = body.hidden ? "Expand tracker" : "Collapse tracker";
  });
  more.addEventListener("click", () => {
    extras.hidden = !extras.hidden;
    if (!extras.hidden && body.hidden) collapse.click();
    const label = extras.hidden ? "Show help and controls" : "Hide help and controls";
    more.title = label; more.setAttribute("aria-label", label);
    more.setAttribute("aria-expanded", String(!extras.hidden));
  });
  header.addEventListener("pointerdown", event => {
    if (event.target.closest("button")) return;
    const box = host.getBoundingClientRect();
    const offsetX = event.clientX - box.left, offsetY = event.clientY - box.top;
    header.setPointerCapture(event.pointerId);
    const move = e => {
      host.style.right = "auto";
      host.style.left = Math.max(0, Math.min(innerWidth - box.width, e.clientX - offsetX)) + "px";
      host.style.top = Math.max(0, Math.min(innerHeight - box.height, e.clientY - offsetY)) + "px";
    };
    header.addEventListener("pointermove", move);
    header.addEventListener("pointerup", () => header.removeEventListener("pointermove", move), { once: true });
    header.addEventListener("pointercancel", () => header.removeEventListener("pointermove", move), { once: true });
  });
  function keepInViewport() {
    const box = host.getBoundingClientRect();
    if (!box.width || !box.height) return;
    host.style.left = Math.max(0, Math.min(innerWidth - box.width, box.left)) + "px";
    host.style.top = Math.max(0, Math.min(innerHeight - box.height, box.top)) + "px";
    host.style.right = "auto";
  }
  document.body.append(host);
  if (typeof ResizeObserver === "function") new ResizeObserver(keepInViewport).observe(panel);
  window.addEventListener("resize", keepInViewport);
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["alt", "src", "data-index"] });
  // Navigation and log replacement may happen without an immediate row mutation.
  setInterval(schedule, 2000);
  render(); scan();
})();
