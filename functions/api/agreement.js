// Receives a signed self-employed cleaner agreement from /staff-agreement.html
// and emails it (details + signature image) to the business, with a copy to the
// cleaner when they give an email address. Nothing is stored on the server.

const AGREEMENT_VERSION = 'Version 2 (one page) - 12 November 2026';

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!env.RESEND_API_KEY) return json({ error: 'Email is not set up yet. Please tell Alex.' }, 500);

  let body;
  try { body = await request.json(); } catch (_) { return json({ error: 'Please fill in the form and try again.' }, 400); }
  if (clean(body.website)) return json({ ok: true }); // honeypot

  const f = {
    name: clean(body.name, 120), address: clean(body.address, 300), phone: clean(body.phone, 40),
    email: clean(body.email, 200), nino: clean(body.nino, 20).toUpperCase(), utr: clean(body.utr, 20),
    bankName: clean(body.bankName, 120), sortCode: clean(body.sortCode, 12), accountNo: clean(body.accountNo, 12)
  };
  if (!f.name || !f.address || !f.phone) return json({ error: 'Please add your name, address and phone number.' }, 400);
  if (body.agree !== true) return json({ error: 'Please tick the box to agree.' }, 400);
  if (f.email && !/^\S+@\S+\.\S+$/.test(f.email)) return json({ error: 'Please check your email address.' }, 400);

  const sig = String(body.signature || '');
  const m = sig.match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
  if (!m || m[1].length < 200) return json({ error: 'Please sign in the box.' }, 400);
  if (m[1].length > 700000) return json({ error: 'The signature is too large. Please clear it and sign again.' }, 400);

  const signedAt = new Date();
  const when = signedAt.toLocaleString('en-GB', { timeZone: 'Europe/London', dateStyle: 'long', timeStyle: 'short' });
  const textHash = await sha256(clean(body.agreementText, 20000));

  const rows = [
    ['Name', f.name], ['Address', f.address], ['Phone', f.phone], ['Email', f.email],
    ['National Insurance number', f.nino], ['HMRC UTR', f.utr],
    ['Name on bank account', f.bankName], ['Sort code', f.sortCode], ['Account number', f.accountNo],
    ['Agreement', AGREEMENT_VERSION], ['Signed', when + ' (UK time)'],
    ['Agreed', 'Ticked: "I have read this agreement, I agree to it, and I am working as a self-employed subcontractor."'],
    ['Agreement text fingerprint (SHA-256)', textHash]
  ];
  const table = '<table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px">' + rows.map(([k, v]) =>
    `<tr><th align="left" style="padding:6px 14px 6px 0;color:#5a6678;font-weight:600;vertical-align:top">${esc(k)}</th><td style="padding:6px 0">${esc(v || '-')}</td></tr>`).join('') + '</table>';
  const agreementHtml = AGREEMENT.map((p) => `<p style="margin:0 0 8px">${esc(p)}</p>`).join('');
  const html = `<div style="font-family:Arial,sans-serif;color:#1a1f2e;max-width:640px">
    <h2 style="color:#1b3a6b;margin:0 0 4px">Signed self-employed cleaner agreement</h2>
    <p style="margin:0 0 16px;color:#5a6678">Bryant Group Holdings Ltd, trading as Bryant &amp; Co Cleaning</p>
    ${table}
    <p style="margin:16px 0 6px"><b>Signature:</b> attached as <i>signature.png</i>. Signed for Bryant &amp; Co Cleaning by Alex Bryant, Director.</p>
    <hr style="border:0;border-top:1px solid #dde3ec;margin:16px 0">
    <h3 style="color:#1b3a6b;margin:0 0 8px">The agreement</h3>${agreementHtml}</div>`;
  const text = rows.map(([k, v]) => `${k}: ${v || '-'}`).join('\n') + '\n\nTHE AGREEMENT\n' + AGREEMENT.join('\n');

  const from = env.LEAD_FROM_EMAIL || 'Bryant & Co Cleaning <info@bryantandcocleaning.co.uk>';
  const owners = (env.LEAD_TO_EMAILS || 'ajbryantsleads@gmail.com').split(',').map((s) => s.trim()).filter(Boolean);
  const attachments = [{ filename: 'signature.png', content: m[1] }];

  const sent = await send(env, { from, to: owners, reply_to: f.email || undefined,
    subject: `Signed agreement - ${f.name}`, html, text, attachments });
  if (!sent.ok) return json({ error: 'We could not send your agreement. Please try again in a minute.' }, 502);

  if (f.email) {
    // The cleaner's copy leaves out nothing they typed; it is their own data.
    await send(env, { from, to: [f.email], reply_to: owners[0],
      subject: 'Your signed Bryant & Co Cleaning agreement', html, text, attachments });
  }
  return json({ ok: true, signedAt: signedAt.toISOString() });
}

const AGREEMENT = [
  'Between Bryant Group Holdings Ltd, trading as Bryant & Co Cleaning (company 13671131, 32 Heaton Road, Bournemouth BH10 5HW), and the cleaner signing below.',
  "1. You're self-employed. No guaranteed hours. You choose which jobs to take and can work for others. No holiday or sick pay.",
  "2. Jobs. We post jobs in the WhatsApp group and you reply to take one. We send the address privately. Never share customers' details.",
  '3. Pay. £15 an hour, unless the job post says otherwise. Send an invoice by Sunday and we pay every Friday by bank transfer.',
  '4. Tax. You register with HMRC as self-employed and pay your own tax and National Insurance.',
  "5. The work. Clean to a good standard, look after keys and customers' homes, and tell us about any damage the same day. What you see in a customer's home stays private.",
  "6. Can't make it? Tell us at least 24 hours before. If you don't turn up without telling us, you aren't paid for that job. Two no-shows in 3 months and we may stop offering you work.",
  '7. Ending. Either of us can end this at any time by message. We pay for any work already done.'
];

async function send(env, payload) {
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return { ok: r.ok };
  } catch (_) { return { ok: false }; }
}

async function sha256(t) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
function clean(v, max = 1000) { return String(v == null ? '' : v).trim().slice(0, max); }
function esc(v) { return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function cors() { return { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }; }
function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: Object.assign({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, cors()) });
}
