# Lead Generation Setup

This setup matches a GitHub + Cloudflare Pages deployment with Google Tag Manager and Resend.

## Public Email

The website displays `info@bryantandcocleaning.co.uk`.

Set mailbox forwarding in your email/DNS provider:

- Forward `info@bryantandcocleaning.co.uk` to `allleadshere@yahoo.com`

To reply as `info@bryantandcocleaning.co.uk`, add it as a send-as alias in Gmail or Google Workspace and complete the verification email.

## Google Tag Manager

Create a new web container in Google Tag Manager for `bryantandcocleaning.co.uk`, then update `js/site-config.js`:

```js
googleTagManagerId: 'GTM-TKWBCQGM'
```

The site pushes these events into `dataLayer`:

- `page_view`
- `phone_click`
- `email_click`
- `whatsapp_click`
- `quote_cta_click`
- `lead_form_submit_attempt`
- `generate_lead`
- `lead_form_error`
- `lead_thank_you_view`

In Google Tag Manager, create triggers for those custom event names and attach your Google Ads / GA4 tags.

## Cloudflare Pages Function

The quote forms post to `/api/send-lead`.

Cloudflare Pages maps that route from:

```text
functions/api/send-lead.js
```

The browser event tracker posts page views, click events and form journey events to:

```text
functions/api/lead-event.js
```

Deploy the repository through Cloudflare Pages from GitHub. Functions deploy with the Pages project when the `functions` directory is present at the project root.

## Private lead dashboard

The private lead dashboard is available at `/dashboard` and loads its data from `/api/dashboard`.

Keep dashboard access protected with Cloudflare Access. Do not share token URLs publicly and do not add the export token to public HTML or JavaScript.

In Cloudflare Pages, add:

- `LEADS_DB`: D1 database binding for lead and event storage.
- `LEADS_EXPORT_TOKEN`: encrypted secret fallback for private API/CSV access.
- `CLOUDFLARE_ACCESS_ENABLED=true`: confirms that Access-protected browser requests may use the Access assertion/cookie.

The dashboard and CSV exports support Cloudflare Access authenticated requests. The export routes are:

- `/api/leads/export`
- `/api/lead-events/export`

Create a dedicated D1 database for Bryant & Co Cleaning leads, for example `bryant-cleaning-leads`, then run:

```text
migrations/0001_lead_tracking.sql
```

For a database that already has the original lead-tracking schema, run the additive pipeline migration instead:

```text
migrations/0002_lead_pipeline.sql
```

Protect these paths with the same Cloudflare Access application/policy:

- `/dashboard` and `/dashboard.html`
- `/api/dashboard`
- `/api/leads/*`
- `/api/lead-events/export`

The dashboard never puts an admin token in HTML, JavaScript, links or query strings. Browser administration relies on Cloudflare Access. The encrypted `LEADS_EXPORT_TOKEN` is only a bearer-token fallback for controlled server/API use.

The lead pipeline supports `TEST`, `NEW`, `GENUINE`, `SPAM`, `CONTACTED`, `QUOTED`, `WON` and `LOST`, plus quote value and won revenue stored as integer pence. Admins update those fields from the private dashboard.

The functions also create missing lead tables automatically on first use, but running the migration first is cleaner.

## Resend

In Resend, verify `bryantandcocleaning.co.uk` and add the DNS records Resend gives you in Cloudflare DNS.

In Cloudflare Pages, open the Bryant & Co Cleaning Pages project:

```text
Settings > Variables and Secrets > Add
```

Add:

- `RESEND_API_KEY` as an encrypted secret
- `LEAD_FROM_EMAIL=Bryant & Co Cleaning <info@bryantandcocleaning.co.uk>`
- `LEAD_TO_EMAILS=allleadshere@yahoo.com`

After saving variables/secrets, redeploy the Pages project.

## Live booking availability

The calendar embedded in the homepage and contact page uses Cloudflare D1 to
store pending/confirmed booking requests and every 30-minute time block they
occupy. This is what makes a selected time appear as taken to the next visitor
and prevents overlapping requests.

1. Create a Cloudflare D1 database, for example `bryant-cleaning-bookings`.
2. Run `schema.sql` against that database using Wrangler or the Cloudflare
   dashboard.
3. In the Pages project, add a D1 database binding named exactly `BOOKING_DB`
   under Settings > Functions.
4. Redeploy the site and test the calendar from both `/` and `/contact.html`.

Until the binding is present, the widget deliberately shows that live
availability is unavailable rather than displaying misleading free slots.
Booking requests made through the form are stored as `pending` and therefore
remain blocked until they are managed in the D1 database. The recurrence end
date is required for recurring requests and is limited to 24 months.
