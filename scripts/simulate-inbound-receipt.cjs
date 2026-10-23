#!/usr/bin/env node
'use strict';

/**
 * CLI Tool to simulate an inbound WhatsApp Business / Pago Móvil receipt webhook.
 * Dispatches HMAC-signed payload to http://127.0.0.1:3030/webhook/meta.
 * 
 * Usage:
 *   node scripts/simulate-inbound-receipt.cjs [--amount=82000] [--bank=Banesco] [--ref=55443322] [--sender="Maria OTC"]
 */

const http = require('node:http');
const { createHmac } = require('node:crypto');

const args = process.argv.slice(2);
function getArg(key, defaultValue) {
  const prefix = `--${key}=`;
  const found = args.find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : defaultValue;
}

const port = Number(getArg('port', '3030'));
const bank = getArg('bank', 'Banesco');
const amount = Number(getArg('amount', '82000'));
const ref = getArg('ref', Math.floor(10000000 + Math.random() * 90000000).toString());
const senderName = getArg('sender', 'Pedro Perez');
const senderPhone = getArg('phone', '584149876543');
const appSecret = process.env.META_APP_SECRET || '';

const formattedAmount = amount.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const smsText = `${bank.toUpperCase()}: Pago Movil recibido de ${senderName} por Bs. ${formattedAmount} Ref: ${ref}`;

const payload = JSON.stringify({
  object: 'whatsapp_business_account',
  entry: [
    {
      id: 'WABA_DESK_SIMULATOR',
      changes: [
        {
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            contacts: [{ profile: { name: senderName }, wa_id: senderPhone }],
            messages: [
              {
                from: senderPhone,
                id: `wamid.sim_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                timestamp: Math.floor(Date.now() / 1000).toString(),
                type: 'text',
                text: { body: smsText },
              },
            ],
          },
        },
      ],
    },
  ],
});

console.log('='.repeat(65));
console.log('  P2P DECISOR SUITE - INBOUND WEBHOOK DESK SIMULATOR');
console.log('='.repeat(65));
console.log(`Target:      http://127.0.0.1:${port}/webhook/meta`);
console.log(`Remitente:   ${senderName} (${senderPhone})`);
console.log(`Banco:       ${bank}`);
console.log(`Monto:       Bs. ${formattedAmount}`);
console.log(`Referencia:  ${ref}`);
console.log(`Mensaje SMS: "${smsText}"`);
console.log('-'.repeat(65));

const headers = {
  'Content-Type': 'application/json',
  'Content-Length': Buffer.byteLength(payload),
};

if (appSecret) {
  const hmac = createHmac('sha256', appSecret).update(payload).digest('hex');
  headers['X-Hub-Signature-256'] = `sha256=${hmac}`;
  console.log('HMAC Firma:  Calculada con META_APP_SECRET');
} else {
  console.log('HMAC Firma:  Sin secreto (modo local de desarrollo)');
}

const req = http.request(
  {
    hostname: '127.0.0.1',
    port,
    path: '/webhook/meta',
    method: 'POST',
    headers,
    timeout: 3000,
  },
  (res) => {
    let body = '';
    res.on('data', (chunk) => {
      body += chunk;
    });
    res.on('end', () => {
      console.log(`\nHTTP Status: ${res.statusCode} ${res.statusMessage}`);
      try {
        const json = JSON.parse(body);
        console.log('Respuesta del Gateway:', JSON.stringify(json, null, 2));
        if (json.newReceiptsDetected > 0) {
          console.log('\n[ÉXITO] ¡Comprobante procesado por el Inbound Gateway!');
          console.log(`-> El trato con Ref: ${ref} fue emitido por SSE hacia el CRM.`);
          console.log('-> En el Kanban de la aplicación se ubica en "STAGE_1_NEW" (Cotizado).');
        } else {
          console.log('\n[AVISO] El gateway recibió el mensaje pero no detectó un nuevo comprobante.');
        }
      } catch {
        console.log('Respuesta en texto crudo:', body);
      }
      console.log('='.repeat(65));
    });
  },
);

req.on('error', (err) => {
  console.error(`\n[ERROR] No se pudo conectar al Inbound Gateway en el puerto ${port}.`);
  console.error(`Detalle: ${err.message}`);
  console.error('Verificá que el gateway esté corriendo con: npm run inbound:dev');
  console.log('='.repeat(65));
});

req.write(payload);
req.end();
