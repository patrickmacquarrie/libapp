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
| Meta ads (all) | `https://throughthewall.ca/?acquisition_source=paid_meta&utm_source=meta&utm_medium=paid_social&utm_campaign=us11_prelaunch&utm_content=creative_name` |
| Instagram bio | `https://throughthewall.ca/?acquisition_source=organic_instagram_bio` |
| Instagram stories | `https://throughthewall.ca/?acquisition_source=organic_instagram_story` |
| Organic Facebook posts | `https://throughthewall.ca/?acquisition_source=organic_facebook` |
| TikTok bio (if used) | `https://throughthewall.ca/?acquisition_source=organic_tiktok` |
| Reddit / forums (if used) | `https://throughthewall.ca/?acquisition_source=organic_reddit` |

In Meta Ads Manager, set the website URL to `https://throughthewall.ca/` (or `https://throughthewall.ca/welcome/` for the explainer page). Put the parameters after `?` from the Meta row above in the ad's **URL parameters** field, without the leading `?`. Replace `creative_name` with a distinct label for each ad. Keep `utm_campaign` equal to the campaign name in Meta Ads Manager; if you use a different value, add a campaign mapping in PostHog Marketing Analytics. In PostHog, map `utm_source=meta` to the Meta Ads source. Do not also append these parameters to the website URL, which would create duplicate keys.

The shared `analytics.js` entry point saves the first tagged visit. The welcome page carries the same parameters into the app without replacing that first touch. Check a fresh private browser when testing: an existing `through-the-wall-acquisition` value represents an earlier visit. Organic Meta clicks carrying only `fbclid` can be counted as `paid_meta`, so keep explicit `acquisition_source` tags on organic posts and bio links.

To see spend alongside conversions, connect the Meta Ads account under PostHog **Data pipelines → New source → Meta Ads** and sync `campaigns` plus `campaign_stats`. In **Marketing Analytics**, `meta` is already a default Meta source and campaign-name matching is the default. The configured goals are `account_created` (completed signup/customer) and `global_pool_joined` (pool joined). PostHog's campaign cost matching depends on the `utm_campaign` value matching the Meta campaign name exactly. The Meta pixel is separate: it sends `CompleteRegistration` for signups, `PoolJoined` for joins, and `PoolCreated` for pool creation. Choose the relevant event as the Meta ad set's conversion event after it first appears in Events Manager.

## Using the Meta pixel

Use PostHog's `paid_meta` numbers as the source of truth for budget decisions. Meta sees only visitors who choose **Allow**, and it never receives joins that arrive through invite links, so its counts will run low. In PostHog, calculate the allow rate as `meta_choice_made` events with `choice=allow` divided by `meta_choice_shown` events, using the same date range and placement.

Start the campaign optimizing for **link clicks**, which does not depend on the pixel. Once `CompleteRegistration` appears in Events Manager, compare Meta's weekly signup count with PostHog's. Switch the ad set to optimize for signups only if Meta receives a healthy weekly volume (about 50 optimization events per ad set per week is Meta's rule of thumb); otherwise keep link-click optimization and use the pixel for reporting. Before premiere weekend, do not change the optimization event within 48 hours of the October 14 episode drop.

## Known limits during the season

- `MAIL_PROJECT_DAILY_LIMIT` is 1,500 emails per UTC day, shared by invitations and nudges. Over the cap, nudges are skipped with a `console.warn` beginning `Daily mail ceiling skipped`, while invitations return `Email invitations are paused for today.` The day resets at 00:00 UTC: 6 p.m. in Edmonton during MDT and 5 p.m. after November 1. Check Logs Explorer for that warning after each episode drop. Raising the cap is a Functions change, so plan it for after launch week if needed.
- Global Pool joins all update `pools/global__love-is-blind-us-11` in a transaction. Bursts of several joins per second can surface `The Global Pool is busy right now.` Watch `clientErrors` for `global_join_failed` during ad spikes. `GLOBAL_JOIN_CEILING` is 8,000.
- Google Cloud trial credit ends October 30, 2026. The CA$15 budget sends alerts only.
