# Lead Generation Setup

This setup matches a GitHub + Cloudflare Pages deployment with Google Tag Manager and Resend.

## Public Email

The website displays `info@bryantandcocleaning.co.uk`.

Set mailbox forwarding in your email/DNS provider:

- Forward `info@bryantandcocleaning.co.uk` to `bryantcocleaning@gmail.com`
- Forward `info@bryantandcocleaning.co.uk` to `alex@bryantgroupholdings.co.uk`

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
- `LEAD_TO_EMAILS=bryantcocleaning@gmail.com,alex@bryantgroupholdings.co.uk`

After saving variables/secrets, redeploy the Pages project.
