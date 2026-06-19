# CREDITOS Cross-Device QA

Use two browsers or two devices signed into the same user.

## Simple launch board

Legend:

- done = implemented and verified locally
- blocked by credentials = needs live Supabase auth / second device
- blocked by schema/config = needs production sync tables or redirects

| Area | Status | Notes |
|---|---|---|
| Session persistence | blocked by credentials | Needs two live browsers/devices with a real Supabase user. |
| Cloud sync | blocked by schema/config | Depends on the production sync tables being live. |
| Local fallback | done | Device-only caching is already safe. |
| Settings / preferences | done | The UI already supports syncing these fields. |

## Live credential checks

- [ ] PASS - Cross-device session persistence survives logout/login.
- [ ] PASS - Data entered on device A appears on device B after sign-in.
- [ ] PASS - Onboarding profile, badges, wins, vault, actions, disputes, and preferences sync.
- [ ] BLOCKED - a second browser or device with live Supabase auth is not available yet.

## Sync checks

- [ ] Complete onboarding on device A.
- [ ] Sign in on device B.
- [ ] Confirm onboarding profile syncs.
- [ ] Confirm badges sync.
- [ ] Confirm wins sync.
- [ ] Confirm funding vault syncs.
- [ ] Confirm action progress syncs.
- [ ] Confirm business profile syncs.
- [ ] Confirm check-ins sync.
- [ ] Confirm dispute progress syncs.
- [ ] Confirm funding plan progress syncs.
- [ ] Confirm scanner result metadata syncs.
- [ ] Confirm user settings and preferences sync.

## Source-of-truth checks

- [ ] Confirm `localStorage` is only a fallback cache.
- [ ] Confirm logout/login does not destroy cloud progress.
- [ ] Confirm the same data appears on a second device after refresh.
- [ ] Confirm a session on one browser does not block another browser.

## Manual evidence to capture

- [ ] Screenshot of device A after onboarding.
- [ ] Screenshot of device B after sync.
- [ ] Screenshot of the cloud-sync status in settings.
