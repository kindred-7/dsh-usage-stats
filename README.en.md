# DSH Usage Stats (dsh-usage-stats)

English | [中文](README.md)

Usage statistics plugin for DSH web: adds a **Usage Statistics** section to Settings — cumulative/peak tokens, daily streaks, a 1-year activity heatmap, and per-model usage line charts.

## Features

- **Stat cards**: row 1 — cumulative tokens / single-day peak / today; row 2 — current streak / longest streak
- **1-year activity heatmap** (GitHub contribution graph style)
  - SVG that scales to container width: a full year on screen, no horizontal scrolling
  - Month labels on the x-axis (at each month start, with automatic overlap guard)
  - Inactive days render as gray cells; light/dark theme aware
  - Hover a cell for a "date · usage" tooltip (matches the native DSH Tooltip look)
- **Per-model usage line chart** (7 / 30 / 90 day ranges)
  - One line per model, with dots on days that had usage
  - Hover for that day's per-model breakdown (date + tokens per model), same native-style tooltip
- Light/dark theme aware · respects reduced motion

## Install

```powershell
dsh plugin --profile web add @kindred7/dsh-usage-stats
dsh web    # restart to take effect
```

Install a pinned version from GitHub:

```powershell
dsh plugin --profile web add github:kindred-7/dsh-usage-stats#v0.2.0
```

Uninstall:

```powershell
dsh plugin --profile web remove @kindred7/dsh-usage-stats
```

After installing, hard-refresh the browser once (**Ctrl+F5**) so it picks up the new plugin script.

## Data model & privacy

- Token count = provider-reported usage per assistant reply (input + output + cache read + cache write; reasoning tokens are already included in output, not double-counted)
- Model attribution uses the `source.model` recorded in the request log; switching models mid-session bills each request to its own model
- All data stays in browser localStorage (key `dsh-usage-stats/ledger/v1`) — nothing is uploaded
- The ledger advances per-session watermarks: opening a session backfills its full usage by reconciling against the host log (history included)

## How it works

| Slot | Role |
|---|---|
| `conversation.composer.dock` | Invisible collector (renders null): watches the session snapshot and triggers a host-log reconciliation |
| `settings.section` | The "Usage Statistics" settings page |

Reconciliation pages backwards through the full log via the `session.history` RPC, folding every `assistant/message` event (usage / time / `source.model`) with the event seq as a watermark. Unreadable logs (corrupt/offline) are skipped silently and retried on the next trigger.

## Development

```powershell
node --check lib/client.js     # syntax check
node tests/harness.cjs         # ledger fold logic tests
```

`lib/client.js` is the browser-side plugin; `register.js` adds it to the profile's boot manifest; `cordis.patch.yml` declares the host-side assembly. The install location under `.dsh/profiles/web/node_modules` is a junction to this directory, so edits take effect immediately.

## License

MIT
