# Google Document AI / Vision OCR setup

Use this to enable faster server-side OCR for scanned credit reports and business reports.

## Google Cloud resources

- Project ID: `GOOGLE_CLOUD_PROJECT_ID`
- Location: `GOOGLE_CLOUD_LOCATION`
  - Use `us` for the current Document AI processor shown in Google Cloud.
- Document AI processor ID: `GOOGLE_DOCUMENT_AI_PROCESSOR_ID`
- Optional processor version: `GOOGLE_DOCUMENT_AI_PROCESSOR_VERSION`
- Service account: `creditos-ocr-reader@abiding-honor-497505-b4.iam.gserviceaccount.com`
- Role assigned: Document AI API User

## Required app environment variables

Add these in `.env.local` for local testing and in Vercel Environment Variables for production:

- `GOOGLE_CLOUD_PROJECT_ID`
- `GOOGLE_CLOUD_LOCATION`
- `GOOGLE_DOCUMENT_AI_PROCESSOR_ID`
- `GOOGLE_SERVICE_ACCOUNT_JSON_BASE64`

Optional:

- `GOOGLE_DOCUMENT_AI_PROCESSOR_VERSION`
- `GOOGLE_VISION_OCR_ENABLED`

Keep `GOOGLE_VISION_OCR_ENABLED` unset or `false` unless the Cloud Vision API is enabled and the service account has a clean Vision OCR/API role. The current setup uses Document AI first and browser OCR fallback.

## Service account safety

- Keep service account credentials server-only.
- Never paste service account JSON into chat.
- Prefer `GOOGLE_SERVICE_ACCOUNT_JSON_BASE64` in hosting env vars so multiline JSON does not break.
- If a service account key is exposed, delete that key in Google Cloud and create a new one.
- Do not commit `.env.local` or credential JSON files.

## Processor fields

For the current CREDITOS mapping, configure Document AI extraction fields for:

Personal reports:

- `consumer_name`
- `bureau_name`
- `creditor_name`
- `account_number`
- `account_type`
- `balance`
- `credit_limit`
- `payment_status`
- `late_payment_history`
- `charge_off`
- `collection`
- `inquiry_date`
- `opened_date`
- `last_reported_date`
- `first_delinquency_date`

Business reports:

- `business_name`
- `business_address`
- `business_phone`
- `business_email`
- `website`
- `ein`
- `duns`
- `naics_sic`
- `monthly_revenue`
- `months_in_business`
- `business_bank`
- `tradeline_vendor_name`
- `tradeline_status`
- `tradeline_stage`
- `bureau_reference`

The app still uses Gemini for structured analysis after OCR text is extracted. Google OCR improves the text extraction step and falls back to browser OCR when it is not configured.
