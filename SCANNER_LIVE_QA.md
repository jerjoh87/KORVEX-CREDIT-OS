# CREDITOS Scanner Live QA

Use real AI credentials and a real credit report sample with sensitive data removed.

## Simple launch board

Legend:

- done = implemented and verified locally
- blocked by credentials = needs live AI / OCR credentials
- blocked by schema/config = needs Supabase or production env wiring

| Area | Status | Notes |
|---|---|---|
| Gemini report scan | blocked by credentials | Needs a live Gemini key in the production environment. |
| OCR fallback | done | Browser OCR is already wired and works locally. |
| Upload handling | done | TXT/PDF/PNG/JPG paths are in place. |
| Scanner metadata save | blocked by schema/config | Depends on live Supabase persistence. |

## Live credential checks

- [ ] PASS - Gemini/OCR scanner response completes successfully on a real report.
- [ ] PASS - PDF upload works with live AI credentials.
- [ ] PASS - TXT upload works with live AI credentials.
- [ ] PASS - PNG/JPG upload works with live AI credentials.
- [ ] BLOCKED - live Gemini or OCR credentials are not available yet.

## File types to test

- [ ] TXT upload.
- [ ] PDF upload.
- [ ] PNG upload.
- [ ] JPG upload.
- [ ] Image-only PDF that requires OCR fallback.

## Behaviors to verify

- [ ] Readable reports upload and analyze successfully.
- [ ] Unreadable reports fail gracefully.
- [ ] Low-confidence OCR scans require confirmation before dispute generation.
- [ ] Scanner metadata saves to Supabase.
- [ ] The app shows a friendly retry message for AI errors.
- [ ] Uploaded report text is not logged unsafely.
- [ ] No report content is stored beyond the intended metadata.

## Manual evidence to capture

- [ ] Screenshot of a successful TXT scan.
- [ ] Screenshot of an OCR fallback success.
- [ ] Screenshot of an unreadable-file failure.
- [ ] Screenshot of the low-confidence confirmation step, if triggered.
