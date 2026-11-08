/* Shared by the isolated content script and the Node test suite. */
(function (root) {
  "use strict";
  const RESOURCES = ["wood", "brick", "sheep", "wheat", "ore"];
  const ALIASES = { lumber: "wood", timber: "wood", wool: "sheep", grain: "wheat", clay: "brick" };
  const COSTS = {
    road: { wood: 1, brick: 1 },
    settlement: { wood: 1, brick: 1, sheep: 1, wheat: 1 },
    city: { wheat: 2, ore: 3 },
    "development card": { sheep: 1, wheat: 1, ore: 1 }
  };
  const clean = text => text.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  function resourceName(label) {
    const words = String(label).toLowerCase().split(/[^a-z]+/);
    for (const word of words) {
      if (RESOURCES.includes(word)) return word;
      if (Object.hasOwn(ALIASES, word)) return ALIASES[word];
    }
    return null;
  }
  function textFromNode(node) {
    if (node.nodeType === 3) return node.textContent;
    if (node.nodeType !== 1) return "";
    if (node.tagName === "IMG") {
      const label = [node.getAttribute("alt"), node.getAttribute("title"), node.getAttribute("src")].filter(Boolean).join(" ");
      const resource = resourceName(label);
      if (resource) return ` ${resource} `;
      const item = label.match(/road[ _-]*building|year[ _-]*of[ _-]*plenty|development[ _-]*card|settlement|city|road|monopoly|knight|card[ _-]*back/i);
      return item ? ` ${item[0].replace(/[_-]/g, " ").toLowerCase()} ` : ` ${node.getAttribute("alt") || ""} `;
    }
    return Array.from(node.childNodes, textFromNode).join("");
  }
  function resources(text) {
    const result = {};
    const re = /(?:(\d+)\s*(?:[x×]\s*)?)?\b(wood|lumber|timber|brick|clay|sheep|wool|wheat|grain|ore)\b/gi;
    for (const match of text.matchAll(re)) {
      const key = resourceName(match[2]);
      const amount = match[1] ? Number(match[1]) : 1;
      if (!Number.isSafeInteger(amount) || amount < 1 || amount > 999 || (result[key] || 0) + amount > 999) return {};
      result[key] = (result[key] || 0) + amount;
    }
    return result;
  }
  function parse(input) {
    const rawText = typeof input === "string" ? input : textFromNode(input);
    // Bound regex work and numeric input from the page's untrusted log markup.
    if (rawText.length > 8192) return null;
    const text = clean(rawText);
    if (/^(?:the )?game (?:has )?(?:started|begins|starting)/i.test(text)) return { type: "start", text };
    // Match the action after the full player name; names may contain spaces.
    const match = text.match(/^(.+?)\s+(received|gained|got|built|placed|bought|purchased|spent|discarded|gave|traded|stole|played|rolled|took)\b\s*(.*)$/i);
    if (!match) return null;
    const [, name, rawAction, tail] = match;
    const player = name.replace(/:$/, "").trim();
    const action = rawAction.toLowerCase();
    const base = { player, text };
    if (action === "rolled") return { ...base, type: "roll" };
    if (["got", "received", "gained", "took"].includes(action)) {
      const gain = resources(tail);
      if (Object.keys(gain).length) return { ...base, type: "gain", resources: gain };
      if (/\b(?:cards?|resources?)\b/i.test(tail)) return { ...base, type: "unknown" };
    }
    if (["built", "placed", "bought", "purchased"].includes(action)) {
      const item = tail.match(/development\s*card|\bdev\s*card|\broad\b|\bsettlement\b|\bcity\b/i);
      if (item) return { ...base, type: "build", item: /^(dev|development)/i.test(item[0]) ? "development card" : item[0].toLowerCase(), free: action === "placed" || /\bfree\b|initial|starting/i.test(tail) };
    }
    if (action === "gave") {
      // Colonist logs completed exchanges as "gave ... and got/took ...".
      // Split the two sides before counting icons: the received cards are gains.
      const exchange = tail.match(/^(.*?)\s+and\s+(?:got|took|received)\b\s*(.*)$/i);
      if (exchange) {
        if (!exchange[2].trim()) return null;
        const given = exchange[1].replace(/^(?:to\s+)?(?:the\s+)?(?:bank|port|harbor)\s+/i, "");
        const destination = given.match(/^(.*?)\s+to\s+(.+?)\.?$/i);
        const received = exchange[2].match(/^(.*?)(?:\s+from\s+(.+?))?\.?$/i);
        const give = resources(destination ? destination[1] : given);
        const receive = resources(received[1]);
        const partnerName = received[2] || destination?.[2];
        const partner = partnerName && !/^(?:the\s+)?(?:bank|port|harbor)$/i.test(partnerName) ? partnerName : null;
        if (Object.keys(give).length && Object.keys(receive).length) return { ...base, type: "trade", give, receive, partner };
        return /\b(?:cards?|resources?)\b/i.test(exchange[1] + " " + exchange[2]) ? { ...base, type: "unknown" } : null;
      }
    }
    if (["spent", "discarded", "gave"].includes(action)) {
      const loss = resources(tail);
      return { ...base, type: Object.keys(loss).length ? "loss" : "unknown", resources: loss };
    }
    if (action === "traded") {
      const trade = tail.match(/^(.*?)\s+for\s+(.*?)(?:\s+with\s+(.+?))?\.?$/i);
      if (trade) {
        const give = resources(trade[1]), receive = resources(trade[2]);
        if (Object.keys(give).length && Object.keys(receive).length) return { ...base, type: "trade", give, receive, partner: trade[3] && !/^(?:the )?(?:bank|port|harbor)$/i.test(trade[3]) ? trade[3] : null };
      }
      return { ...base, type: "unknown" };
    }
    if (action === "stole") {
      const steal = tail.match(/^(.*?)\s+from\s+(.+?)\.?$/i);
      return { ...base, type: "steal", victim: steal?.[2], resources: steal ? resources(steal[1]) : {} };
    }
    if (action === "played") {
      if (/road\s*building/i.test(tail)) return { ...base, type: "free-roads" };
      // The following gain lines handle Year of Plenty. Monopoly needs a future adapter.
      if (/monopoly/i.test(tail)) return { ...base, type: "unknown-all" };
    }
    return null;
  }
  // Each world is a possible set of hands. Transfers keep the thief and victim
  // linked, so evidence about either player can resolve the other player's hand.
  const emptyHand = () => RESOURCES.map(() => 0);
  const copyWorld = world => world.map(hand => hand.slice());
  class Tracker {
    constructor({ maxWorlds = 2048, localPlayer = "" } = {}) {
      this.localPlayer = clean(localPlayer);
      this.players = new Map(); this.started = false; this.events = 0;
      this.worlds = [[]]; this.maxWorlds = Math.max(1, maxWorlds);
      this.inferenceLimited = false;
    }
    resolveName(name) {
      if (typeof name !== "string") return name;
      name = clean(name);
      if (/^you$/i.test(name)) return this.localPlayer || "You";
      if (this.localPlayer && name.toLowerCase() === this.localPlayer.toLowerCase()) return this.localPlayer;
      return name;
    }
    player(name) {
      name = this.resolveName(name);
      if (!this.players.has(name)) {
        this.players.set(name, {
          name, index: this.players.size,
          resources: Object.fromEntries(RESOURCES.map(r => [r, 0])),
          maximum: Object.fromEntries(RESOURCES.map(r => [r, 0])),
          unknown: 0, totalMin: 0, totalMax: 0,
          incomplete: false, uncertain: false, freeRoads: 0,
          placements: { road: 0, settlement: 0 }
        });
        if (this.worlds) for (const world of this.worlds) world.push(emptyHand());
      }
      return this.players.get(name);
    }
    sync(worlds = this.worlds) {
      for (const player of this.players.values()) {
        if (worlds) {
          const minimum = RESOURCES.map(() => Infinity), maximum = emptyHand();
          let totalMin = Infinity, totalMax = 0;
          for (const world of worlds) {
            const hand = world[player.index];
            let total = 0;
            for (let i = 0; i < RESOURCES.length; i++) {
              minimum[i] = Math.min(minimum[i], hand[i]);
              maximum[i] = Math.max(maximum[i], hand[i]);
              total += hand[i];
            }
            totalMin = Math.min(totalMin, total); totalMax = Math.max(totalMax, total);
          }
          RESOURCES.forEach((r, i) => { player.resources[r] = minimum[i]; player.maximum[r] = maximum[i]; });
          player.totalMin = totalMin; player.totalMax = totalMax;
          player.unknown = totalMax - minimum.reduce((a, b) => a + b, 0);
        } else {
          player.totalMin = player.totalMax = Object.values(player.resources).reduce((a, b) => a + b, 0) + player.unknown;
          for (const r of RESOURCES) player.maximum[r] = player.resources[r] + player.unknown;
        }
        player.uncertain = player.incomplete || player.unknown > 0;
      }
    }
    replaceWorlds(worlds) {
      this.worlds = [...new Map(worlds.map(world => [world.map(hand => hand.join(",")).join(";"), world])).values()];
      this.sync();
      if (this.worlds.length > this.maxWorlds) {
        // Keep a conservative envelope of ALL outcomes, never a sampled subset:
        // sampling could turn an arbitrary guess into an apparently certain card.
        this.worlds = null;
        this.inferenceLimited = true;
        this.sync();
      }
    }
    setCount(name, resource, value) {
      if (!RESOURCES.includes(resource) || !Number.isInteger(value) || value < 0 || value > 999) return;
      const player = this.player(name);
      if (this.worlds) {
        // Editing the guaranteed count should preserve additional possible cards.
        const delta = value - player.resources[resource];
        for (const world of this.worlds) world[player.index][RESOURCES.indexOf(resource)] += delta;
        this.replaceWorlds(this.worlds);
      } else { player.resources[resource] = value; this.sync(); }
    }
    change(name, amounts, sign) {
      const player = this.player(name);
      if (this.worlds) {
        if (sign < 0 && !player.incomplete) {
          const valid = this.worlds.filter(world => RESOURCES.every((r, i) => world[player.index][i] >= (amounts[r] || 0)));
          if (valid.length) this.worlds = valid;
          else player.incomplete = true;
        }
        for (const world of this.worlds) for (let i = 0; i < RESOURCES.length; i++) {
          world[player.index][i] = Math.max(0, world[player.index][i] + sign * (amounts[RESOURCES[i]] || 0));
        }
        this.replaceWorlds(this.worlds);
      } else {
        // Generic unknown cards can pay missing costs, but we do not pick their
        // types when the known cards already cover the purchase.
        let deficit = 0;
        for (const r of RESOURCES) {
          const next = player.resources[r] + sign * (amounts[r] || 0);
          if (next < 0) deficit -= next;
          player.resources[r] = Math.max(0, next);
        }
        if (deficit > player.unknown) player.incomplete = true;
        player.unknown = Math.max(0, player.unknown - deficit);
        this.sync();
      }
    }
    hiddenSteal(name, victimName) {
      const thief = this.player(name), victim = victimName ? this.player(victimName) : null;
      if (thief === victim) { thief.incomplete = true; this.sync(); return; }
      if (this.worlds) {
        if (victim && !victim.incomplete && !this.worlds.some(world => world[victim.index].some(n => n > 0))) victim.incomplete = true;
        const outcomes = [];
        for (const world of this.worlds) for (let i = 0; i < RESOURCES.length; i++) {
          if (victim && !victim.incomplete && world[victim.index][i] === 0) continue;
          const next = copyWorld(world);
          next[thief.index][i]++;
          if (victim) next[victim.index][i] = Math.max(0, next[victim.index][i] - 1);
          outcomes.push(next);
        }
        this.replaceWorlds(outcomes);
      } else {
        const possible = victim ? RESOURCES.filter(r => victim.resources[r] > 0) : RESOURCES;
        if (victim && !victim.incomplete && victim.unknown === 0 && possible.length === 1) {
          const resource = possible[0];
          victim.resources[resource]--; thief.resources[resource]++;
        } else {
          thief.unknown++;
          if (victim) {
            const total = Object.values(victim.resources).reduce((a, b) => a + b, 0) + victim.unknown;
            if (!total) victim.incomplete = true;
            // Any known type may have been removed. Retain only cards guaranteed
            // to remain, and represent the rest as unknown cards.
            for (const r of RESOURCES) victim.resources[r] = Math.max(0, victim.resources[r] - 1);
            victim.unknown = Math.max(0, total - 1 - Object.values(victim.resources).reduce((a, b) => a + b, 0));
          }
        }
        this.sync();
      }
    }
    apply(event) {
      if (!event) return false;
      if (event.type === "start") {
        this.players.clear(); this.worlds = [[]]; this.inferenceLimited = false;
        this.started = false; this.events = 0; return true;
      }
      event = { ...event, player: this.resolveName(event.player), victim: this.resolveName(event.victim), partner: this.resolveName(event.partner) };
      const player = this.player(event.player);
      switch (event.type) {
        case "roll":
          this.started = true;
          for (const p of this.players.values()) p.freeRoads = 0;
          break;
        case "gain": this.change(event.player, event.resources, 1); break;
        case "loss": this.change(event.player, event.resources, -1); break;
        case "build": {
          const opening = !this.started && ["road", "settlement"].includes(event.item) && player.placements[event.item] < 2;
          if (opening) player.placements[event.item]++;
          if (event.item === "road" && player.freeRoads > 0) player.freeRoads--;
          else if (!event.free && !opening) this.change(event.player, COSTS[event.item], -1);
          break;
        }
        case "free-roads": player.freeRoads = 2; break;
        case "trade":
          this.change(event.player, event.give, -1); this.change(event.player, event.receive, 1);
          if (event.partner) { this.change(event.partner, event.give, 1); this.change(event.partner, event.receive, -1); }
          break;
        case "steal":
          if (Object.keys(event.resources).length && event.victim) {
            this.change(event.player, event.resources, 1); this.change(event.victim, event.resources, -1);
          } else this.hiddenSteal(event.player, event.victim);
          break;
        case "unknown-all": for (const p of this.players.values()) p.incomplete = true; break;
        case "unknown": player.incomplete = true; break;
        default: return false;
      }
      this.sync();
      this.events++;
      return true;
    }
  }
  const api = { RESOURCES, COSTS, Tracker, parse, resources, resourceName, textFromNode };
  root.CatanTrack = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
