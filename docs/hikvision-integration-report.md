# Hikvision Attendance Integration — MD Report

**Prepared by:** C. M. Ilonze, IT/Communications
**Date:** 15 May 2026

## Summary

The **[device model / location — e.g. Hikvision DS-K1T804MF, Reception]** biometric attendance machine has been successfully connected to the ACOB ERP. The end-to-end pipeline — device → webhook → ERP record — is working: a scan on the device posts to the ERP and is matched to the correct employee profile, with HR seeing the attendance live on their dashboard.

## What was configured on the Hikvision machine

- **Event Notification (HTTP Listening) enabled** on the device, pointing to the ERP's secured webhook URL.
- **Linkage:** Access Control Event → Attendance, set to push on every successful authentication.
- **Auth token** appended to the webhook URL so only events from our device are accepted by the ERP.
- **Time zone** set to West Africa Time so timestamps match Nigerian local time on the ERP.
- **Employee IDs** on the device aligned with the IDs stored on the ERP staff profiles, so each scan is matched to the correct employee.

## How we tested it

Before pointing the device at the live ERP, we redirected the webhook to **webhook.site** (a public request inspector) to confirm the device was actually emitting events in the expected format.

- Performed test scans on the device.
- Confirmed each scan arrived at webhook.site within seconds.
- Verified the payload contained the employee ID, timestamp, and event type.
- Once the payload structure was confirmed, we switched the webhook URL from webhook.site to the ERP endpoint.

## What was configured on the ERP

- Webhook endpoint set up to receive and validate events from the Hikvision device.
- Auth token check — events without the correct token are rejected.
- Employee mapping field added to each staff profile to link them to their Hikvision ID.
- Attendance records tagged with their source (*device* or *manual*) for HR visibility.
- Duplicate-scan protection and a daily job to flag incomplete attendance.

## How it works now

1. Staff scans face/card at the Hikvision device.
2. The device sends the event to the ERP webhook with the auth token.
3. The ERP matches the device ID to the staff profile.
4. **First scan of the day** → clock-in is recorded.
5. **Every subsequent scan** → clock-out is updated to that scan time, so the last scan of the day is always the true departure time.
6. HR sees the attendance live on the dashboard, with each row tagged as device-sourced.

Work continues on ERP-side refinements and wider staff testing in parallel.

— **C. M. Ilonze**
