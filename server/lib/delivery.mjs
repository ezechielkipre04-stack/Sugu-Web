import { config, mockMode, smsReady, whatsappReady } from './config.mjs';

function maskPhone(phone) {
  const value = String(phone ?? '');
  if (value.length <= 6) return '***';
  return `${value.slice(0, 4)}***${value.slice(-3)}`;
}

async function sendWhatsApp(phone, code) {
  const url = `https://graph.facebook.com/${config.whatsappApiVersion}/${config.whatsappPhoneNumberId}/messages`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${config.whatsappToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: phone.replace('+', ''),
      type: 'template',
      template: {
        name: config.whatsappTemplateName,
        language: { code: config.whatsappTemplateLang },
        components: [{ type: 'body', parameters: [{ type: 'text', text: code }] }],
      },
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`WhatsApp ${response.status} ${detail}`.trim());
  }
}

async function sendSms(phone, message) {
  if (config.smsProvider === 'termii') {
    const response = await fetch('https://api.ng.termii.com/api/sms/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        to: phone.replace('+', ''),
        from: config.termiiSenderId,
        sms: message,
        type: 'plain',
        channel: 'generic',
        api_key: config.termiiApiKey,
      }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`Termii ${response.status} ${detail}`.trim());
    }
    return;
  }

  const credentials = Buffer.from(
    `${config.twilioAccountSid}:${config.twilioAuthToken}`,
  ).toString('base64');
  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${config.twilioAccountSid}/Messages.json`,
    {
      method: 'POST',
      headers: {
        authorization: `Basic ${credentials}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: phone, From: config.twilioFrom, Body: message }),
    },
  );
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Twilio ${response.status} ${detail}`.trim());
  }
}

export async function deliverCode(phone, requestedChannel, code) {
  const message = `Votre code de vérification SUGU est ${code}. Il expire dans ${Math.ceil(
    config.otpTtlSeconds / 60,
  )} minutes. Ne partagez ce code avec personne.`;
  const candidates = requestedChannel === 'sms' ? ['sms', 'whatsapp'] : ['whatsapp', 'sms'];
  const failures = [];

  for (const channel of candidates) {
    if (channel === 'whatsapp' && whatsappReady) {
      try {
        await sendWhatsApp(phone, code);
        return 'whatsapp';
      } catch (error) {
        failures.push(error?.message ?? String(error));
        console.error(`[SUGU OTP] Échec WhatsApp pour ${maskPhone(phone)}:`, error?.message);
      }
    }
    if (channel === 'sms' && smsReady) {
      try {
        await sendSms(phone, message);
        return 'sms';
      } catch (error) {
        failures.push(error?.message ?? String(error));
        console.error(`[SUGU OTP] Échec SMS pour ${maskPhone(phone)}:`, error?.message);
      }
    }
  }

  if (failures.length > 0) {
    throw new Error('Aucun fournisseur n’a pu envoyer le code.');
  }

  console.info(`[SUGU OTP][mock] ${requestedChannel.toUpperCase()} ${maskPhone(phone)} code=${code}`);
  return 'mock';
}

export { mockMode };
