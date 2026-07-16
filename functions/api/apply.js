export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405, { Allow: 'POST, OPTIONS' });
  }

  if (!env.RESEND_API_KEY) {
    return json({ error: 'RESEND_API_KEY is not configured' }, 500);
  }

  let form;
  try {
    form = await request.formData();
  } catch (_) {
    return json({ error: 'Please complete the application form and upload a selfie.' }, 400);
  }

  const firstName = value(form, 'first_name');
  const lastName = value(form, 'last_name');
  const email = value(form, 'email');
  const phone = value(form, 'phone');
  const basedIn = value(form, 'based_in');
  const postcode = value(form, 'postcode');
  const dateOfBirth = value(form, 'date_of_birth');
  const gender = value(form, 'gender');
  const yearsExperience = value(form, 'years_experience');
  const licenceAndCar = value(form, 'licence_and_car');
  const englishSpeaking = value(form, 'english_speaking');
  const whatsappGroup = value(form, 'whatsapp_group');
  const zeroHoursAgreement = value(form, 'zero_hours_agreement');
  const about = value(form, 'about');
  const consent = value(form, 'consent');
  const selfie = form.get('selfie');
  const portfolioFiles = form.getAll('portfolio').filter((file) => file && typeof file.arrayBuffer === 'function' && file.size);

  if (!firstName || !lastName || !email || !phone || !basedIn || !postcode || !dateOfBirth || !gender || !yearsExperience || !licenceAndCar || !englishSpeaking || !whatsappGroup || !zeroHoursAgreement || !about || !consent) {
    return json({ error: 'Please complete all required application fields.' }, 400);
  }

  if (zeroHoursAgreement === 'decline') {
    return json({ error: 'Unfortunately, we cannot offer you a position at this time. Please agree to the zero-hours contract to submit the form.' }, 400);
  }

  if (!/^\S+@\S+\.\S+$/.test(email)) {
    return json({ error: 'Please enter a valid email address.' }, 400);
  }

  if (!selfie || typeof selfie.arrayBuffer !== 'function' || !selfie.size) {
    return json({ error: 'Please upload a selfie with your application.' }, 400);
  }

  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  if (!allowedTypes.includes(selfie.type)) {
    return json({ error: 'Selfies must be JPG, PNG, WEBP or GIF images.' }, 400);
  }

  const maxBytes = 5 * 1024 * 1024;
  if (selfie.size > maxBytes) {
    return json({ error: 'Please upload a selfie smaller than 5MB.' }, 400);
  }

  if (portfolioFiles.length > 6) {
    return json({ error: 'Please upload no more than 6 portfolio pictures.' }, 400);
  }

  if (portfolioFiles.some((file) => !allowedTypes.includes(file.type) || file.size > maxBytes)) {
    return json({ error: 'Portfolio pictures must be JPG, PNG, WEBP or GIF images smaller than 5MB each.' }, 400);
  }

  const totalUploadBytes = selfie.size + portfolioFiles.reduce((total, file) => total + file.size, 0);
  if (totalUploadBytes > 15 * 1024 * 1024) {
    return json({ error: 'Please keep the total selfie and portfolio upload size below 15MB.' }, 400);
  }

  const attachments = [{
    filename: safeFilename(selfie.name || 'applicant-selfie.jpg'),
    content: await toBase64(await selfie.arrayBuffer())
  }];
  for (const [index, file] of portfolioFiles.entries()) {
    attachments.push({
      filename: `portfolio-${index + 1}-${safeFilename(file.name || 'picture.jpg')}`,
      content: await toBase64(await file.arrayBuffer())
    });
  }
  const fromAddress = env.LEAD_FROM_EMAIL || 'Bryant & Co Cleaning <onboarding@resend.dev>';
  const toAddresses = (env.LEAD_TO_EMAILS || 'ajbryantsleads@gmail.com')
    .split(',')
    .map((address) => address.trim())
    .filter(Boolean);

  if (!toAddresses.length) {
    return json({ error: 'No destination email is configured' }, 500);
  }

  const name = `${firstName} ${lastName}`.trim();
  const fields = [
    ['Name', name],
    ['Email', email],
    ['Phone', phone],
    ['Based in', basedIn],
    ['Postcode', postcode],
    ['Date of birth', dateOfBirth],
    ['Gender', gender],
    ['Overall work experience', yearsExperience],
    ['Owns a driving licence and car', licenceAndCar],
    ['English speaking', englishSpeaking],
    ['Happy to join WhatsApp group', whatsappGroup],
    ['Zero-hours contract', zeroHoursAgreement === 'agree' ? 'Agreed' : zeroHoursAgreement],
    ['About the applicant', about],
    ['Portfolio pictures attached', String(portfolioFiles.length)],
    ['Page', value(form, 'page_url')]
  ];
  const text = fields.map(([label, fieldValue]) => `${label}: ${fieldValue}`).join('\n');
  const html = '<h2>New Bryant & Co Cleaning team application</h2><table>' + fields.map(([label, fieldValue]) => (
    `<tr><th align="left" style="padding:6px 12px 6px 0;">${escapeHtml(label)}</th><td style="padding:6px 0;">${escapeHtml(fieldValue)}</td></tr>`
  )).join('') + `</table><p>The applicant selfie and ${portfolioFiles.length} optional portfolio picture(s) are attached to this email.</p>`;

  let response;
  try {
    response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: fromAddress,
        to: toAddresses,
        reply_to: email,
        subject: `New team application - ${name}`,
        text,
        html,
        attachments
      })
    });
  } catch (error) {
    return json({ error: 'Failed to reach the email service', details: error instanceof Error ? error.message : String(error) }, 500);
  }

  if (!response.ok) {
    const details = await response.text();
    return json({ error: 'Application email failed', details }, response.status >= 400 && response.status < 500 ? 400 : 500);
  }

  return json({ ok: true });
}

function value(form, key) {
  return String(form.get(key) || '').trim();
}

async function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function safeFilename(filename) {
  return String(filename).replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 120) || 'applicant-selfie.jpg';
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: Object.assign({ 'Content-Type': 'application/json' }, corsHeaders(), extraHeaders)
  });
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
}
