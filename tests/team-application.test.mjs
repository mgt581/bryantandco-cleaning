import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../functions/api/apply.js', import.meta.url), 'utf8');
const { onRequest } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

function application(answers) {
  const form = new FormData();
  for (const [key, value] of Object.entries({
    first_name: 'Test', last_name: 'Applicant', email: 'test@example.com',
    phone: '00000000000', based_in: 'Test town', postcode: 'BH1 1AA',
    date_of_birth: '2000-01-01', gender: 'Female', years_experience: '1–2 years',
    licence_and_car: 'Yes', english_speaking: 'Yes', whatsapp_group: 'No',
    zero_hours_agreement: 'agree', about: 'Test application', consent: 'I agree'
  })) form.set(key, value);
  form.set('selfie', new Blob(['test-image'], { type: 'image/png' }), 'test.png');
  for (const answer of answers) form.append('right_to_work_uk', answer);
  return new Request('https://example.com/api/apply', { method: 'POST', body: form });
}

// Capture the email locally: these tests never contact the email provider.
test('right-to-work requires exactly one valid answer and retains both choices in email', async () => {
  const originalFetch = globalThis.fetch;
  const emails = [];
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://api.resend.com/emails');
    emails.push(JSON.parse(options.body));
    return new Response('{"id":"test"}', { status: 200 });
  };
  try {
    for (const answers of [[], [''], ['Maybe'], ['Yes', 'No'], ['Yes', 'Yes']]) {
      const response = await onRequest({ request: application(answers), env: { RESEND_API_KEY: 'test' } });
      assert.equal(response.status, 400);
      assert.match((await response.json()).error, /right to work/);
    }
    assert.equal(emails.length, 0);
    for (const answer of ['Yes', 'No']) {
      const response = await onRequest({ request: application([answer]), env: { RESEND_API_KEY: 'test' } });
      assert.equal(response.status, 200);
      const email = emails.at(-1);
      assert.ok(email.text.includes(`Do you have the right to work in the UK?: ${answer}`));
      assert.ok(email.html.includes(`Do you have the right to work in the UK?</th><td style="padding:6px 0;">${answer}</td>`));
      assert.equal(email.attachments.length, 1);
      assert.equal(email.reply_to, 'test@example.com');
      assert.ok(email.text.includes('Overall work experience: 1–2 years'));
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});
