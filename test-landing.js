// Teste da landing: ela nao rastreia nada. O pixel mora so no quiz
// (coberto por test-quiz.js).
// Rodar:  NODE_PATH=<node_modules com playwright> node test-landing.js <pasta do site>
const { chromium } = require('playwright');
const assert = require('assert');

const RAIZ = 'file:///' + process.argv[2].replace(/\\/g, '/').replace(/\/$/, '');

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  // Qualquer chamada pro Meta a partir da landing e defeito.
  const paraOMeta = [];
  await page.route('**connect.facebook.net/**', r => { paraOMeta.push(r.request().url()); r.abort(); });
  await page.route('**facebook.com/tr**', r => { paraOMeta.push(r.request().url()); r.abort(); });
  await page.route('**wa.me/**', r => r.abort());

  /* 1. Sem pixel, sem aviso de cookies, mesmo com consentimento ja dado no quiz. */
  await page.goto(RAIZ + '/index.html');
  await page.evaluate(() => localStorage.setItem('arete-cookies', 'sim'));
  await page.reload();
  await page.waitForLoadState('load');
  assert.equal(await page.evaluate(() => typeof window.fbq), 'undefined', 'a landing nao pode carregar o pixel');
  assert.equal(paraOMeta.length, 0, 'a landing chamou o Meta: ' + paraOMeta.join(', '));
  assert.equal(await page.locator('#cookies').count(), 0, 'a landing nao deveria ter aviso de cookies');
  assert.equal(await page.locator('script').count(), 0, 'a landing voltou a nao ter JavaScript');
  console.log('ok  1. landing sem pixel, sem aviso e sem JavaScript');

  /* 2. O botao continua abrindo o WhatsApp certo. */
  const href = await page.getAttribute('.price-box a.btn', 'href');
  assert.ok(href.startsWith('https://wa.me/5541997067289'), 'numero errado: ' + href);
  console.log('ok  2. botao da landing abre o WhatsApp 41 99706-7289');

  /* 3. A pagina de privacidade ainda desliga o pixel do quiz. */
  await page.goto(RAIZ + '/privacidade.html');
  await page.click('#revogar');
  assert.equal(await page.evaluate(() => localStorage.getItem('arete-cookies')), 'nao',
    'revogar deveria gravar a recusa que o quiz le');
  await page.goto(RAIZ + '/quiz/index.html');
  assert.equal(await page.evaluate(() => typeof window.fbq), 'undefined', 'quiz deveria respeitar a revogacao');
  console.log('ok  3. revogar na politica desliga o pixel do quiz');

  await browser.close();
  console.log('\n3/3 passou.');
})().catch(e => { console.error('FALHOU:', e.message); process.exit(1); });
