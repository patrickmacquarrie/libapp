# PostHog beta setup and verification

The browser integration is built for PostHog EU Cloud and stays disabled in ordinary local builds. Plausible remains enabled in parallel. Complete this runbook before releasing the beta.

## One-time PostHog setup

1. Create the Through the Wall project in PostHog EU Cloud (`https://eu.posthog.com`). Copy its public project token from Project settings.
2. In the GitHub production environment, create `POSTHOG_PROJECT_TOKEN` as an environment variable containing that `phc_...` token. Set `POSTHOG_HOST` to `https://eu.i.posthog.com`, or leave it unset to use the same EU default.
   Keep PostHog's project-level **Discard client IP data** setting enabled. The client also sends `$geoip_disable: true` so product events and feature-flag requests are not enriched with city, postal-code, latitude, or longitude properties.
3. Enable Session Replay for the project. Set sampling to about 50% and the minimum recording duration to about 5 seconds. Keep the project’s default recording retention unless a shorter beta-specific retention period is required; the client masks form inputs, rendered text, URL query strings, and blocks the prediction, standings, Heat Check, settings, invitation, and user-created pool regions with PostHog’s supported `ph-no-capture` control. Do not remove those classes without re-running the replay privacy check below.
4. Create a multivariate feature flag named `price_variant`. Give variants `a` and `c` equal rollout percentages. The app maps them to `$4.99` and `$12.99` respectively. Enable persistence across authentication so the same identified owner keeps the same price. Keep the PostHog description aligned with these prices, and do not enable another variant without adding its price to `analytics.js`.
5. Under **Filter out internal and test users**, add a `distinct_id` filter matching the Firebase UIDs for your own and test accounts, then enable the filter on all new insights.
6. The beta lifecycle event list includes `app_arrival`, `sign_in_completed`, `account_created`, `pool_created`, `invite_sent`, `invite_link_opened`, `invite_accepted`, `global_pool_joined`, `episode_return`, `first_checkpoint_locked`, `return_visit`, `notif_opt_in`, `price_prompt_shown`, and `price_response`.
7. Create the invite funnel using these ordered events: `app_arrival`, `sign_in_completed`, `account_created`, `pool_created`, `invite_sent`, and `invite_accepted`. Add `acquisition_source` as a breakdown. Use `invite_link_opened` as a diagnostic step or a second funnel between `invite_sent` and sign-in. Rebuild this funnel after the acquisition and account-creation instrumentation is deployed.
8. Create retention views from `sign_in_completed`, `episode_return`, `first_checkpoint_locked`, and `return_visit`. `first_checkpoint_locked` fires on the first phase a player locks in each pool, including players who join after Pods. Replace any pricing view that uses the retired `price_fakedoor_click` or `founding_email_captured` events. Use `price_prompt_shown` as the denominator, then break `price_response` down by the displayed `price`, `response`, and `member_count`; keep `price_variant` as a diagnostic breakdown. Count only each identified person’s earliest `price_response`, including `dismissed`; browser storage suppresses ordinary repeats on one device but is not the deduplication source of truth across devices. Calculate the yes rate as `yes / (yes + maybe + no)`, excluding `dismissed`, and report dismissals separately as a share of `price_prompt_shown`.

The production deployment deliberately fails if `POSTHOG_PROJECT_TOKEN` is missing. The project token is public; the gate exists to prevent an uninstrumented beta release, not to treat it as a secret.

## Release verification

- Open PostHog Activity and click through the app. Confirm custom events arrive and include `app_build` and `acquisition_source`.
- Open a fresh private window with an invitation URL. Confirm `invite_link_opened` and `app_arrival` are anonymous, sign in with Google, and verify those events, `sign_in_completed`, and `account_created` appear on one person whose distinct ID is the Firebase UID and whose `acquisition_source` is `invite`.
- From the Instagram app, open your own ad preview link, use email-link sign-in, and confirm the resulting PostHog person has `acquisition_source = paid_meta` after the link opens in Safari or Chrome.
- Send one email invitation and copy one pool link. Confirm `invite_sent` shows `channel=email` and `channel=link`, with the correct `poolId` and `count`.
- Enable one email nudge and confirm `notif_opt_in` contains the full enabled `types` array.
- As the owner of a private pool for the configured live/default season, complete the first locked checkpoint. Confirm the pricing card appears only after completion, shows one price without flashing another, states that the current pool stays free, and offers Yes, Maybe, No, and a dismiss button. Confirm `price_prompt_shown` fires only when the card is rendered and that `price_response` contains the same `price_variant`, displayed `price`, current `member_count`, and selected `response` (including `dismissed`). Confirm a Global Pool player and a non-owner do not see the card, and that the same owner is not prompted after completing a checkpoint in a second private pool on the same device.
- Watch one of your own session replays. Confirm sign-in inputs are masked and account names, email destinations, invitation addresses, contestant names, predictions, standings, Heat Check scores, and accessibility labels are unreadable. The blocked in-app regions should appear as blank placeholders. Inspect the replay's element details as well as the visible page; a masked screen with readable attributes is a release failure.
- Check the browser console on `/`, `/privacy.html`, `/terms.html`, `/welcome/`, and one `/seasons/.../` page. There must be no CSP violations.
- Confirm the same actions still arrive in Plausible.
- Confirm the app emits neither PostHog's automatic pageview nor a manual `/app/checking` or `/app/loading` pageview. These transient app pageviews are intentionally suppressed.

The direct PostHog host can be blocked by content blockers. That expected loss is accepted for the first release; the optional first-party `/ingest/` proxy is a separate fast-follow and is not part of milestone 0.3.
