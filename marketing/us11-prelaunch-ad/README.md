# Through the Wall · US11 pre-launch Meta ad

All assets and output stay in this folder. The production build does not copy `marketing/`.

## Render

From this folder, run `npm install`, then `npm run setup` once if Playwright Chromium is not already installed. Render the reviewed version of both cuts with:

```sh
TTW_RENDERER=canvas npm run render
```

If `vo-15s.m4a` or `vo-6s.m4a` is present here, the same command also writes a voiceover version for that cut. Audio is AAC and padded or trimmed to match the video's exact duration. The silent MP4s remain available.

`timeline.json` contains every beat and caption interval. Adjust times there when the recorded voiceover timestamps arrive, then run `TTW_RENDERER=canvas npm run render` again. The renderer can use Playwright Chromium when available (`npm run render`). In this restricted macOS environment, Chromium could not start, so the reviewed deliverables were made with `canvas-frame.mjs`, which reads the same timeline. Set `TTW_RENDERER=canvas` to reproduce that look exactly. The local Playfair Display and Inter font files make that fallback deterministic; `ad.html` also loads the fonts from Google Fonts as the app does.

## Approved voiceover copy

**15 seconds:** “Love Is Blind Boston drops October 14th. Think you can pick the couples? So prove it. Make your picks in this free prediction game. Engagements, weddings, breakups. Play solo or bring your group chat. throughthewall.ca”

**6 seconds:** “Love Is Blind Boston drops October 14th. Think you can pick the couples? Prove it. throughthewall.ca”

The on-screen captions use short phrases from the approved message to stay readable on mute. The “Example” badge stays visible throughout the prediction demo. The demo uses Zack and Bliss from a previous season. Scores and other names in the mock UI are illustrative.

The question cards use the approved inward-facing profile artwork in `profile-silhouettes.png`. Both renderers use that same asset.
