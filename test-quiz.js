// Teste do quiz. Cobre os cinco criterios de aceite do documento, mais o
// consentimento do pixel e as ramificacoes.
// Rodar:  NODE_PATH=<node_modules com playwright> node test-quiz.js <caminho do quiz/index.html>
const { chromium } = require('playwright');
const assert = require('assert');
const fs = require('fs');

const ARQUIVO = process.argv[2];
const ENDERECO = 'file:///' + ARQUIVO.replace(/\\/g, '/');

// So dinheiro. "3 chats", "28 dias" e "sabado as 20" sao copy obrigatoria
// com numero e nao podem reprovar o teste; "29,99" e "59,99" tem que reprovar.
const TEM_PRECO = /\d+[.,]\d{2}|R\$|\breais\b/i;

async function abrir(browser, { largura = 390, altura = 844, aceitar = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width: largura, height: altura } });
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

// Nenhum botao de resposta pode ficar abaixo da dobra.
async function cabeNaTela(page, onde) {
  const fora = await page.evaluate(() => {
    const alvos = [...document.querySelectorAll('#tela button, #tela a, #tela input')];
    return alvos
      .map(e => ({ t: e.textContent.trim().slice(0, 28), b: Math.round(e.getBoundingClientRect().bottom) }))
      .filter(x => x.b > window.innerHeight);
  });
  assert.equal(fora.length, 0, `${onde}: abaixo da dobra em 390px -> ${JSON.stringify(fora)}`);
}

const ATE_O_PRECO = ['Começar', 'Faço ambos', 'Filosofia', 'Continuar', 'Com certeza', 'Faz sentido', 'Faz sentido', 'Não'];

(async () => {
  const browser = await chromium.launch();

  /* 1. Nenhum valor antes da tela 8. */
  {
    const { ctx, page } = await abrir(browser);
    const vistos = [];
    for (const passo of ATE_O_PRECO) {
      vistos.push([passo, await textoDaTela(page)]);
      await toque(page, passo);
    }
    const vazou = vistos.filter(([, t]) => TEM_PRECO.test(t)).map(([p]) => p);
    assert.equal(vazou.length, 0, 'valor apareceu antes da tela 8, antes de: ' + vazou.join(', '));

    const preco = await textoDaTela(page);
    assert.ok(/29,99/.test(preco) && /59,99/.test(preco), 'a tela 8 deveria mostrar os dois valores');
    assert.ok(preco.indexOf('29,99') < preco.indexOf('59,99'), 'trimestral vem primeiro, e a ordem em que ele fala');
    assert.ok(!/mais popular|recomendado|desconto|oferta|promo|garantia|vagas/i.test(preco), 'selo proibido');
    console.log('ok  1. nenhum valor nas 8 telas anteriores; tela 8 traz trimestral antes do anual');
    await ctx.close();
  }

  /* 2. "mensal" so onde pode. */
  {
    const fonte = fs.readFileSync(ARQUIVO, 'utf8');
    const permitidos = [
      'Tem plano mensal?',            // a pergunta da duvida
      'Mensal nao fazemos',           // a resposta que diz que nao existe
      'Nos temos uma mensalidade'     // tela 7, texto literal do documento
    ];
    const ocorrencias = [...fonte.matchAll(/mensal\w*/gi)].map(m =>
      fonte.slice(Math.max(0, m.index - 40), m.index + 40).replace(/\s+/g, ' '));
    const proibidas = ocorrencias.filter(c => !permitidos.some(p => c.includes(p)));
    assert.equal(proibidas.length, 0, '"mensal" fora dos lugares permitidos:\n' + proibidas.join('\n'));
    // Lookbehind obrigatorio: 29,99 e 59,99 contem "9,99" como substring.
    assert.ok(!/(?<!\d)9,99/.test(fonte), 'o preco mensal extinto (9,99) nao pode estar no arquivo');
    console.log(`ok  2. "mensal" aparece ${ocorrencias.length}x, todas permitidas; nenhum 9,99`);
  }

  /* 3. Eventos: ViewContent no inicio, Lead so na tela de preco. */
  {
    const { ctx, page } = await abrir(browser);
    await page.evaluate(() => { window.__ev = []; window.fbq = (...a) => window.__ev.push(a); });
    for (const p of ATE_O_PRECO.slice(0, -2)) await toque(page, p);
    let ev = await page.evaluate(() => window.__ev.map(e => e[1]));
    assert.ok(!ev.includes('Lead'), 'Lead nao pode disparar antes de passar pela taxa');
    await toque(page, 'Faz sentido');           // taxa -> tela de duvida
    ev = await page.evaluate(() => window.__ev.map(e => e[1]));
    assert.equal(ev.filter(e => e === 'Lead').length, 1, 'Lead deveria disparar ao passar a taxa');
    await toque(page, 'Não');                   // segue pro preco
    ev = await page.evaluate(() => window.__ev.map(e => e[1]));
    assert.equal(ev.filter(e => e === 'Lead').length, 1, 'Lead nao pode disparar de novo no preco');
    assert.ok(ev.includes('ViewContent'), 'ViewContent deveria disparar no Começar');
    console.log('ok  3. ViewContent no inicio, Lead uma vez so, ao passar a taxa');
    await ctx.close();
  }

  /* 4. A mensagem do WhatsApp le como frase de pessoa. */
  {
    const { ctx, page } = await abrir(browser);
    for (const p of ['Começar', 'Faço ambos', 'Filosofia', 'Teologia', 'Continuar',
                     'Com certeza', 'Faz sentido', 'Faz sentido', 'Não', 'Se encaixa', 'Anual']) await toque(page, p);

    const href = await page.getAttribute('a.acao', 'href');
    assert.ok(href.startsWith('https://wa.me/5541997067289?text='), 'numero errado: ' + href);

    const msg = decodeURIComponent(href.split('text=')[1]);
    assert.ok(msg.startsWith('Olá! Fiz o quiz do site.'), 'primeira linha fixa quebrou: ' + msg);
    assert.equal(msg,
      'Olá! Fiz o quiz do site.\nFaço ambos\nEstudo filosofia e teologia.\nO anual se encaixa pra mim.',
      'mensagem fora do formato:\n' + msg);
    assert.ok(!/[•*]|Dados do quiz|utm_|fbclid/i.test(msg), 'nada de marcador nem rastreio');
    console.log('ok  4. mensagem comeca com a linha fixa e le como pessoa');
    await ctx.close();
  }

  /* 5. Quem nao estuda nao recebe a tela de temas, e a linha some. */
  {
    const { ctx, page } = await abrir(browser);
    await toque(page, 'Começar');
    await toque(page, 'Só treino');
    assert.ok((await textoDaTela(page)).includes('E tem interesse em filosofia?'),
      'quem so treina deveria receber a pergunta de interesse');
    for (const p of ['Um pouco', 'Entendo', 'Faz sentido', 'Faz sentido', 'Não', 'Se encaixa', 'Trimestral']) await toque(page, p);
    const msg = decodeURIComponent((await page.getAttribute('a.acao', 'href')).split('text=')[1]);
    assert.equal(msg, 'Olá! Fiz o quiz do site.\nSó treino\nO trimestral se encaixa pra mim.',
      'sem tema a linha deveria sumir:\n' + msg);
    console.log('ok  5. ramificacao de quem nao estuda, e a linha de temas omitida');
    await ctx.close();
  }

  /* 6. Os tres "nao" terminam no grupo gratuito, sem insistencia. */
  {
    const saidas = [
      ['concordância', ['Começar', 'Faço ambos', 'Filosofia', 'Continuar', 'Não']],
      ['taxa',         ['Começar', 'Faço ambos', 'Filosofia', 'Continuar', 'Com certeza', 'Faz sentido', 'Não']],
      ['preço',        ['Começar', 'Faço ambos', 'Filosofia', 'Continuar', 'Com certeza', 'Faz sentido', 'Faz sentido', 'Não', 'Não se encaixa agora']]
    ];
    for (const [nome, passos] of saidas) {
      const { ctx, page } = await abrir(browser);
      for (const p of passos) await toque(page, p);
      const t = await textoDaTela(page);
      assert.ok(t.includes('Tranquilo, sem problema nenhum'), `${nome}: nao terminou no grupo gratuito`);
      assert.ok(!/tem certeza|espera|última chance|desconto|só hoje|vagas/i.test(t), `${nome}: tentou reverter`);
      const links = await page.evaluate(() => [...document.querySelectorAll('#tela a')].map(a => a.href));
      assert.equal(links.length, 1, `${nome}: a saida tem que ter um link so`);
      assert.ok(links[0].includes('chat.whatsapp.com'), `${nome}: link errado -> ${links[0]}`);
      await cabeNaTela(page, `saida do ${nome}`);
      await ctx.close();
    }
    console.log('ok  6. as 3 saidas de "nao" caem no grupo gratuito, sem insistencia');
  }

  /* 7. "Mais ou menos" segue em frente: a explicacao e a resposta. */
  {
    const { ctx, page } = await abrir(browser);
    for (const p of ['Começar', 'Faço ambos', 'Filosofia', 'Continuar', 'Mais ou menos']) await toque(page, p);
    assert.ok((await textoDaTela(page)).includes('Na nossa comunidade temos 3 chats'),
      '"Mais ou menos" deveria seguir pra explicacao, nao sair');
    console.log('ok  7. "Mais ou menos" segue pra explicacao');
    await ctx.close();
  }

  /* 8. A tela de duvidas tem as cinco e volta pra taxa. */
  {
    const { ctx, page } = await abrir(browser);
    for (const p of ['Começar', 'Faço ambos', 'Filosofia', 'Continuar', 'Com certeza']) await toque(page, p);
    await toque(page, 'Tenho uma dúvida');
    const t = await textoDaTela(page);
    for (const q of ['Tem plano mensal?', 'Os debates têm horário fixo?', 'Quem está por trás?',
                     'O grupo é ativo mesmo?', 'Onde vejo mais de vocês?']) {
      assert.ok(t.includes(q), 'faltou a duvida: ' + q);
    }
    assert.ok(!TEM_PRECO.test(t), 'a tela de duvidas nao pode trazer valor');
    await toque(page, 'Entendi');
    assert.ok((await textoDaTela(page)).includes('Faz sentido para voce?'), '"Entendi" deveria levar a tela da taxa');
    console.log('ok  8. 5 duvidas presentes, sem valor, e "Entendi" leva a taxa');
    await ctx.close();
  }

  /* 8b. "Ficou com alguma dúvida?" -> Sim manda pro WhatsApp, sem ver preco. */
  {
    const { ctx, page } = await abrir(browser);
    for (const p of ['Começar', 'Faço ambos', 'Filosofia', 'Continuar',
                     'Com certeza', 'Faz sentido', 'Faz sentido']) await toque(page, p);
    assert.ok((await textoDaTela(page)).includes('Ficou com alguma dúvida?'),
      'a tela de duvida deveria vir logo depois da taxa');

    await toque(page, 'Sim');
    const t = await textoDaTela(page);
    assert.ok(!TEM_PRECO.test(t), 'quem sai com duvida nao pode ver valor');
    assert.ok(t.includes('Me chama no WhatsApp que eu te respondo.'), 'texto errado pra quem tem duvida');

    const msg = decodeURIComponent((await page.getAttribute('a.acao', 'href')).split('text=')[1]);
    assert.equal(msg, 'Olá! Fiz o quiz do site.\nFaço ambos\nEstudo filosofia.\nFiquei com uma dúvida.',
      'mensagem da duvida fora do formato:\n' + msg);
    await cabeNaTela(page, 'whatsapp da duvida');
    console.log('ok 8b. "Sim" na duvida vai pro WhatsApp sem ver preco, com a mensagem certa');
    await ctx.close();
  }

  /* 9. Pixel so depois do consentimento. */
  {
    const { ctx, page } = await abrir(browser, { aceitar: false });
    assert.equal(await page.evaluate(() => typeof window.fbq !== 'undefined'), false,
      'pixel NAO pode carregar antes do consentimento');
    await cabeNaTela(page, 'abertura com o aviso aberto');
    await page.click('[data-cookie="nao"]');
    assert.equal(await page.evaluate(() => typeof window.fbq !== 'undefined'), false,
      'pixel NAO pode carregar depois da recusa');
    console.log('ok  9. pixel desligado sem consentimento, inclusive apos recusa');
    await ctx.close();
  }

  /* 10. Dobra de 390px: nenhuma tela do caminho principal pode rolar. */
  {
    const { ctx, page } = await abrir(browser);
    // Par explicito tela->acao: clicar num chip NAO troca de tela, entao
    // listas paralelas saem do lugar e reportam a tela errada.
    const passos = [
      ['abertura',     'Começar'],
      ['perfil',       'Faço ambos'],
      ['temas',        'Filosofia'],     // chip: continua na mesma tela
      ['temas',        'Continuar'],
      ['concordância', 'Com certeza'],
      ['como funciona','Faz sentido'],
      ['taxa',         'Faz sentido'],
      ['ficou dúvida', 'Não'],
      ['preço',        'Se encaixa']
    ];
    const alturas = {};
    for (const [nome, acao] of passos) {
      alturas[nome] = await page.evaluate(() => document.documentElement.scrollHeight);
      await cabeNaTela(page, nome);
      await toque(page, acao);
    }
    alturas['qual plano'] = await page.evaluate(() => document.documentElement.scrollHeight);
    await cabeNaTela(page, 'qual plano');

    const rolam = Object.entries(alturas).filter(([, h]) => h > 844).map(([n, h]) => `${n} ${h}px`);
    assert.equal(rolam.length, 0, 'tela rolando em 390x844: ' + rolam.join(', '));
    console.log('ok 10. nenhuma das 10 telas rola em 390x844');
    await ctx.close();
  }

  await browser.close();
  console.log('\n11/11 passou.');
})().catch(e => { console.error('FALHOU:', e.message); process.exit(1); });
