// Teste do consentimento (LGPD) e do botao de contato.
// Rodar:  NODE_PATH=<node_modules com playwright> node test-consent.js <caminho do index.html>
const { chromium } = require('playwright');
const assert = require('assert');

const URL = 'file:///' + process.argv[2].replace(/\\/g, '/');

async function novaPagina(ctx, query) {
  const page = await ctx.newPage();
  // Nada de request real pra fora durante teste: um hit no pixel apareceria no
  // Gerenciador de Eventos como visita, e abrir o wa.me e barulho a toa.
  await page.route('**connect.facebook.net/**', r => r.fulfill({
    status: 200, contentType: 'application/javascript', body: 'window.__fbStub = true;'
  }));
  await page.route('**wa.me/**', r => r.abort());
  await page.goto(URL + (query || ''));
  await page.waitForLoadState('domcontentloaded');
  return page;
}

const temFbq = p => p.evaluate(() => typeof window.fbq !== 'undefined');
const bannerVisivel = p => p.locator('#cookies').isVisible();
const naoNavegar = p => p.evaluate(() => document.addEventListener('click', e => {
  const a = e.target.closest && e.target.closest('a');
  if (a) e.preventDefault();
}));

(async () => {
  const browser = await chromium.launch();

  // 1. Primeira visita: banner aparece, pixel NAO carrega.
  let ctx = await browser.newContext();
  let page = await novaPagina(ctx);
  assert.equal(await bannerVisivel(page), true, 'banner deveria aparecer na 1a visita');
  assert.equal(await temFbq(page), false, 'pixel NAO pode existir antes do consentimento');
  console.log('ok  1. sem escolha: banner visivel, pixel desligado');

  // 2. Recusar: banner some, pixel continua desligado.
  await page.click('[data-cookie="nao"]');
  assert.equal(await bannerVisivel(page), false, 'banner deveria sumir apos recusar');
  assert.equal(await temFbq(page), false, 'pixel NAO pode carregar apos recusa');
  console.log('ok  2. recusou: pixel segue desligado');

  // 3. Recusa persiste (mesmo contexto = mesmo localStorage).
  page = await novaPagina(ctx);
  assert.equal(await bannerVisivel(page), false, 'banner nao deveria reaparecer apos recusa');
  assert.equal(await temFbq(page), false, 'recusa deveria persistir entre visitas');
  console.log('ok  3. recusa persiste na volta');
  await ctx.close();

  // 4. Aceitar: pixel carrega.
  ctx = await browser.newContext();
  page = await novaPagina(ctx);
  await page.click('[data-cookie="sim"]');
  await page.waitForFunction(() => typeof window.fbq !== 'undefined', null, { timeout: 3000 });
  assert.equal(await bannerVisivel(page), false, 'banner deveria sumir apos aceitar');
  console.log('ok  4. aceitou: pixel carregou');

  // 5. Aceite persiste e o pixel sobe sozinho, sem banner.
  page = await novaPagina(ctx);
  await page.waitForFunction(() => typeof window.fbq !== 'undefined', null, { timeout: 3000 });
  assert.equal(await bannerVisivel(page), false, 'banner nao deveria reaparecer apos aceite');
  console.log('ok  5. aceite persiste na volta');

  // 6. Contact dispara no botao do WhatsApp, nao no do topo.
  await naoNavegar(page);
  await page.evaluate(() => { window.__ev = []; window.fbq = (...a) => window.__ev.push(a); });
  await page.click('.cta-row .btn');   // topo: so rola a pagina
  await page.click('.js-checkout');    // botao real
  assert.deepEqual(await page.evaluate(() => window.__ev), [['track', 'Contact']],
    'esperado exatamente 1 Contact');
  console.log('ok  6. Contact so no botao do WhatsApp');
  await ctx.close();

  // 7. Revogacao na pagina de privacidade desliga o pixel.
  ctx = await browser.newContext();
  page = await novaPagina(ctx);
  await page.click('[data-cookie="sim"]');
  await page.goto(URL.replace('index.html', 'privacidade.html'));
  await page.click('#revogar');
  assert.equal(await page.locator('#feito').isVisible(), true, 'confirmacao deveria aparecer');
  page = await novaPagina(ctx);
  assert.equal(await temFbq(page), false, 'pixel deveria ficar desligado apos revogar');
  console.log('ok  7. revogacao funciona');
  await ctx.close();

  // 8. O botao abre o WhatsApp certo, com a mensagem pronta.
  ctx = await browser.newContext();
  page = await novaPagina(ctx);
  const href = await page.getAttribute('.js-checkout', 'href');
  assert.ok(href.startsWith('https://wa.me/5541984045262'), 'numero errado: ' + href);
  // Nada de new URL() aqui: a const URL la em cima sombreia o construtor global.
  const texto = decodeURIComponent(href.split('text=')[1] || '');
  assert.ok(/Areté/.test(texto), 'mensagem deveria citar o Arete; veio: ' + texto);
  console.log('ok  8. WhatsApp 41 98404-5262 com mensagem pronta');
  await ctx.close();

  await browser.close();
  console.log('\n8/8 passou.');
})().catch(e => { console.error('FALHOU:', e.message); process.exit(1); });
