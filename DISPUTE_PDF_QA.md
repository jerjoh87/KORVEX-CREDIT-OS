# CREDITOS Dispute PDF QA

Test the actual generated letter, not the placeholder path.

## Simple launch board

Legend:

- done = implemented and verified locally
- blocked by credentials = needs a real generated letter flow or live mail service
- blocked by schema/config = needs production mail / storage wiring

| Area | Status | Notes |
|---|---|---|
| Letter generation | done | Dispute letters generate locally and can be previewed. |
| PDF export | done | Browser PDF export is already wired. |
| “Ship letter” action | done | It marks mailed status and opens the print path. |
| Physical mail fulfillment | blocked by credentials | Still needs a real mail provider before true auto-mailing. |

## Live credential checks

- [ ] PASS - Dispute letter PDF generation completes from real test data.
- [ ] PASS - The downloaded PDF is not blank and is readable.
- [ ] PASS - The letter includes consumer, bureau, item, dispute reason, requested action, date, and mailing language.
- [ ] BLOCKED - PDF generation cannot be exercised with a real generated letter yet.

## PDF checks

- [ ] Generate a real dispute letter from test report data.
- [ ] Download the letter as a PDF.
- [ ] Confirm the PDF is not blank.
- [ ] Confirm the layout is readable on desktop.
- [ ] Confirm the layout is readable on mobile.
- [ ] Confirm the letter contains:
  - [ ] consumer information
  - [ ] bureau information
  - [ ] account or item being disputed
  - [ ] dispute reason
  - [ ] requested action
  - [ ] date
  - [ ] mailing language
  - [ ] legal disclaimer, if applicable

## Workflow checks

- [ ] Marking a letter mailed requires confirmation.
- [ ] Marking a letter resolved requires confirmation.
- [ ] Marking a letter verified requires confirmation.
- [ ] Marking a letter deleted requires confirmation.
- [ ] Marking a letter escalated requires confirmation.
- [ ] Deadline reminders trigger on time.
- [ ] Round 2 prompts trigger on time.

## Manual evidence to capture

- [ ] Screenshot of the downloaded PDF.
- [ ] Screenshot of the desktop preview.
- [ ] Screenshot of the mobile preview, if available.
