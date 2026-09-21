# Batch D notes

## What changed

- US Season 11 is registered as the upcoming public-beta season with its approved source Sheet ID, but remains unavailable. Publishing/runtime configuration can activate it only after the Sheet is connected and reviewed.
- The checked-in `DEFAULT_SEASON_ID` remains UK3 until the explicit cut-over. UK3's season-bank entry is now a completed historical friends-test season; its existing season document, pools, and legacy configuration version were not changed.
- The backend no longer guesses UK3 when `appConfig/public.globalPoolSeasonId` is missing. It now stops with `failed-precondition: The Global Pool season is not configured`.
- Email replies now use `support@throughthewall.ca` instead of a personal Gmail address.
- The Chemistry Preview and welcome-page copy no longer present UK3 or its old release date as current.
- The launch runbook now documents the ordered US11 publish, runtime cut-over, deployment, and first-administrator-open procedure, including configuration-v2 score gating and frozen-score correction handling.

## What was tested

- `npm run test:release-contract` passed with executable checks for the missing-runtime-config failure, the UK3 historical state, the approved but unavailable US11 registration, and activation through published runtime configuration.
- `npm run test:engine` and `npm run test:operations` passed.
- `node --check functions/index.js` and `git diff --check` passed.
- The production build completed successfully. Generated season-page cache churn was excluded from the branch.

## Still required

- Patrick must connect the approved US11 source Sheet through Season Admin before cut-over. Recording its ID in the repository does not modify the private Apps Script allow-list or publish it.
- Do not change `appConfig/public` to US11 until the reviewed US11 snapshot is published with `CONFIG_VERSION=2` and the release window begins.
- Configure Resend inbound handling or a forwarding rule for `support@throughthewall.ca`, then send a real reply test before public invitations are enabled.
- Follow the new first-open runbook step with the administrator account after the reviewed backend is deployed. This branch does not deploy or modify production data.
