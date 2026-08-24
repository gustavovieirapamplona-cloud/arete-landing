// Teste do consentimento (LGPD) e do link de checkout.
// Rodar:  NODE_PATH=<node_modules com playwright> node test-consent.js <caminho do index.html>
const { chromium } = require('playwright');
const assert = require('assert');

const URL = 'file:///' + process.argv[2].replace(/\\/g, '/');

async function novaPagina(ctx, query) {
  const page = await ctx.newPage();
  // Nada de request real pra fora durante teste: um hit no pixel apareceria no
  // Gerenciador de Eventos como visita, e um GET no checkout e barulho na Hotmart.
  await page.route('**connect.facebook.net/**', r => r.fulfill({
    status: 200, contentType: 'application/javascript', body: 'window.__fbStub = true;'
  }));
  await page.route('**pay.hotmart.com/**', r => r.abort());
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

  // 6. InitiateCheckout dispara no botao do checkout, nao no do topo.
  await naoNavegar(page);
  await page.evaluate(() => { window.__ev = []; window.fbq = (...a) => window.__ev.push(a); });
  await page.click('.cta-row .btn');   // topo: so rola a pagina
  await page.click('.js-checkout');    // botao real
  assert.deepEqual(await page.evaluate(() => window.__ev), [['track', 'InitiateCheckout']],
    'esperado exatamente 1 InitiateCheckout');
  console.log('ok  6. InitiateCheckout so no botao da Hotmart');
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

  // 8. O botao aponta pra Hotmart e carrega a origem.
  ctx = await browser.newContext();
  page = await novaPagina(ctx);
  let href = await page.getAttribute('.js-checkout', 'href');
  assert.ok(href.startsWith('https://pay.hotmart.com/X107304876S'), 'href errado: ' + href);
  assert.ok(href.endsWith('?src=site'), 'sem origem, esperado src=site; veio: ' + href);
  console.log('ok  8. checkout aponta pra Hotmart com src=site');

  // 9. Origem do anuncio atravessa ate o checkout.
  page = await novaPagina(ctx, '?utm_source=meta');
  href = await page.getAttribute('.js-checkout', 'href');
  assert.ok(href.endsWith('?src=meta'), 'utm_source deveria virar src=meta; veio: ' + href);
  page = await novaPagina(ctx, '?src=bio-instagram');
  href = await page.getAttribute('.js-checkout', 'href');
  assert.ok(href.endsWith('?src=bio-instagram'), 'src deveria passar direto; veio: ' + href);
  console.log('ok  9. origem do anuncio chega no checkout');
  await ctx.close();

  await browser.close();
  console.log('\n9/9 passou.');
})().catch(e => { console.error('FALHOU:', e.message); process.exit(1); });
