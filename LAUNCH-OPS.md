# Launch operations

## Username moderation

There is no username filter. Global standings show usernames to every player. To rename an offensive username for a user `{uid}`:

1. In the Firestore console, open `users/{uid}` and set `username` to a neutral value such as `Player 4821`.
2. Open `pools/global__love-is-blind-us-11/trustedPlayers/{uid}` and set `username` to the same value. `recomputeGlobalStandings` reads the displayed standings name from this document.
3. For every pool the user belongs to, update `pools/{poolId}/players/{uid}` → `username`. Also update `pools/{poolId}/castRatings/{uid}` → `username` when that document has `shared: true`.
4. Trigger a standings rebuild. In `pools/global__love-is-blind-us-11/standings/rebuild`, change `reason` to `moderation` and update `requestedAt`. Any write to this document fires `rebuildGlobalStandings`.
5. Open Global standings in a private window and confirm that the new name appears.

## Link tagging

Acquisition uses first touch: `analytics.js` stores the first acquisition parameters in `localStorage` under `through-the-wall-acquisition`. An explicit `acquisition_source` takes priority over `fbclid`. Allowed values pass through `safeSlug` and must be `seed`, `invite`, `share_card`, `organic_*`, or `paid_*`.

| Placement | URL |
|---|---|
| Meta ads (all) | `https://throughthewall.ca/?acquisition_source=paid_meta&utm_campaign=us11_prelaunch` |
| Instagram bio | `https://throughthewall.ca/?acquisition_source=organic_instagram_bio` |
| Instagram stories | `https://throughthewall.ca/?acquisition_source=organic_instagram_story` |
| Organic Facebook posts | `https://throughthewall.ca/?acquisition_source=organic_facebook` |
| TikTok bio (if used) | `https://throughthewall.ca/?acquisition_source=organic_tiktok` |
| Reddit / forums (if used) | `https://throughthewall.ca/?acquisition_source=organic_reddit` |

Use `utm_content` to tell ad creatives apart. Without it, organic Meta clicks carrying only `fbclid` are counted as `paid_meta`.

## Known limits during the season

- `MAIL_PROJECT_DAILY_LIMIT` is 1,500 emails per UTC day, shared by invitations and nudges. Over the cap, nudges are skipped with a `console.warn` beginning `Daily mail ceiling skipped`, while invitations return `Email invitations are paused for today.` The day resets at 00:00 UTC: 6 p.m. in Edmonton during MDT and 5 p.m. after November 1. Check Logs Explorer for that warning after each episode drop. Raising the cap is a Functions change, so plan it for after launch week if needed.
- Global Pool joins all update `pools/global__love-is-blind-us-11` in a transaction. Bursts of several joins per second can surface `The Global Pool is busy right now.` Watch `clientErrors` for `global_join_failed` during ad spikes. `GLOBAL_JOIN_CEILING` is 8,000.
- Google Cloud trial credit ends October 30, 2026. The CA$15 budget sends alerts only.
