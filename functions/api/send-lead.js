export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405, { Allow: 'POST, OPTIONS' });
  }

  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) {
    return json({ error: 'RESEND_API_KEY is not configured' }, 500);
  }

  let lead;
  try {
    lead = await request.json();
  } catch (_) {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const fromAddress = env.LEAD_FROM_EMAIL || 'Bryant & Co Cleaning <onboarding@resend.dev>';
  const toAddresses = (env.LEAD_TO_EMAILS || 'allleadshere@yahoo.com')
    .split(',')
    .map((email) => email.trim())
    .filter(Boolean);

  if (!toAddresses.length) {
    return json({ error: 'No destination email is configured' }, 500);
  }

  const fields = [
    ['Page', lead.page_url],
    ['Form', lead.form_name],
    ['Service', lead.service || lead.home_service || lead.gallery_service],
    ['Name', [lead.first_name, lead.last_name].filter(Boolean).join(' ')],
    ['Email', lead.email],
    ['Phone', lead.phone],
    ['Postcode', lead.postcode],
    ['Property size', lead.property_size],
    ['Preferred date', lead.preferred_date],
    ['Message', lead.message]
  ].filter(([, value]) => value);

  const text = fields.map(([label, value]) => `${label}: ${value}`).join('\n');
  const html = '<h2>New Bryant & Co Cleaning lead</h2><table>' + fields.map(([label, value]) => (
    `<tr><th align="left" style="padding:6px 12px 6px 0;">${escapeHtml(label)}</th><td style="padding:6px 0;">${escapeHtml(String(value))}</td></tr>`
  )).join('') + '</table>';

  let response;
  try {
    response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: fromAddress,
        to: toAddresses,
        reply_to: lead.email || 'info@bryantandcocleaning.co.uk',
        subject: lead.service ? `New quote request - ${lead.service}` : 'New Bryant & Co Cleaning quote request',
        text,
        html
      })
    });
  } catch (error) {
    return json({
      error: 'Failed to reach Resend API',
      details: error instanceof Error ? error.message : String(error)
    }, 500);
  }

  if (!response.ok) {
    const details = await response.text();
    const status = response.status >= 400 && response.status < 500 ? 400 : 500;
    return json({ error: 'Resend email failed', details }, status);
  }

  return json({ ok: true });
}

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: Object.assign({
      'Content-Type': 'application/json'
    }, corsHeaders(), extraHeaders)
  });
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
}

function escapeHtml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
