# CatanTracker

A Chrome extension that tracks each player's resources on [Colonist.io](https://colonist.io) using the game log.

## Features

- Tracks resource gains, purchases, trades, and discards.
- Shows hidden stolen cards as `?` and uses later actions to work out their types.
- Links `You` in the log to your entered username.
- Compact, draggable panel with resource icons and editable counts.

## Installation

1. Download or clone this repository.
2. Open `chrome://extensions` and enable **Developer mode**.
3. Click **Load unpacked** and select the `extension` folder.
4. Refresh Colonist.io and enter your in-game username in the tracker.

Use the English game log and start tracking before the opening placements. After updating the extension, reload it in Chrome and refresh the game tab.

## Usage

Drag the header to move the tracker, click **−** to collapse it, or **⋯** for controls. Hover resource icons for their names and edit a number to correct a count.

`?` cards have unknown types. `!` marks a hand that may be incomplete. Counts aren't saved across page refreshes, and some game events or modes may not be supported yet.

If something goes wrong, use **⋯ → Export debug report** before refreshing. The report includes player names and observed game activity, so check it before sharing.

## Development

Requires Node.js 24 or newer.

```sh
npm ci --ignore-scripts
npm test
```

The extension itself has no runtime dependencies or build step.
