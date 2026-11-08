/* DOM adapter: keep Colonist markup changes separate from resource inference. */
(function (root) {
  "use strict";
  const NAMED_LOGS = '#game-log-text, #game-log, #gameLog, [data-testid="game-log"], [class*="gameLog" i], [class*="game-log" i], [class*="game_log" i]';
  const VIRTUAL_LOGS = '[class*="virtualScroller"]';
  const ROWS = '[data-index], [class*="scrollItemContainer"], .message_post, .message-post, .log-message, [data-testid="log-message"]';
  const CHAT = '#chat, #chat-text, [data-testid="chat"], [data-testid="chat-log"], [class*="chatMessage"], [class*="chatFeed"]';
  const api = () => root.CatanTrack;
  function messageNode(row) {
    // Avatars, badges and timestamps are outside the message body in the feed.
    return row.querySelector('[class*="messagePart"]') || row;
  }
  function messageText(row) { return api().textFromNode(messageNode(row)).replace(/\s+/g, " ").trim(); }
  function playerColors(row) {
    const colors = [];
    for (const span of messageNode(row).querySelectorAll("span[style]")) {
      const name = span.textContent.trim(), color = span.style.color;
      if (name && name.length <= 100 && color && !/^(?:inherit|initial|unset|revert|currentcolor|transparent)$/i.test(color)) colors.push({ name, color });
    }
    return colors;
  }
  function resourceImageUrl(value, base) {
    if (typeof value !== "string" || value.length > 2048) return null;
    let url;
    try { url = new URL(value, base); } catch { return null; }
    if (url.protocol !== "https:" || url.hostname !== "cdn.colonist.io" || url.port || url.username || url.password || url.search || url.hash) return null;
    if (!/^\/dist\/assets\/card_(?:wood|lumber|brick|sheep|wool|wheat|grain|ore)(?:[._-][a-z0-9_-]+)*\.(?:svg|png|webp)$/i.test(url.pathname)) return null;
    return url.href;
  }
  function diagnosticHtml(row) {
    // Export message structure, not arbitrary page attributes, links, form values,
    // scripts, or signed URLs. This markup is serialized only, never injected.
    const node = messageNode(row).cloneNode(true);
    if (node.matches("script,style,iframe,object,embed,link,meta,input,textarea,select,button")) return "";
    for (const child of node.querySelectorAll("script,style,iframe,object,embed,link,meta,input,textarea,select,button")) child.remove();
    for (const element of [node, ...node.querySelectorAll("*")]) {
      for (const attribute of [...element.attributes]) {
        if (attribute.name === "class" || attribute.name === "alt") continue;
        if (attribute.name === "src" && element.tagName === "IMG") {
          const safe = resourceImageUrl(attribute.value, row.ownerDocument.baseURI);
          if (safe) { element.setAttribute("src", safe); continue; }
        }
        element.removeAttribute(attribute.name);
      }
    }
    return node.outerHTML.slice(0, 16384);
  }
  function isChat(row) {
    if (row.closest(CHAT)) return true;
    // Chat and game logs can share the same virtual-scroller component. Chat
    // prefixes its message with "name:", whereas game actions use "name got".
    const node = messageNode(row);
    const name = node.querySelector('span[style*="font-weight"], [class*="username"], [class*="playerName"]');
    if (!name) return false;
    return node.textContent.trimStart().startsWith(name.textContent.trim() + ":");
  }
  function containerRows(container) {
    const candidates = [...container.querySelectorAll(ROWS)];
    const matches = new Set(candidates);
    // Retain the indexed wrapper and discard its nested message selector.
    return candidates.filter(row => {
      for (let parent = row.parentElement; parent && parent !== container; parent = parent.parentElement) {
        if (matches.has(parent)) return false;
      }
      return true;
    });
  }
  function read(document) {
    const named = [...document.querySelectorAll(NAMED_LOGS)].filter(node => !node.closest(CHAT));
    const virtual = [...document.querySelectorAll(VIRTUAL_LOGS)].filter(node => !node.closest(CHAT));
    const selected = new Set(), containers = new Set();
    for (const container of named) {
      containers.add(container);
      const rows = containerRows(container);
      for (const row of rows.length ? rows : container.children) if (!isChat(row)) selected.add(row);
    }
    let virtualFound = false;
    for (const container of virtual) {
      const rows = containerRows(container).filter(row => !isChat(row));
      // Never select an arbitrary scroller: require game-feed markup and a
      // recognizable action. This avoids bank, player-list and chat scrollers.
      const gameFeed = rows.some(row => row.querySelector('[class*="feedMessage"] [class*="messagePart"]') && api().parse(messageText(row)));
      if (!gameFeed) continue;
      containers.add(container); virtualFound = true;
      for (const row of rows) selected.add(row);
    }
    // The row format is more stable than the surrounding layout. Also discover
    // indexed feed rows directly when Colonist renames its scroller wrapper.
    const indexed = [...document.querySelectorAll('[class*="scrollItemContainer"][data-index]')].filter(row => !isChat(row));
    const feedParents = new Set(indexed.filter(row => row.querySelector('[class*="feedMessage"] [class*="messagePart"]') && api().parse(messageText(row))).map(row => row.parentElement));
    for (const row of indexed) if (feedParents.has(row.parentElement)) { containers.add(row.parentElement); selected.add(row); }
    // Nested named/virtual containers can yield the same row at different levels.
    const entries = [...selected].filter(row => {
      for (let parent = row.parentElement; parent; parent = parent.parentElement) if (selected.has(parent)) return false;
      return true;
    });
    if (entries.length && entries.every(row => /^\d+$/.test(row.getAttribute("data-index") || ""))) {
      entries.sort((a, b) => Number(a.getAttribute("data-index")) - Number(b.getAttribute("data-index")));
    }
    return { entries, containers: containers.size, virtualCandidates: virtual.length, mode: virtualFound ? "virtual game feed" : feedParents.size ? "indexed game feed" : named.length ? "named game log" : "no matching game log" };
  }
  root.CatanTrackLog = { read, messageText, messageNode, resourceImageUrl, diagnosticHtml, playerColors };
})(globalThis);
