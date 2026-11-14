// Confere se a chave do Asaas no `.env` conecta (só leitura, não cria nada).
//
//   node scripts/check-asaas.js
//
// Mostra só o ambiente e o status; a chave nunca é impressa.
const fs = require('fs');
const path = require('path');

const env = Object.fromEntries(
  fs
    .readFileSync(path.join(__dirname, '..', '.env'), 'utf8')
    .split('\n')
    .filter((line) => line.includes('=') && !line.startsWith('#'))
    .map((line) => [
      line.slice(0, line.indexOf('=')),
      line
        .slice(line.indexOf('=') + 1)
        .trim()
        .replace(/^["']|["']$/g, ''),
    ]),
);

async function main() {
  const baseUrl = env.ASAAS_BASE_URL || 'https://api-sandbox.asaas.com/v3';
  const apiKey = env.ASAAS_API_KEY;

  console.log(`Ambiente: ${baseUrl.includes('sandbox') ? 'sandbox' : 'PRODUÇÃO'}`);
  console.log(`PAYMENT_GATEWAY: ${env.PAYMENT_GATEWAY || '(asaas)'}`);
  if (env.PAYMENT_GATEWAY === 'fake') {
    console.log('Aviso: com PAYMENT_GATEWAY=fake a API ignora o Asaas.');
  }
  if (!env.ASAAS_WEBHOOK_TOKEN) {
    console.log('Aviso: ASAAS_WEBHOOK_TOKEN vazio, o webhook vai recusar tudo.');
  }
  if (!apiKey) {
    console.log('ASAAS_API_KEY vazia no .env.');
    process.exit(1);
  }

  const res = await fetch(`${baseUrl}/customers?limit=1`, {
    headers: { access_token: apiKey },
  });
  if (res.ok) {
    const body = await res.json();
    console.log(`Conectado (HTTP ${res.status}). Clientes na conta: ${body.totalCount}`);
    return;
  }
  console.log(`Falhou (HTTP ${res.status}): ${await res.text()}`);
  process.exit(1);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
