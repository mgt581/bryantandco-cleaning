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

- `phone_call_click`
- `email_click`
- `whatsapp_click`
- `lead_form_submit`

In Google Tag Manager, create triggers for those custom event names and attach your Google Ads / GA4 tags.

## Cloudflare Pages Function

The quote forms post to `/api/send-lead`.

Cloudflare Pages maps that route from:

```text
functions/api/send-lead.js
```

Deploy the repository through Cloudflare Pages from GitHub. Functions deploy with the Pages project when the `functions` directory is present at the project root.

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
