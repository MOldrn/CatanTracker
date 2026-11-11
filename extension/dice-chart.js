(function (root) {
  "use strict";
  function create(parent) {
    const document = parent.ownerDocument;
    function el(tag, text, container, className) {
      const node = document.createElement(tag);
      if (text !== undefined) node.textContent = text;
      if (className) node.className = className;
      container.append(node); return node;
    }
    function svg(tag, attributes, container, text) {
      const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
      for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
      if (text !== undefined) node.textContent = text;
      container.append(node); return node;
    }
    const style = el("style", undefined, parent);
    style.textContent = `
      .dice-summary{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin:8px 0}
      .dice-stat{background:#20352a;border:1px solid #344a3b;border-radius:6px;padding:6px 8px}
      .dice-stat span{display:block;color:#a9bdae;font-size:9px}.dice-stat strong{font-size:1.4em;font-weight:600;font-variant-numeric:tabular-nums}
      .dice-stat:last-child strong{color:#edc875}.dice-heading{display:flex;justify-content:space-between;align-items:center;margin-top:10px;font-size:10px;color:#c7d8ca}
      .dice-heading small{font-size:9px;color:#91aa98}.dice-chart{display:block;width:100%;height:auto;overflow:visible}
      .dice-chart text{font-family:system-ui,sans-serif;font-variant-numeric:tabular-nums}.dice-grid{stroke:#344a3b;stroke-dasharray:2 3}
      .dice-axis{fill:#91aa98;font-size:8px}.dice-count{fill:#d5e6d6;font-size:9px;font-weight:600}.dice-count.zero{fill:#5c7464}
      .dice-label{fill:#a9c1af;font-size:10px}.dice-label.seven{fill:#edc875;font-weight:700}
      .dice-reference{fill:none;stroke:#a0bba6;stroke-width:1.5;stroke-dasharray:4 3;pointer-events:none}
      .dice-column:hover .dice-bar{filter:brightness(1.3)}.dice-recent{display:flex;align-items:center;gap:3px;margin:7px 0;overflow:auto;scrollbar-width:thin}
      .dice-recent-label{font-size:9px;color:#91aa98;margin-right:3px;white-space:nowrap}
      .dice-chip{min-width:18px;padding:3px 2px;background:#243b2c;border:1px solid #395442;border-radius:4px;text-align:center;font-size:10px;font-variant-numeric:tabular-nums}
      .dice-chip.seven{background:#443b26;border-color:#846b37;color:#edc875}.dice-chip:last-child{border-color:#9cba8a}
      .dice-note{font-size:9px;color:#91aa98;line-height:1.4;margin:5px 0 2px}.dice-empty{color:#c8d7bc;font-size:10px;margin:8px 0}
    `;
    const summary = el("div", undefined, parent, "dice-summary");
    const values = {};
    for (const [key, label] of [["total", "Tracked rolls"], ["last", "Last roll"], ["sevens", "7s rolled"]]) {
      const card = el("div", undefined, summary, "dice-stat");
      el("span", label, card); values[key] = el("strong", "–", card);
      values[key].setAttribute("data-dice-stat", key);
    }
    const heading = el("div", undefined, parent, "dice-heading");
    el("span", "Roll distribution", heading); el("small", "Hover a bar for details", heading);
    const chart = svg("svg", { viewBox: "0 0 320 174", role: "img", class: "dice-chart" }, parent);
    const empty = el("p", "No readable rolls yet. Keep the game log open.", parent, "dice-empty");
    const recent = el("div", undefined, parent, "dice-recent");
    const note = el("p", undefined, parent, "dice-note");
    function render(stats) {
      values.total.textContent = stats.total;
      values.last.textContent = stats.recent.length ? stats.last ?? "?" : "–";
      values.sevens.textContent = stats.counts[7];
      empty.hidden = stats.total > 0;
      chart.replaceChildren();
      const sums = Array.from({ length: 11 }, (_, i) => i + 2);
      const expected = sum => stats.total * (6 - Math.abs(7 - sum)) / 36;
      const step = Math.max(1, Math.ceil(Math.max(...sums.map(sum => Math.max(stats.counts[sum], expected(sum)))) / 4));
      const maximum = step * 4, baseline = 144, plotHeight = 128, bin = 26;
      const x = sum => 24 + (sum - 2) * bin + bin / 2;
      const y = count => baseline - plotHeight * count / maximum;
      chart.setAttribute("aria-label", `Dice distribution over ${stats.total} readable rolls. ${sums.map(sum => `${sum}: ${stats.counts[sum]}`).join(", ")}.`);
      const defs = svg("defs", {}, chart);
      for (const [id, top, bottom] of [["dice-green", "#b8d88e", "#477253"], ["dice-gold", "#f4d58c", "#a77d35"]]) {
        const gradient = svg("linearGradient", { id, x1: "0", y1: "0", x2: "0", y2: "1" }, defs);
        svg("stop", { offset: "0%", "stop-color": top }, gradient);
        svg("stop", { offset: "100%", "stop-color": bottom }, gradient);
      }
      for (let tick = 0; tick <= maximum; tick += step) {
        svg("line", { x1: 24, y1: y(tick), x2: 310, y2: y(tick), class: "dice-grid" }, chart);
        svg("text", { x: 18, y: y(tick) + 3, "text-anchor": "end", class: "dice-axis" }, chart, tick);
      }
      svg("polyline", { points: sums.map(sum => `${x(sum)},${y(expected(sum))}`).join(" "), class: "dice-reference" }, chart);
      for (const sum of sums) {
        const count = stats.counts[sum], height = plotHeight * count / maximum;
        const group = svg("g", { class: "dice-column", "data-sum": sum, "data-count": count }, chart);
        const percentage = stats.total ? (100 * count / stats.total).toFixed(1) : "0.0";
        svg("title", {}, group, `${sum}: ${count} roll${count === 1 ? "" : "s"} (${percentage}%). Fair-dice reference: ${expected(sum).toFixed(1)}.`);
        svg("rect", { x: x(sum) - 8, y: count ? y(count) : baseline - 1, width: 16, height: count ? height : 1, rx: 3, fill: `url(#${sum === 7 ? "dice-gold" : "dice-green"})`, class: "dice-bar" }, group);
        svg("text", { x: x(sum), y: y(count) - 5, "text-anchor": "middle", class: `dice-count${count ? "" : " zero"}` }, group, count);
        svg("text", { x: x(sum), y: 161, "text-anchor": "middle", class: `dice-label${sum === 7 ? " seven" : ""}` }, group, sum);
        svg("rect", { x: x(sum) - 12, y: 12, width: 24, height: 152, fill: "transparent" }, group);
      }
      recent.replaceChildren();
      recent.hidden = !stats.recent.length;
      el("span", "Recent", recent, "dice-recent-label");
      for (const sum of stats.recent) el("span", sum ?? "?", recent, `dice-chip${sum === 7 ? " seven" : ""}`);
      note.textContent = "Dashed line: two fair dice reference. Counts include only observed game-log rolls." + (stats.unreadable ? ` ${stats.unreadable} unreadable roll${stats.unreadable === 1 ? "" : "s"} excluded.` : "");
    }
    return { render };
  }
  root.CatanTrackDiceView = { create };
})(globalThis);
