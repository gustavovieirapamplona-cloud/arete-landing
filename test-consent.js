const { chromium } = require('playwright');
const assert = require('assert');

const URL = 'file:///' + process.argv[2].replace(/\\/g, '/');

async function novaPagina(ctx) {
  const page = await ctx.newPage();
  // Nunca deixa sair request real pro Meta: o pixel do Gustavo ainda nao disparou
  // nenhum evento e um hit de teste apareceria no Gerenciador de Eventos como visita.
  await page.route('**connect.facebook.net/**', r => r.fulfill({
    status: 200, contentType: 'application/javascript',
    body: 'window.__fbScriptCarregado = true;'
  }));
  await page.goto(URL);
  await page.waitForLoadState('domcontentloaded');
  return page;
}

const temFbq = p => p.evaluate(() => typeof window.fbq !== 'undefined');
const bannerVisivel = p => p.locator('#cookies').isVisible();

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

  // 3. Recusa persiste no reload (mesmo contexto = mesmo localStorage).
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

  // 5. Aceite persiste, e o pixel sobe sozinho sem mostrar banner.
  page = await novaPagina(ctx);
  await page.waitForFunction(() => typeof window.fbq !== 'undefined', null, { timeout: 3000 });
  assert.equal(await bannerVisivel(page), false, 'banner nao deveria reaparecer apos aceite');
  console.log('ok  5. aceite persiste na volta');

  // 6. InitiateCheckout dispara no botao do checkout, nao no do topo.
  await page.evaluate(() => { window.__eventos = []; window.fbq = (...a) => window.__eventos.push(a); });
  await page.click('.cta-row .btn');           // botao do topo: so rola a pagina
  await page.click('.js-checkout');            // botao real do checkout
  const eventos = await page.evaluate(() => window.__eventos);
  assert.deepEqual(eventos, [['track', 'InitiateCheckout']],
    'esperado exatamente 1 InitiateCheckout, veio: ' + JSON.stringify(eventos));
  console.log('ok  6. InitiateCheckout so no botao da Hotmart');
  await ctx.close();

  // 7. Pagina de privacidade revoga o consentimento.
  ctx = await browser.newContext();
  page = await novaPagina(ctx);
  await page.click('[data-cookie="sim"]');
  await page.goto(URL.replace('index.html', 'privacidade.html'));
  await page.click('#revogar');
  assert.equal(await page.locator('#feito').isVisible(), true, 'confirmacao de revogacao deveria aparecer');
  page = await novaPagina(ctx);
  assert.equal(await temFbq(page), false, 'pixel deveria ficar desligado apos revogar');
  console.log('ok  7. revogacao na pagina de privacidade funciona');

  await browser.close();
  console.log('\n7/7 passou.');
})().catch(e => { console.error('FALHOU:', e.message); process.exit(1); });
