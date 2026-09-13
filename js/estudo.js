// estudo.js — player de resolução: uma questão por vez, com gabarito na hora
// (modo estudo) ou correção só no fim (modo prova), mapa de questões e ferramentas.
import * as ui from './ui.js';
import * as storage from './storage.js';
import { corrigirSimulado, AREAS } from './nucleo.js';

const { esc, num, pct } = ui;

let sessao = null;      // { ids, indice, titulo, modo, cadernoId, respostas, criadaEm, tempoMs }
let el = null;
let marcada = null;     // letra escolhida na questão atual (ainda não confirmada, no modo estudo)
let revelado = false;   // gabarito visível
let desligarAlts = null;
let cronometro = null;
let inicioTela = 0;
let resultadoProva = null;
let refazendo = false;   // usuário pediu para responder de novo uma questão já respondida

export async function renderizar(raiz) {
  el = raiz;
  sessao = (ui.estado.prefs && ui.estado.prefs.sessao) || null;
  if (!sessao || !Array.isArray(sessao.ids) || !sessao.ids.length) {
    el.innerHTML = ui.vazioHTML('Nenhuma sessão aberta',
      'Escolha um caderno ou monte um filtro para começar a resolver.',
      `<p style="margin-top:14px"><a class="btn btn-primario" href="#/filtrar">Filtrar questões</a>
       <a class="btn" href="#/cadernos">Meus cadernos</a></p>`);
    return;
  }
  sessao.ids = sessao.ids.filter((id) => ui.estado.porId.has(id));
  sessao.indice = Math.min(Math.max(0, sessao.indice || 0), sessao.ids.length - 1);
  sessao.respostas = sessao.respostas || {};
  inicioTela = Date.now();
  iniciarCronometro();
  document.addEventListener('keydown', teclado);
  el.addEventListener('click', onClique);
  desenhar();
}

export function sair() {
  clearInterval(cronometro);
  document.removeEventListener('keydown', teclado);
  if (el) el.removeEventListener('click', onClique);
  if (desligarAlts) { desligarAlts(); desligarAlts = null; }
  if (sessao) salvarSessao();
  el = null;
  resultadoProva = null;
}

const tempoTotal = () => (sessao.tempoMs || 0) + (Date.now() - inicioTela);

const questaoAtual = () => ui.estado.porId.get(sessao.ids[sessao.indice]);

async function salvarSessao(extra = {}) {
  const tempoMs = (sessao.tempoMs || 0) + (Date.now() - inicioTela);
  inicioTela = Date.now();
  sessao = { ...sessao, ...extra, tempoMs };
  await storage.salvarPreferencias({ sessao });
  if (sessao.cadernoId) await storage.atualizarCaderno(sessao.cadernoId, { indice: sessao.indice });
}

function iniciarCronometro() {
  clearInterval(cronometro);
  cronometro = setInterval(() => {
    const alvo = ui.$('#relogio', el);
    if (alvo) alvo.textContent = ui.fmtRelogio(tempoTotal());
  }, 1000);
}

// ---------------- Desenho ----------------
function desenhar() {
  if (desligarAlts) { desligarAlts(); desligarAlts = null; }
  if (resultadoProva) return desenharResultado();
  const q = questaoAtual();
  if (!q) { el.innerHTML = ui.vazioHTML('Questão não encontrada'); return; }

  const tentativas = ui.tentativasDe(q.id);
  const ultima = tentativas.length ? tentativas[tentativas.length - 1] : null;
  const ehProva = sessao.modo === 'prova';

  if (ehProva) {
    marcada = sessao.respostas[q.id] || null;
    revelado = false;
  } else if (!refazendo && marcada === null && ultima) {
    marcada = ultima.m;
    revelado = true;
  }

  const total = sessao.ids.length;
  const andamento = (sessao.indice + 1) / total;
  const anotacao = ui.anotacaoDe(q.id);
  const favorita = ui.ehFavorita(q.id);

  el.innerHTML = `
    <div class="player-topo">
      <span class="player-titulo">${esc(sessao.titulo)}</span>
      <span class="selo">${ehProva ? 'modo prova' : 'modo estudo'}</span>
      <span class="player-progresso">Questão ${sessao.indice + 1} de ${num(total)}</span>
      <span class="relogio" id="relogio">${ui.fmtRelogio(tempoTotal())}</span>
      <button type="button" class="btn btn-p" data-e="encerrar">${ehProva ? 'Finalizar prova' : 'Encerrar'}</button>
      ${ui.barraHTML(andamento, 'Progresso da sessão')}
    </div>

    <div class="player">
      <div>
        <article class="questao">
          ${ui.referenciaHTML(q)}
          <div class="enunciado">${ui.enunciadoHTML(q.enunciado)}</div>
          ${ui.imagensHTML(q)}
          <div id="alts">${ui.alternativasHTML(q, {
            selecionada: marcada, riscadas: ui.riscadasDe(q.id), revelar: revelado,
          })}</div>

          <div class="resposta-acoes">
            ${ehProva
              ? `<button type="button" class="btn" data-e="limpar-marca" ${marcada ? '' : 'disabled'}>Desmarcar</button>
                 <span class="dica-teclado">A–E marca · ← → navega · o gabarito só aparece no fim</span>`
              : revelado
                ? `<button type="button" class="btn btn-primario btn-g" data-e="proxima">${sessao.indice + 1 < total ? 'Próxima questão' : 'Concluir sessão'}</button>
                   <button type="button" class="btn" data-e="refazer">Responder de novo</button>
                   <span class="dica-teclado">Enter vai para a próxima</span>`
                : `<button type="button" class="btn btn-primario btn-g" data-e="responder" ${marcada ? '' : 'disabled'}>Responder</button>
                   <span class="dica-teclado">A–E escolhe · Enter responde · toque longo risca</span>`}
          </div>

          ${revelado ? caixaGabarito(q, ultima, tentativas) : ''}

          <div class="ferramentas">
            <button type="button" class="btn btn-p" data-e="favorito">${favorita ? '★ Favorita' : '☆ Favoritar'}</button>
            <button type="button" class="btn btn-p" data-e="anotar">${anotacao ? '✎ Editar anotação' : '✎ Anotar'}</button>
            <button type="button" class="btn btn-p" data-e="copiar">Copiar referência</button>
            ${tentativas.length ? `<span class="selo" title="Tentativas registradas">${tentativas.length}ª vez</span>` : ''}
          </div>
          ${anotacao ? `<div class="anotacao-area"><label>Sua anotação</label>
            <div class="cartao" style="padding:12px;box-shadow:none">${ui.enunciadoHTML(anotacao.texto)}
            <small style="color:var(--tinta-3)">${ui.fmtData(anotacao.d, true)}</small></div></div>` : ''}

          <div class="navegacao-q">
            <button type="button" class="btn" data-e="anterior" ${sessao.indice ? '' : 'disabled'}>← Anterior</button>
            <button type="button" class="btn" data-e="seguinte" ${sessao.indice + 1 < total ? '' : 'disabled'}>Seguinte →</button>
          </div>
        </article>
      </div>

      <aside class="player-lado">
        <div class="cartao">
          <div class="cartao-cabeca"><h3>Mapa</h3></div>
          <div class="mapa" id="mapa">${mapaHTML()}</div>
          <div class="legenda">
            ${ehProva
              ? '<span><i style="background:var(--azul-claro);border-color:var(--azul)"></i>marcada</span><span><i></i>em branco</span>'
              : '<span><i style="background:var(--marca-clara);border-color:var(--marca)"></i>acertou</span><span><i style="background:var(--vermelho-claro);border-color:var(--vermelho)"></i>errou</span><span><i style="background:var(--ambar-claro);border-color:#e6c99a"></i>anulada</span><span><i></i>em branco</span>'}
          </div>
        </div>
        ${!ehProva ? resumoLateral() : ''}
      </aside>
    </div>`;

  desligarAlts = ui.ligarAlternativas(ui.$('#alts', el), {
    aoSelecionar: selecionar,
    aoRiscar: riscar,
  });
}

function caixaGabarito(q, ultima, tentativas) {
  if (q.anulada || !q.gabarito) {
    return `<div class="gabarito-caixa anulada">
      <div class="gabarito-titulo">Questão anulada pela banca</div>
      <div class="gabarito-linha">Ela não entra nas suas estatísticas de acerto.</div></div>`;
  }
  const acertou = ultima && ultima.m === q.gabarito;
  const historico = tentativas.filter((t) => typeof t.c === 'boolean');
  return `<div class="gabarito-caixa ${acertou ? 'certa' : 'errada'}">
    <div class="gabarito-titulo">${acertou ? '✓ Você acertou' : '✗ Você errou'}</div>
    <div class="gabarito-linha">Gabarito oficial: <b>${esc(q.gabarito)}</b>${ultima && ultima.m ? ` · sua resposta: <b>${esc(ultima.m)}</b>` : ' · você deixou em branco'}</div>
    ${historico.length > 1 ? `<div class="gabarito-linha" style="margin-top:6px">Histórico: ${historico.map((t) => (t.c ? '✓' : '✗')).join(' ')} (${historico.length} tentativas)</div>` : ''}
    <div class="gabarito-linha" style="margin-top:6px">Fonte: ${esc(q.referencia)}${q.fonte && q.fonte.pagina ? ` · pág. ${esc(q.fonte.pagina)}` : ''}</div>
  </div>`;
}

function resumoLateral() {
  const st = ui.estado.status;
  let certas = 0, erradas = 0, feitas = 0;
  for (const id of sessao.ids) {
    if (!st.resolvidas.has(id)) continue;
    feitas++;
    const u = st.ultima.get(id);
    if (u === true) certas++; else if (u === false) erradas++;
  }
  const total = certas + erradas;
  return `<div class="cartao" style="text-align:center">
    <div class="cartao-cabeca"><h3 style="margin:0 auto">Nesta sessão</h3></div>
    ${ui.anelHTML(total ? certas / total : 0, { rotulo: 'Aproveitamento' })}
    <p style="margin:10px 0 0;font-size:.85rem;color:var(--tinta-3)">
      ${num(feitas)} de ${num(sessao.ids.length)} resolvidas<br>${num(certas)} certas · ${num(erradas)} erradas</p>
  </div>`;
}

function mapaHTML() {
  const st = ui.estado.status;
  const ehProva = sessao.modo === 'prova';
  return sessao.ids.map((id, i) => {
    const q = ui.estado.porId.get(id);
    const cl = [];
    if (ehProva) { if (sessao.respostas[id]) cl.push('marcada'); }
    else if (q && q.anulada) { if (st.resolvidas.has(id)) cl.push('neutra'); }
    else {
      const u = st.ultima.get(id);
      if (u === true) cl.push('certa'); else if (u === false) cl.push('errada');
    }
    if (i === sessao.indice) cl.push('atual');
    return `<button type="button" class="${cl.join(' ')}" data-e="ir" data-i="${i}"
      aria-label="Ir para a questão ${i + 1}" aria-current="${i === sessao.indice}">${i + 1}</button>`;
  }).join('');
}

// ---------------- Interação ----------------
async function onClique(e) {
  const b = e.target.closest('[data-e]');
  if (!b) return;
  const acao = b.dataset.e;
  const q = questaoAtual();
  if (acao === 'ir') irPara(+b.dataset.i);
  else if (acao === 'anterior') irPara(sessao.indice - 1);
  else if (acao === 'seguinte' || acao === 'proxima') avancar();
  else if (acao === 'responder') await responder();
  else if (acao === 'refazer') { refazendo = true; revelado = false; marcada = null; desenhar(); }
  else if (acao === 'limpar-marca') { delete sessao.respostas[q.id]; marcada = null; await salvarSessao(); desenhar(); }
  else if (acao === 'encerrar') await encerrar();
  else if (acao === 'favorito') { await storage.definirFavorito(q.id, !ui.ehFavorita(q.id)); await ui.sincronizarProgresso(); desenhar(); }
  else if (acao === 'anotar') await anotar(q);
  else if (acao === 'copiar') {
    const ok = await ui.copiarTexto(`${q.referencia} — ${q.id}`);
    ui.toast(ok ? 'Referência copiada.' : 'Não consegui copiar.', ok ? 'ok' : 'erro');
  } else if (acao === 'erradas-prova') {
    const ids = resultadoProva.itens.filter((i) => i.situacao === 'errada').map((i) => i.id);
    resultadoProva = null;
    await ui.iniciarSessao(ids, { titulo: 'Erros da prova', modo: 'estudo' });
  } else if (acao === 'sair-resultado') {
    resultadoProva = null;
    await storage.salvarPreferencias({ sessao: null });
    ui.navegar('#/desempenho');
  }
}

async function selecionar(letra) {
  const q = questaoAtual();
  if (sessao.modo === 'prova') {
    sessao.respostas[q.id] = sessao.respostas[q.id] === letra ? undefined : letra;
    if (!sessao.respostas[q.id]) delete sessao.respostas[q.id];
    marcada = sessao.respostas[q.id] || null;
    await salvarSessao();
    desenhar();
    return;
  }
  if (revelado) return;
  marcada = marcada === letra ? null : letra;
  desenhar();
}

async function riscar(letra) {
  const q = questaoAtual();
  const atuais = new Set(ui.riscadasDe(q.id));
  atuais.has(letra) ? atuais.delete(letra) : atuais.add(letra);
  await storage.salvarRiscadas(q.id, [...atuais]);
  await ui.sincronizarProgresso();
  desenhar();
}

async function responder() {
  const q = questaoAtual();
  if (!marcada) return;
  const correta = q.anulada || !q.gabarito ? null : marcada === q.gabarito;
  await storage.salvarResposta(q.id, { marcada, correta, modo: 'estudo' });
  await ui.sincronizarProgresso();
  refazendo = false;
  revelado = true;
  desenhar();
  if (correta === true) ui.toast('Acertou!', 'ok', 1400);
}

function irPara(i) {
  if (i < 0 || i >= sessao.ids.length) return;
  sessao.indice = i;
  marcada = null;
  revelado = false;
  refazendo = false;
  salvarSessao();
  desenhar();
  ui.$('.questao', el).scrollIntoView({ block: 'start', behavior: 'smooth' });
}

async function avancar() {
  if (sessao.indice + 1 < sessao.ids.length) return irPara(sessao.indice + 1);
  await encerrar();
}

async function anotar(q) {
  const atual = ui.anotacaoDe(q.id);
  let campo = null;
  const r = await ui.modal({
    titulo: 'Anotação da questão',
    corpo: `<div class="campo"><label for="anot">O que você quer lembrar desta questão?</label>
      <textarea id="anot" rows="6">${esc(atual ? atual.texto : '')}</textarea></div>`,
    botoes: [{ rotulo: 'Cancelar', valor: null }, { rotulo: 'Salvar', valor: '@ok', classe: 'btn-primario' }],
    aoAbrir: (m) => { campo = m.querySelector('#anot'); campo.focus(); },
  });
  if (r !== '@ok') return;
  await storage.salvarAnotacao(q.id, campo.value);
  await ui.sincronizarProgresso();
  desenhar();
}

async function encerrar() {
  if (sessao.modo === 'prova') return finalizarProva();
  const ok = await ui.confirmar('Encerrar esta sessão de estudo? Seu progresso já está salvo.', { ok: 'Encerrar' });
  if (!ok) return;
  await salvarSessao();
  await storage.salvarPreferencias({ sessao: null });
  ui.navegar('#/desempenho');
}

// ---------------- Modo prova ----------------
async function finalizarProva() {
  const emBranco = sessao.ids.filter((id) => !sessao.respostas[id]).length;
  const ok = await ui.confirmar(
    emBranco ? `Finalizar a prova com ${emBranco} ${emBranco === 1 ? 'questão em branco' : 'questões em branco'}?`
             : 'Finalizar e corrigir a prova?',
    { ok: 'Finalizar e corrigir' });
  if (!ok) return;

  const r = corrigirSimulado(ui.estado.porId, sessao.ids, sessao.respostas);
  const agora = Date.now();
  for (const item of r.itens) {
    const q = ui.estado.porId.get(item.id);
    const correta = item.situacao === 'anulada' ? null : item.situacao === 'certa';
    if (item.marcada || item.situacao !== 'branco') {
      await storage.salvarResposta(item.id, { marcada: item.marcada, correta, modo: 'simulado', data: agora });
    }
    void q;
  }
  await storage.registrarSimulado({
    titulo: sessao.titulo, ids: sessao.ids, respostas: sessao.respostas,
    iniciadoEm: sessao.criadaEm, finalizadoEm: agora,
    duracaoMs: tempoTotal(),
    resultado: { total: r.total, validas: r.validas, acertos: r.acertos, erros: r.erros, brancos: r.brancos, anuladas: r.anuladas, nota: r.nota, porArea: r.porArea },
  });
  await storage.salvarPreferencias({ sessao: null });
  await ui.sincronizarProgresso();
  clearInterval(cronometro);
  resultadoProva = r;
  desenharResultado();
}

function desenharResultado() {
  const r = resultadoProva;
  el.innerHTML = `
    ${ui.cabecalhoHTML('Resultado da prova', esc(sessao.titulo))}
    <div class="cartao" style="display:flex;gap:22px;align-items:center;flex-wrap:wrap">
      ${ui.anelHTML(r.nota, { rotulo: 'Nota', tamanho: 128 })}
      <div class="grade grade-4" style="flex:1">
        ${ui.kpiHTML('Acertos', num(r.acertos))}
        ${ui.kpiHTML('Erros', num(r.erros))}
        ${ui.kpiHTML('Em branco', num(r.brancos))}
        ${ui.kpiHTML('Anuladas', num(r.anuladas), 'fora da nota')}
      </div>
    </div>
    <div class="cartao">
      <div class="cartao-cabeca"><h2>Por grande área</h2></div>
      <div class="rolagem-x"><table class="tabela">
        <thead><tr><th>Área</th><th class="num">Questões</th><th class="num">Acertos</th><th>Aproveitamento</th></tr></thead>
        <tbody>${r.porArea.map((a) => `<tr>
          <td>${esc(a.nome)}</td><td class="num">${num(a.total)}</td><td class="num">${num(a.acertos)}</td>
          <td style="min-width:140px">${ui.barraHTML(a.pct, a.nome)} <small>${pct(a.pct)}</small></td>
        </tr>`).join('') || '<tr><td colspan="4">Sem questões válidas.</td></tr>'}</tbody>
      </table></div>
    </div>
    <div class="cartao">
      <div class="cartao-cabeca"><h2>Gabarito</h2></div>
      <div class="rolagem-x"><table class="tabela">
        <thead><tr><th class="num">#</th><th>Questão</th><th>Sua</th><th>Gabarito</th><th>Situação</th></tr></thead>
        <tbody>${r.itens.map((item, i) => {
          const q = ui.estado.porId.get(item.id);
          const rot = { certa: '<span class="selo selo-certa">certa</span>', errada: '<span class="selo selo-errada">errada</span>', branco: '<span class="selo">em branco</span>', anulada: '<span class="selo selo-anulada">anulada</span>' }[item.situacao];
          return `<tr><td class="num">${i + 1}</td><td>${esc(q ? q.referencia : item.id)}</td>
            <td>${esc(item.marcada || '—')}</td><td>${esc(item.gabarito || '—')}</td><td>${rot}</td></tr>`;
        }).join('')}</tbody>
      </table></div>
    </div>
    <div class="acao-flutuante">
      <button type="button" class="btn btn-primario" data-e="erradas-prova" ${r.erros ? '' : 'disabled'}>Revisar os ${num(r.erros)} erros</button>
      <button type="button" class="btn" data-e="sair-resultado">Ir para o desempenho</button>
    </div>`;
  void AREAS;
}

// ---------------- Teclado ----------------
function teclado(e) {
  if (!el || resultadoProva) return;
  const alvo = e.target;
  if (alvo instanceof Element && alvo.matches('input, textarea, select, [contenteditable]')) return;
  if (document.querySelector('.modal-fundo')) return; // há um modal aberto
  const q = questaoAtual();
  if (!q) return;
  const letra = e.key.toUpperCase();
  if (/^[A-E]$/.test(letra) && q.alternativas.some((a) => a.letra === letra)) {
    e.preventDefault(); selecionar(letra); return;
  }
  if (e.key === 'ArrowLeft') { e.preventDefault(); irPara(sessao.indice - 1); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); irPara(sessao.indice + 1); }
  else if (e.key === 'Enter') {
    e.preventDefault();
    if (sessao.modo === 'prova') avancar();
    else if (revelado) avancar();
    else if (marcada) responder();
  }
}
