// Teste do quiz. Cobre os quatro criterios de aceite do documento, mais o
// consentimento do pixel e a armadilha do link "como funciona?".
// Rodar:  NODE_PATH=<node_modules com playwright> node test-quiz.js <caminho do quiz/index.html>
const { chromium } = require('playwright');
const assert = require('assert');

const ENDERECO = 'file:///' + process.argv[2].replace(/\\/g, '/');

// Qualquer coisa com cara de dinheiro. "6 perguntas" nao casa; "59,99" casa.
const TEM_PRECO = /\d+[.,]\d{2}|R\$|rea(l|is)\b/i;

async function abrir(browser, { largura = 390, aceitar = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width: largura, height: 844 } });
  const page = await ctx.newPage();
  await page.route('**connect.facebook.net/**', r => r.fulfill({
    status: 200, contentType: 'application/javascript', body: 'window.__fbStub = true;'
  }));
  await page.route('**wa.me/**', r => r.abort());
  await page.route('**chat.whatsapp.com/**', r => r.abort());
  await page.goto(ENDERECO);
  if (aceitar) await page.click('[data-cookie="sim"]');
  return { ctx, page };
}

const toque = (page, texto) => page.getByRole('button', { name: texto, exact: true }).click();
const textoDaTela = page => page.locator('#tela').innerText();

// Nenhum botao pode ficar abaixo da dobra: o documento exige zero rolagem.
async function cabeNaTela(page, onde) {
  const estouro = await page.evaluate(() => {
    const alvos = [...document.querySelectorAll('#tela button, #tela a, #tela input')];
    const fundo = window.innerHeight;
    return alvos
      .map(e => ({ t: e.textContent.trim().slice(0, 30), b: Math.round(e.getBoundingClientRect().bottom) }))
      .filter(x => x.b > fundo);
  });
  assert.equal(estouro.length, 0,
    `${onde}: elemento abaixo da dobra em 390px -> ${JSON.stringify(estouro)}`);
}

(async () => {
  const browser = await chromium.launch();

  /* 1. Caminho do "sim" inteiro sem ver numero antes da tela de preco. */
  {
    const { ctx, page } = await abrir(browser);
    const visto = [];

    await cabeNaTela(page, 'abertura');
    visto.push(await textoDaTela(page));
    await toque(page, 'Começar');

    for (const passo of [
      'Treino e estudo', 'Filosofia', 'Continuar', 'Continuar',
      'Sim, é difícil', 'Sim, entendo', 'Quero'
    ]) {
      visto.push(await textoDaTela(page));
      await cabeNaTela(page, `antes de "${passo}"`);
      await toque(page, passo);
    }

    // Tela 9: fala em taxa, mas nao pode trazer valor nenhum.
    const telaTaxa = await textoDaTela(page);
    visto.push(telaTaxa);
    assert.ok(/taxa/i.test(telaTaxa), 'tela 9 deveria falar da taxa');
    await cabeNaTela(page, 'tela da taxa');

    const vazou = visto.filter(t => TEM_PRECO.test(t));
    assert.equal(vazou.length, 0, 'preco apareceu antes da hora: ' + JSON.stringify(vazou));
    console.log('ok  1. nenhum numero antes da tela 10 (8 telas conferidas)');

    await toque(page, 'Faz sentido');
    const precos = await textoDaTela(page);
    assert.ok(/59,99/.test(precos) && /29,99/.test(precos), 'tela 10 deveria mostrar os valores');
    assert.ok(precos.indexOf('59,99') < precos.indexOf('29,99'), 'o anual tem que vir primeiro (ancora)');
    assert.ok(!/mais popular|recomendado|desconto|oferta|promo/i.test(precos), 'selo proibido na tela de preco');
    console.log('ok  2. tela 10 mostra anual antes do trimestral, sem selo');
    await ctx.close();
  }

  /* 2. Lead dispara exatamente ao chegar no preco, nao antes. */
  {
    const { ctx, page } = await abrir(browser);
    await page.evaluate(() => { window.__ev = []; window.fbq = (...a) => window.__ev.push(a); });
    for (const p of ['Começar', 'Treino e estudo', 'Filosofia', 'Continuar', 'Continuar',
                     'Sim, é difícil', 'Sim, entendo', 'Quero']) await toque(page, p);
    let eventos = await page.evaluate(() => window.__ev.map(e => e[1]));
    assert.ok(!eventos.includes('Lead'), 'Lead nao pode disparar antes da tela de preco');
    await toque(page, 'Faz sentido');
    eventos = await page.evaluate(() => window.__ev.map(e => e[1]));
    assert.equal(eventos.filter(e => e === 'Lead').length, 1, 'esperado 1 Lead na tela de preco');
    assert.ok(eventos.includes('ViewContent'), 'ViewContent deveria ter disparado no Comecar');
    console.log('ok  3. ViewContent no inicio, Lead so na tela de preco');
    await ctx.close();
  }

  /* 3. A mensagem do WhatsApp le como frase de pessoa. */
  {
    const { ctx, page } = await abrir(browser);
    for (const p of ['Começar', 'Treino e estudo', 'Filosofia', 'Estoicismo', 'Continuar', 'Continuar',
                     'Sim, é difícil', 'Sim, entendo', 'Quero', 'Faz sentido']) await toque(page, p);
    await page.getByRole('button', { name: /Anual/ }).click();

    const href = await page.getAttribute('a.acao', 'href');
    assert.ok(href.startsWith('https://wa.me/5541997067289?text='), 'numero errado: ' + href);

    const msg = decodeURIComponent(href.split('text=')[1]);
    assert.ok(msg.startsWith('Olá! Fiz o quiz do site.'), 'primeira linha fixa quebrou: ' + msg);
    assert.equal(msg,
      'Olá! Fiz o quiz do site.\nTreino e estudo\nEstudo filosofia e estoicismo.\nO anual se encaixa pra mim.',
      'mensagem fora do formato:\n' + msg);
    assert.ok(!/[•\-*]|Dados do quiz|utm_|fbclid/i.test(msg), 'mensagem nao pode ter marcador nem rastreio');
    console.log('ok  4. mensagem comeca com a linha fixa e le como pessoa');
    await ctx.close();
  }

  /* 4. Sem tema informado, a linha de temas some. */
  {
    const { ctx, page } = await abrir(browser);
    for (const p of ['Começar', 'Só treino', 'Sim', 'Continuar',
                     'Sim, é difícil', 'Sim, entendo', 'Quero', 'Faz sentido']) await toque(page, p);
    await page.getByRole('button', { name: /Trimestral/ }).click();
    const msg = decodeURIComponent((await page.getAttribute('a.acao', 'href')).split('text=')[1]);
    assert.equal(msg, 'Olá! Fiz o quiz do site.\nSó treino\nO trimestral se encaixa pra mim.',
      'sem tema a linha deveria sumir:\n' + msg);
    console.log('ok  5. sem tema, a linha de temas e omitida');
    await ctx.close();
  }

  /* 5. Todo "nao" termina no grupo gratuito, e nada tenta reverter. */
  {
    const caminhos = [
      ['degrau 1 (duas recusas)', ['Começar', 'Treino e estudo', 'Filosofia', 'Continuar', 'Continuar',
                                   'Não, acho fácil', 'Entendi', 'Nunca procurei']],
      ['degrau 2 (duas recusas)', ['Começar', 'Treino e estudo', 'Filosofia', 'Continuar', 'Continuar',
                                   'Sim, é difícil', 'Não', 'Entendi', 'Mais ou menos']],
      ['degrau 3 (sem segunda chance)', ['Começar', 'Treino e estudo', 'Filosofia', 'Continuar', 'Continuar',
                                         'Sim, é difícil', 'Sim, entendo', 'Não']],
      ['taxa', ['Começar', 'Treino e estudo', 'Filosofia', 'Continuar', 'Continuar',
                'Sim, é difícil', 'Sim, entendo', 'Quero', 'Não']],
      ['preco', ['Começar', 'Treino e estudo', 'Filosofia', 'Continuar', 'Continuar',
                 'Sim, é difícil', 'Sim, entendo', 'Quero', 'Faz sentido', 'Não se encaixa agora']]
    ];

    for (const [nome, passos] of caminhos) {
      const { ctx, page } = await abrir(browser);
      for (const p of passos) await toque(page, p);

      const texto = await textoDaTela(page);
      assert.ok(texto.includes('Tranquilo, sem problema nenhum'), `${nome}: nao terminou no grupo gratuito`);
      assert.ok(!/tem certeza|espera|última chance|desconto|só hoje/i.test(texto), `${nome}: tentou reverter`);

      const links = await page.evaluate(() => [...document.querySelectorAll('#tela a')].map(a => a.href));
      assert.equal(links.length, 1, `${nome}: a saida tem que ter um link so`);
      assert.ok(links[0].includes('chat.whatsapp.com'), `${nome}: link errado -> ${links[0]}`);
      await cabeNaTela(page, `saida do ${nome}`);
      await ctx.close();
    }
    console.log('ok  6. os 5 caminhos de "nao" terminam no grupo gratuito, sem insistencia');
  }

  /* 6. O link "como funciona?" nao pode gastar a retomada de quem nao recusou. */
  {
    const { ctx, page } = await abrir(browser);
    for (const p of ['Começar', 'Treino e estudo', 'Filosofia', 'Continuar', 'Continuar']) await toque(page, p);
    const original = await textoDaTela(page);

    await toque(page, 'como funciona?');
    assert.ok((await textoDaTela(page)).includes('duas salas ativas'), 'o link deveria abrir a explicacao');
    await toque(page, 'Entendi');

    assert.equal(await textoDaTela(page), original,
      'depois do link a pergunta deveria voltar igual, nao reescrita');

    // E a retomada de verdade continua disponivel.
    await toque(page, 'Nunca procurei');
    await toque(page, 'Entendi');
    assert.ok((await textoDaTela(page)).includes('Percebe como é dificil'),
      'a recusa real deveria reescrever a pergunta');
    console.log('ok  7. "como funciona?" nao consome a retomada; a recusa consome');
    await ctx.close();
  }

  /* 7. Pixel so depois do consentimento. */
  {
    const { ctx, page } = await abrir(browser, { aceitar: false });
    assert.equal(await page.evaluate(() => typeof window.fbq !== 'undefined'), false,
      'pixel NAO pode carregar antes do consentimento');
    await cabeNaTela(page, 'abertura com o aviso de cookies aberto');
    await page.click('[data-cookie="nao"]');
    assert.equal(await page.evaluate(() => typeof window.fbq !== 'undefined'), false,
      'pixel NAO pode carregar depois da recusa');
    console.log('ok  8. pixel desligado sem consentimento, inclusive apos recusa');
    await ctx.close();
  }

  /* 8. Ramificacao da tela 3 e a condicional de filosofia. */
  {
    const { ctx, page } = await abrir(browser);
    await toque(page, 'Começar');
    await toque(page, 'Treinava e estudava, mas parei');
    assert.ok((await textoDaTela(page)).includes('E percebe a necessidade de voltar?'), 'pergunta errada pra quem parou');
    await toque(page, 'Sim');
    assert.ok((await textoDaTela(page)).includes('Nosso grupo aborda exatamente isso'), 'ponte errada pra quem parou');
    await toque(page, 'Continuar');
    await toque(page, 'Sim, é difícil');
    assert.ok((await textoDaTela(page)).includes('voltar ao ritmo'), 'degrau 2 deveria usar a redacao de quem parou');
    await ctx.close();

    const b = await abrir(browser);
    await toque(b.page, 'Começar');
    await toque(b.page, 'Só estudo');
    assert.ok((await textoDaTela(b.page)).includes('Boa! Estuda quais temas?'), 'pergunta errada pra quem so estuda');
    await toque(b.page, 'Faculdade');     // sem filosofia nem estoicismo
    await toque(b.page, 'Continuar');
    assert.ok((await textoDaTela(b.page)).includes('E tem interesse em filosofia?'),
      'faltou a tela condicional de interesse em filosofia');
    await toque(b.page, 'Um pouco');
    assert.ok((await textoDaTela(b.page)).includes('Tratamos sobre estes temas no grupo'), 'ponte errada');
    console.log('ok  9. ramificacoes da tela 3, ponte e condicional de filosofia');
    await b.ctx.close();
  }

  await browser.close();
  console.log('\n9/9 passou.');
})().catch(e => { console.error('FALHOU:', e.message); process.exit(1); });
