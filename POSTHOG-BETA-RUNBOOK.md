# PostHog beta setup and verification

The browser integration is built for PostHog EU Cloud and stays disabled in ordinary local builds. Plausible remains enabled in parallel. Complete this runbook before releasing the beta.

## One-time PostHog setup

1. Create the Through the Wall project in PostHog EU Cloud (`https://eu.posthog.com`). Copy its public project token from Project settings.
2. In the GitHub production environment, create `POSTHOG_PROJECT_TOKEN` as an environment variable containing that `phc_...` token. Set `POSTHOG_HOST` to `https://eu.i.posthog.com`, or leave it unset to use the same EU default.
3. Enable Session Replay for the project. Keep the project’s default recording retention unless a shorter beta-specific retention period is required; the client already masks form inputs, rendered text, sensitive elements, and URL query strings.
4. Create a multivariate feature flag named `price_variant`. Give variants `a`, `b`, and `c` equal rollout percentages. The app maps them to `$7.99`, `$9.99`, and `$12.99` respectively. Do not enable a fourth variant without adding its price to `analytics.js`.
5. Create the invite funnel using these ordered events: `app_arrival`, `sign_in_completed`, `pool_created`, `invite_sent`, and `invite_accepted`. Add `acquisition_source` as a breakdown. Use `invite_link_opened` as a diagnostic step or a second funnel between `invite_sent` and sign-in.
6. Create retention views from `sign_in_completed`, `episode_return`, `first_checkpoint_locked`, and `return_visit`. Create a pricing view broken down by `price_variant` for `price_fakedoor_click` and `founding_email_captured`.

The production deployment deliberately fails if `POSTHOG_PROJECT_TOKEN` is missing. The project token is public; the gate exists to prevent an uninstrumented beta release, not to treat it as a secret.

## Release verification

- Open PostHog Activity and click through the app. Confirm custom events arrive and include `app_build` and `acquisition_source`.
- Open a fresh private window with an invitation URL. Confirm `invite_link_opened` and `app_arrival` are anonymous, sign in, and verify those events and `sign_in_completed` appear on one person whose distinct ID is the Firebase UID.
- Send one email invitation and copy one pool link. Confirm `invite_sent` shows `channel=email` and `channel=link`, with the correct `poolId` and `count`.
- Enable one email nudge and confirm `notif_opt_in` contains the full enabled `types` array.
- Open Settings after flags load. Confirm the premium card shows one price without flashing another, and that both pricing events contain the same `price_variant`.
- Watch one of your own session replays. Confirm sign-in inputs are masked and account names, email destinations, and invitation addresses render as blocked regions.
- Check the browser console on `/`, `/privacy.html`, `/terms.html`, `/welcome/`, and one `/seasons/.../` page. There must be no CSP violations.
- Confirm the same actions still arrive in Plausible.

The direct PostHog host can be blocked by content blockers. That expected loss is accepted for the first release; the optional first-party `/ingest/` proxy is a separate fast-follow and is not part of milestone 0.3.
