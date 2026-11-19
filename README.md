# IT Updates

Cross-platform (macOS / Windows / Linux) Electron tray app that watches ~55 curated sources and the NVD
CVE API for news about **PHP, nginx, JavaScript, Node.js, TypeScript, web hosting and the web platform**.
It classifies every item by **urgency** (critical / high / normal / info) and **topic**.

- **Channels**: sidebar filters by urgency, topic, source, unread, and *Needs acknowledgement*. They can be
  combined with the "minimum urgency" dropdown and search (e.g. *Topic: PHP* + *High +*).
- **Urgent alerts**: when a fresh item reaches the alert threshold (default: `critical`), you get a native
  notification plus an always-on-top window. That window **cannot be closed until every item is
  acknowledged**. It also re-appears every 15 min (and after screen unlock) while anything is still pending.
- Acknowledging a CVE also clears other pending alerts that are only about the same CVE.
- Runs in the tray / menu bar; the tray icon turns red with a counter while alerts are pending.
- Optional start at login (tray menu → *Start at login*).

See **[FEEDS.md](FEEDS.md)** for the curated source list and how urgency is assigned.

## Install / run

Requires Node.js ≥ 20.

```bash
npm install
npm start                # run from source
```

Build an installable app:

```bash
npm run dist:mac         # → dist/IT Updates-1.0.0-arm64.dmg (+ .zip)
npm run dist:win         # → NSIS installer
npm run dist:linux       # → AppImage
```

The macOS build is unsigned. A build you made yourself opens normally. If you copy it to another Mac,
right-click → *Open* the first time, or run `xattr -dr com.apple.quarantine "/Applications/IT Updates.app"`.

macOS: on first start, allow notifications for *IT Updates*. For best results, open System Settings →
Notifications → IT Updates and set the style to **Persistent** (the on-top window appears regardless).

## Configuration

On first start the bundled `config/default-config.json` is copied to:

| OS | Path |
|---|---|
| macOS | `~/Library/Application Support/IT Updates/config.json` |
| Windows | `%APPDATA%\IT Updates\config.json` |
| Linux | `~/.config/IT Updates/config.json` |

Open it via the *Sources & rules* button or the tray menu. Changes are picked up automatically when you save.

| Key | Meaning |
|---|---|
| `refreshMinutes` | Poll interval for RSS sources (default 15). |
| `alerts.minUrgency` | `critical` (default) or `high` — what triggers the must-acknowledge alert. |
| `alerts.maxAgeHours` | Items older than this never raise an alert (avoids a flood on first start). |
| `alerts.renagMinutes` | Re-show the alert window while items are pending (0 = off). |
| `nvd.apiKey` | Free key from <https://nvd.nist.gov/developers/request-an-api-key> makes NVD polling ~8× faster. |
| `nvd.keywords` | Products queried in the NVD. |
| `topics` / `topicKeywords` | Topic channels and the words that put an item into them. |
| `criticalPatterns` / `highPatterns` | Regexes (case-insensitive) that raise urgency when a relevant item matches. |
| `noisePatterns` | Regexes that force an item to *info*, e.g. WordPress plugins, SourceCodester demo apps, routers. |
| `sources[]` | `url`, `topics`, `kind`, `urgency` (base), `maxUrgency` (cap), `requireTopicMatch` (headline filter), `enabled`. Types: `rss` (default, also Atom/RDF), `kev`, `nvd`. |

How urgency is decided, in order:

1. The source's base `urgency`. For NVD it comes from the CVSS score (≥9 critical, ≥7 high, ≥4 normal); for
   KEV it is critical when the product matches one of your topics.
2. Raised to *critical* / *high* if the text matches `criticalPatterns` / `highPatterns` **and** the item is
   relevant (dedicated source, or one of your topic keywords appears).
3. Forced to *info* by `noisePatterns`. Capped by the source's `maxUrgency`. Mailing-list replies (`Re:`)
   are capped at *high*.

The reason is shown under each item ("Why Critical: matched "actively exploited"").

Tune it with the headless dry run, which fetches everything once and prints what would be classified and alerted:

```bash
npm run dry-run                       # add -- --no-nvd to skip the slow NVD queries
```

State (items, read/ack flags) lives in `state.json` next to `config.json`.

## Keyboard

`j`/`k` or ↑/↓ move · `o`/Enter open in browser · `a` acknowledge · `m` toggle read · ⌘/Ctrl-R refresh · ⌘/Ctrl-F search

## Why not an existing app?

Using a plain feed reader is fine for *reading*. Import [`feeds.opml`](feeds.opml) into
**NetNewsWire** (free, macOS), Reeder, Feedly or Inoreader. None of them combine all of the following out of
the box, which is why this app exists:

- keyword- and CVSS-based urgency scoring across sources
- NVD and CISA KEV (JSON APIs, not RSS)
- alerts that stay on screen until acknowledged

Inoreader (Pro) and Feedly (Pro+/Threat Intelligence) come closest with rules and push notifications, but
their notifications disappear on their own and they are paid services.
