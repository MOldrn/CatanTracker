# CatanTracker

A Chrome extension that tracks each player's resources on [Colonist.io](https://colonist.io) using the game log.

## Features

- Tracks resource gains, purchases, trades, and discards.
- Handles Monopoly transfers across all players, using the reported total to narrow down unknown hands.
- Shows hidden stolen cards as `?` and uses later actions to work out their types.
- Links `You` in the log to your entered username.
- Resizable, draggable panel with resource icons, game-colored player names, and editable counts.
- Secondary Dice tab with a distribution graph, hover details, recent rolls, and a highlighted count of 7s.

## Installation

1. Download or clone this repository.
2. Open `chrome://extensions` and enable **Developer mode**.
3. Click **Load unpacked** and select the `extension` folder.
4. Refresh Colonist.io and enter your in-game username in the tracker.

Use the English game log and start tracking before the opening placements. After updating the extension, reload it in Chrome and refresh the game tab.

## Usage

Drag the header to move the tracker or its bottom-right corner to resize it. Text and icons scale with the width. Click **−** to collapse it, or **⋯** for controls, including **Reset panel size**. Hover resource icons for their names and edit a number to correct a count.

**Resources** is the default view. Switch to **Dice** for counts of 2–12, percentages on hover, and a dashed reference for two fair dice. Dice history includes observed rolls only; unreadable rolls are flagged and excluded from the graph. Clearing resource counts keeps dice history. A new game or page refresh resets it.

`?` cards have unknown types. `!` marks a hand that may be incomplete. Counts aren't saved across page refreshes, and some game events or modes may not be supported yet.

If something goes wrong, use **⋯ → Export debug report** before refreshing. The report includes player names and observed game activity, so check it before sharing.

## Development

Requires Node.js 24 or newer.

```sh
npm ci --ignore-scripts
npm test
```

The extension itself has no runtime dependencies or build step.
