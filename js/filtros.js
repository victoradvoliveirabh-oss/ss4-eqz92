// filtros.js — tela "Filtrar questões": painel facetado em acordeão (esquerda)
// + resumo do resultado e ações de criação de caderno (direita).
//
// A seção de assunto é o coração da tela: árvore Área › Especialidade › Tema com
// caixa em todo nível (marcar um nó vale pela subárvore), busca que varre todos os
// níveis mostrando o caminho completo, e um cartão por seleção no resumo.
import * as ui from './ui.js';
import * as storage from './storage.js';
import {
  SEP, STATUS, ORDENS, filtroVazio, normalizarFiltro, contarCriterios,
  filtrarComFacetas, ordenarQuestoes, normalizar,
  arvoreAssuntos, achatarAssuntos, buscarAssuntos, alternarAssunto,
  assuntoSelecionado, assuntoParcial, partesAssunto,
} from './nucleo.js';

const { esc, num } = ui;

let filtro = filtroVazio();
let ordem = 'prova';
let limite = 0;             // 0 = sem limite
let cadernoEditado = null;  // caderno sendo re-filtrado, se veio de #/filtrar?caderno=id
let abertos = new Set(['busca', 'banca', 'ano', 'assunto', 'historico']);
let expandidos = new Set(); // nós da árvore de assunto abertos
let buscaAssunto = '';
let arvoreGrande = false;   // ⤢ — dá a largura toda para a árvore
let mostrarTodas = false;
let resultado = [];
let contagens = {};
let arvore = [];
let planos = [];
let porChave = new Map();
let el = null;

const PREVIA = 20;
const MAX_BUSCA_ASSUNTO = 60;

export async function renderizar(raiz, params) {
  el = raiz;
  const prefs = ui.estado.prefs || {};
  cadernoEditado = null;
  mostrarTodas = false;

  arvore = arvoreAssuntos(ui.estado.meta);
  planos = achatarAssuntos(arvore);
  porChave = new Map(planos.map((n) => [n.chave, n]));

  const idCaderno = params && params.get('caderno');
  if (idCaderno) {
    const c = (ui.estado.progresso.cadernos || []).find((x) => x.id === idCaderno);
    if (c) {
      cadernoEditado = c;
      filtro = normalizarFiltro(c.filtro);
      ordem = c.ordem || 'prova';
    }
  } else if (params && params.get('novo') !== null) {
    filtro = filtroVazio();
  } else {
    filtro = normalizarFiltro(prefs.ultimoFiltro);
    ordem = prefs.ultimaOrdem || 'prova';
  }
  // abre os ancestrais do que já está marcado, para a seleção ficar visível
  for (const chave of filtro.assuntos) {
    const partes = partesAssunto(chave);
    for (let i = 1; i < partes.length; i++) expandidos.add(partes.slice(0, i).join(SEP));
  }

  el.innerHTML = `
    ${ui.avisoExemploHTML()}
    ${ui.cabecalhoHTML(
      cadernoEditado ? `Editar filtro · ${esc(cadernoEditado.nome)}` : 'Filtrar questões',
      'Monte o recorte que você quer treinar e transforme em um caderno.',
      `<button type="button" class="btn" data-f="limpar">Limpar filtros</button>`
    )}
    <div class="filtro-layout" id="f-layout">
      <div class="painel-filtros">
        <div class="painel-cabeca">
          <h2>Filtros <span class="secao-n" id="f-criterios">0</span></h2>
          <button type="button" class="btn btn-p btn-fantasma" data-f="limpar">Limpar</button>
        </div>
        <div class="painel-corpo" id="f-painel"></div>
      </div>
      <div>
        <div id="f-resultado"></div>
        <div id="f-previa"></div>
      </div>
    </div>`;

  ligar();
  atualizar();
}

export function sair() { el = null; }

// ---------------- Eventos ----------------
function ligar() {
  el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-f]');
    if (!b) return;
    const acao = b.dataset.f;
    if (acao === 'limpar') { filtro = filtroVazio(); buscaAssunto = ''; alterou(); }
    else if (acao === 'expandir') {
      const k = b.dataset.k;
      expandidos.has(k) ? expandidos.delete(k) : expandidos.add(k);
      renderPainel();
    } else if (acao === 'largo') {
      arvoreGrande = !arvoreGrande;
      ui.$('#f-layout', el).classList.toggle('arvore-grande', arvoreGrande);
      renderPainel();
    } else if (acao === 'seg') { filtro[b.dataset.dim] = b.dataset.valor; alterou(); }
    else if (acao === 'tirar-chip') { tirarChip(b.dataset.dim, b.dataset.valor); alterou(); }
    else if (acao === 'tirar-assunto') {
      const no = porChave.get(b.dataset.k);
      if (no) { filtro.assuntos = alternarAssunto(filtro.assuntos, no, porChave); alterou(); }
    } else if (acao === 'limpar-assuntos') { filtro.assuntos = []; alterou(); }
    else if (acao === 'criar') await criarCaderno();
    else if (acao === 'resolver') await resolverAgora('estudo');
    else if (acao === 'prova') await resolverAgora('prova');
    else if (acao === 'ver-tudo') { mostrarTodas = true; renderPrevia(); }
  });

  el.addEventListener('change', (e) => {
    const assunto = e.target.closest('input[data-assunto]');
    if (assunto) {
      const no = porChave.get(assunto.dataset.assunto);
      if (no) { filtro.assuntos = alternarAssunto(filtro.assuntos, no, porChave); alterou(); }
      return;
    }
    const c = e.target.closest('input[type="checkbox"][data-dim]');
    if (c) {
      const { dim, valor } = c.dataset;
      const lista = filtro[dim];
      const i = lista.indexOf(valor);
      if (c.checked && i === -1) lista.push(valor);
      if (!c.checked && i !== -1) lista.splice(i, 1);
      alterou();
      return;
    }
    const ordemSel = e.target.closest('#f-ordem');
    if (ordemSel) { ordem = ordemSel.value; renderResultado(); renderPrevia(); return; }
    const lim = e.target.closest('#f-limite');
    if (lim) { limite = Math.max(0, parseInt(lim.value, 10) || 0); renderResultado(); }
  });

  const aplicarBusca = ui.debounce(() => alterou(), 220);
  el.addEventListener('input', (e) => {
    if (e.target.id === 'f-busca') { filtro.busca = e.target.value; aplicarBusca(); }
    else if (e.target.id === 'f-busca-assunto') { buscaAssunto = e.target.value; renderPainel(); }
    else if (e.target.id === 'f-ano-min') { filtro.anoMin = e.target.value === '' ? null : +e.target.value; aplicarBusca(); }
    else if (e.target.id === 'f-ano-max') { filtro.anoMax = e.target.value === '' ? null : +e.target.value; aplicarBusca(); }
  });

  el.addEventListener('toggle', (e) => {
    const d = e.target.closest('details.secao');
    if (!d) return;
    d.open ? abertos.add(d.dataset.sec) : abertos.delete(d.dataset.sec);
  }, true);
}

function tirarChip(dim, valor) {
  if (dim === 'busca') filtro.busca = '';
  else if (dim === 'anoMin' || dim === 'anoMax') filtro[dim] = null;
  else if (dim === 'imagem') filtro.imagem = 'todas';
  else if (dim === 'anuladas') filtro.anuladas = 'incluir';
  else filtro[dim] = filtro[dim].filter((v) => v !== valor);
}

function alterou() {
  mostrarTodas = false;
  storage.salvarPreferencias({ ultimoFiltro: filtro, ultimaOrdem: ordem });
  atualizar();
}

function atualizar() {
  const r = filtrarComFacetas(ui.estado.questoes, filtro, ui.estado.status);
  resultado = r.resultado;
  contagens = r.contagens;
  renderPainel();
  renderResultado();
  renderPrevia();
  ui.$('#f-criterios', el).textContent = contarCriterios(filtro);
}

const contaAssunto = (chave) => contagens.assuntos[chave] || 0;

// ---------------- Painel de filtros ----------------
function secao(id, titulo, conteudo, n = 0) {
  return `<details class="secao" data-sec="${id}" ${abertos.has(id) ? 'open' : ''}>
    <summary>${esc(titulo)} ${n ? `<span class="secao-n">${n}</span>` : ''}</summary>
    <div class="secao-corpo">${conteudo}</div>
  </details>`;
}

function opcao(dim, valor, rotulo, n) {
  const marcada = filtro[dim].includes(valor);
  return `<label class="opcao${marcada ? ' marcada' : ''}${!n && !marcada ? ' zerada' : ''}">
    <input type="checkbox" data-dim="${dim}" data-valor="${esc(valor)}" ${marcada ? 'checked' : ''}>
    <span class="op-txt">${esc(rotulo)}</span>
    <span class="op-n">${num(n || 0)}</span>
  </label>`;
}

function segmento(dim, opcoes) {
  return `<div class="segmento" role="group">${opcoes.map(([v, r]) =>
    `<button type="button" data-f="seg" data-dim="${dim}" data-valor="${v}" aria-pressed="${filtro[dim] === v}">${esc(r)}</button>`
  ).join('')}</div>`;
}

function renderPainel() {
  const painel = ui.$('#f-painel', el);
  if (!painel) return;
  const scroll = painel.scrollTop;
  const lista = ui.$('#f-arvore', el);
  const scrollArvore = lista ? lista.scrollTop : 0;
  const meta = ui.estado.meta;

  const secBusca = `<div class="busca"><input id="f-busca" type="search" placeholder="palavra no enunciado ou nas alternativas"
      value="${esc(filtro.busca)}" aria-label="Buscar por palavra"></div>
    <small style="color:var(--tinta-3)">Ignora acentos e maiúsculas. Várias palavras = todas precisam aparecer.</small>`;

  const secBanca = meta.bancas.map((b) => opcao('bancas', b.nome, b.nome, contagens.bancas[b.nome])).join('');

  const anos = [...meta.anos].sort((a, b) => b.ano - a.ano);
  const secAno = `<div class="secao-lista">${anos.map((a) => opcao('anos', String(a.ano), String(a.ano), contagens.anos[a.ano])).join('')}</div>
    <div class="linha-campos">
      <div class="campo"><label for="f-ano-min">De</label><input id="f-ano-min" type="number" inputmode="numeric" placeholder="${anos.length ? anos[anos.length - 1].ano : ''}" value="${filtro.anoMin ?? ''}"></div>
      <div class="campo"><label for="f-ano-max">Até</label><input id="f-ano-max" type="number" inputmode="numeric" placeholder="${anos.length ? anos[0].ano : ''}" value="${filtro.anoMax ?? ''}"></div>
    </div>`;

  const secProva = `<div class="secao-lista">${meta.provas.map((p) =>
    opcao('provas', p.chave, `${p.banca} ${p.ciclo || p.ano} · ${p.prova}`, contagens.provas[p.chave])
  ).join('')}</div>`;

  const secHistorico = STATUS.map(([v, r]) => opcao('status', v, r, contarStatus(v))).join('') +
    `<small style="color:var(--tinta-3)">Marcando mais de um, vale qualquer um deles.</small>`;

  const secExtras = `<div class="campo"><label>Questões anuladas</label>
      ${segmento('anuladas', [['incluir', 'Incluir'], ['excluir', 'Esconder'], ['somente', 'Só anuladas']])}</div>
    <div class="campo"><label>Imagem</label>
      ${segmento('imagem', [['todas', 'Tanto faz'], ['com', 'Com imagem'], ['sem', 'Sem imagem']])}</div>`;

  painel.innerHTML =
    secaoAssunto() +
    secao('busca', 'Palavra-chave', secBusca, filtro.busca.trim() ? 1 : 0) +
    secao('banca', 'Banca', secBanca, filtro.bancas.length) +
    secao('ano', 'Ano', secAno, filtro.anos.length + (filtro.anoMin !== null ? 1 : 0) + (filtro.anoMax !== null ? 1 : 0)) +
    secao('prova', 'Prova', secProva, filtro.provas.length) +
    secao('historico', 'Meu histórico', secHistorico, filtro.status.length) +
    secao('extras', 'Outros', secExtras, (filtro.imagem !== 'todas' ? 1 : 0) + (filtro.anuladas !== 'incluir' ? 1 : 0));

  painel.scrollTop = scroll;
  const nova = ui.$('#f-arvore', el);
  if (nova) nova.scrollTop = scrollArvore;
}

/** Contagem por status (dica nas caixas do histórico). */
function contarStatus(v) {
  const s = ui.estado.status;
  if (v === 'favoritas') return [...s.favoritas].filter((id) => ui.estado.porId.has(id)).length;
  if (v === 'anotadas') return [...s.anotadas].filter((id) => ui.estado.porId.has(id)).length;
  if (v === 'nao_resolvidas') return ui.estado.questoes.length - s.resolvidas.size;
  let n = 0;
  for (const [id, certa] of s.ultima) {
    if (!ui.estado.porId.has(id)) continue;
    if (v === 'acertadas' && certa) n++;
    if (v === 'erradas' && !certa) n++;
  }
  return n;
}

// ---------------- Árvore de assuntos ----------------
function secaoAssunto() {
  const buscando = buscaAssunto.trim() !== '';
  const achados = buscando ? buscarAssuntos(planos, buscaAssunto) : [];
  const quantos = buscando ? achados.length : planos.length;

  const corpo = buscando ? listaBuscaHTML(achados) : arvore.map((no) => noHTML(no)).join('');

  return `<details class="secao secao-assunto" data-sec="assunto" ${abertos.has('assunto') ? 'open' : ''}>
    <summary>Matéria / Assunto ${filtro.assuntos.length ? `<span class="secao-n">${filtro.assuntos.length}</span>` : ''}</summary>
    <div class="secao-corpo">
      <div class="arvore-topo">
        <span class="arvore-contador">${num(quantos)} ${quantos === 1 ? 'assunto encontrado' : 'assuntos encontrados'}</span>
        <button type="button" class="btn-largura" data-f="largo" aria-pressed="${arvoreGrande}"
          title="${arvoreGrande ? 'Voltar ao tamanho normal' : 'Alargar a lista de assuntos'}">${arvoreGrande ? '⤡' : '⤢'}</button>
      </div>
      <div class="busca"><input id="f-busca-assunto" type="search" placeholder="busque por um assunto"
        value="${esc(buscaAssunto)}" aria-label="Buscar assunto"></div>
      <div class="arvore" id="f-arvore">${corpo || '<p class="arvore-vazia">Nenhum assunto com esse nome.</p>'}</div>
      ${filtro.assuntos.length ? `<button type="button" class="btn btn-p btn-fantasma" data-f="limpar-assuntos">Limpar assuntos (${filtro.assuntos.length})</button>` : ''}
    </div>
  </details>`;
}

/** Uma linha da árvore (e, se aberta, os filhos logo abaixo — como no Estratégia). */
function noHTML(no) {
  const marcado = assuntoSelecionado(no.chave, filtro.assuntos);
  const parcial = assuntoParcial(no.chave, filtro.assuntos);
  const aberto = expandidos.has(no.chave);
  const n = contaAssunto(no.chave);
  const temFilhos = no.filhos.length > 0;

  return `<div class="arvore-no nivel-${no.nivel}">
    <div class="arvore-linha${marcado ? ' marcada' : ''}${!n && !marcado ? ' zerada' : ''}">
      ${temFilhos
        ? `<button type="button" class="expandir" data-f="expandir" data-k="${esc(no.chave)}"
            aria-expanded="${aberto}" aria-label="${aberto ? 'Recolher' : 'Expandir'} ${esc(no.nome)}">${aberto ? '▾' : '▸'}</button>`
        : '<span class="expandir-vazio" aria-hidden="true"></span>'}
      <label class="opcao">
        <input type="checkbox" data-assunto="${esc(no.chave)}" ${marcado ? 'checked' : ''}
          ${parcial ? 'data-parcial="1"' : ''} aria-label="${esc(no.caminho.join(' / '))}">
        <span class="op-txt">${esc(no.nome)}</span>
        <span class="op-n">${num(n)}</span>
      </label>
    </div>
    ${aberto && temFilhos ? `<div class="arvore-filhos">${no.filhos.map(noHTML).join('')}</div>` : ''}
  </div>`;
}

/** Modo busca: lista plana, com o caminho inteiro embaixo do nome. */
function listaBuscaHTML(achados) {
  const alvo = normalizar(buscaAssunto);
  const mostrar = achados.slice(0, MAX_BUSCA_ASSUNTO);
  const linhas = mostrar.map((no) => {
    const marcado = assuntoSelecionado(no.chave, filtro.assuntos);
    const n = contaAssunto(no.chave);
    return `<div class="arvore-no busca-no">
      <div class="arvore-linha${marcado ? ' marcada' : ''}${!n && !marcado ? ' zerada' : ''}">
        <label class="opcao">
          <input type="checkbox" data-assunto="${esc(no.chave)}" ${marcado ? 'checked' : ''}
            aria-label="${esc(no.caminho.join(' / '))}">
          <span class="op-txt">
            <span class="busca-nome">${destacar(no.nome, alvo)}</span>
            <span class="busca-caminho">${esc(no.caminho.join(' / '))}</span>
          </span>
          <span class="op-n">${num(n)}</span>
        </label>
      </div>
    </div>`;
  }).join('');
  const sobra = achados.length - mostrar.length;
  return linhas + (sobra > 0 ? `<p class="arvore-vazia">+${num(sobra)} assuntos — refine a busca</p>` : '');
}

function destacar(nome, alvo) {
  if (!alvo) return esc(nome);
  const i = normalizar(nome).indexOf(alvo.split(/\s+/)[0]);
  if (i === -1) return esc(nome);
  const fim = i + alvo.split(/\s+/)[0].length;
  return `${esc(nome.slice(0, i))}<mark>${esc(nome.slice(i, fim))}</mark>${esc(nome.slice(fim))}`;
}

// ---------------- Coluna de resultado ----------------
function chipsHTML() {
  const meta = ui.estado.meta;
  const chips = [];
  const add = (dim, valor, rotulo) => chips.push(`<span class="chip">${esc(rotulo)}
    <button type="button" data-f="tirar-chip" data-dim="${dim}" data-valor="${esc(valor)}" aria-label="Remover ${esc(rotulo)}">×</button></span>`);
  if (filtro.busca.trim()) add('busca', '', `"${filtro.busca.trim()}"`);
  filtro.bancas.forEach((v) => add('bancas', v, v));
  filtro.anos.forEach((v) => add('anos', v, v));
  if (filtro.anoMin !== null) add('anoMin', '', `de ${filtro.anoMin}`);
  if (filtro.anoMax !== null) add('anoMax', '', `até ${filtro.anoMax}`);
  filtro.provas.forEach((v) => {
    const p = meta.provas.find((x) => x.chave === v);
    add('provas', v, p ? `${p.banca} ${p.ciclo || p.ano} · ${p.prova}` : v);
  });
  filtro.status.forEach((v) => add('status', v, (STATUS.find(([k]) => k === v) || [, v])[1]));
  if (filtro.imagem !== 'todas') add('imagem', '', filtro.imagem === 'com' ? 'com imagem' : 'sem imagem');
  if (filtro.anuladas !== 'incluir') add('anuladas', '', filtro.anuladas === 'somente' ? 'só anuladas' : 'sem anuladas');
  return chips.length ? `<div class="chips" style="margin-top:12px">${chips.join('')}</div>` : '';
}

/** Um cartão por assunto marcado: contagem + caminho desenhado + × para tirar. */
function cartoesAssuntoHTML() {
  if (!filtro.assuntos.length) return '';
  const cartoes = filtro.assuntos.map((chave) => {
    const no = porChave.get(chave);
    const caminho = no ? no.caminho : partesAssunto(chave);
    const n = contaAssunto(chave);
    return `<div class="cartao-assunto">
      <div class="cartao-assunto-topo">
        <span class="cartao-assunto-n">${num(n)} ${n === 1 ? 'questão em' : 'questões em'}:</span>
        <button type="button" class="btn-x" data-f="tirar-assunto" data-k="${esc(chave)}"
          aria-label="Tirar ${esc(caminho.join(' / '))}">×</button>
      </div>
      <ol class="caminho-assunto">
        ${caminho.map((parte, i) => `<li style="--nivel:${i}">${esc(parte)}</li>`).join('')}
      </ol>
    </div>`;
  }).join('');
  return `<div class="cartoes-assunto">${cartoes}</div>`;
}

function renderResultado() {
  const st = ui.estado.status;
  let resolvidas = 0, acertos = 0, erros = 0;
  for (const q of resultado) {
    if (!st.resolvidas.has(q.id)) continue;
    resolvidas++;
    const u = st.ultima.get(q.id);
    if (u === true) acertos++; else if (u === false) erros++;
  }
  const n = resultado.length;
  const efetivas = limite > 0 ? Math.min(limite, n) : n;

  ui.$('#f-resultado', el).innerHTML = `
    <div class="resultado-topo">
      <div class="resultado-n">${num(n)} <small>${n === 1 ? 'questão encontrada' : 'questões encontradas'}</small></div>
      <div class="resumo-linha">
        <span>${num(n - resolvidas)} nunca resolvidas</span>
        <span>${num(acertos)} acertos na última tentativa</span>
        <span>${num(erros)} erros na última tentativa</span>
      </div>
      ${chipsHTML()}
      ${cartoesAssuntoHTML()}
      <div class="linha-campos" style="margin-top:14px">
        <div class="campo"><label for="f-ordem">Ordem</label>
          <select id="f-ordem">${ORDENS.map(([v, r]) => `<option value="${v}" ${ordem === v ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select>
        </div>
        <div class="campo"><label for="f-limite">Máximo de questões</label>
          <input id="f-limite" type="number" min="0" step="5" placeholder="todas" value="${limite || ''}">
        </div>
      </div>
    </div>
    <div class="acao-flutuante">
      <button type="button" class="btn btn-primario btn-g" data-f="criar" ${n ? '' : 'disabled'}>
        ${cadernoEditado ? 'Salvar caderno' : 'Criar caderno'} (${num(efetivas)})
      </button>
      <button type="button" class="btn" data-f="resolver" ${n ? '' : 'disabled'}>Resolver agora</button>
      <button type="button" class="btn" data-f="prova" ${n ? '' : 'disabled'} title="Sem gabarito na hora; correção no fim">Modo prova</button>
    </div>`;
  marcarParciais();
}

/** Caixa "traço" (indeterminate) nos nós que têm só parte da subárvore marcada. */
function marcarParciais() {
  for (const cx of ui.$$('#f-painel input[data-assunto]', el)) {
    cx.indeterminate = cx.dataset.parcial === '1';
  }
}

function renderPrevia() {
  const alvo = ui.$('#f-previa', el);
  if (!alvo) return;
  if (!resultado.length) {
    alvo.innerHTML = ui.vazioHTML('Nenhuma questão com esses filtros', 'Tire algum critério no painel ao lado.');
    return;
  }
  const lista = ordenarQuestoes(resultado, ordem === 'aleatoria' ? 'prova' : ordem);
  const mostrar = mostrarTodas ? lista.slice(0, 300) : lista.slice(0, PREVIA);
  alvo.innerHTML = `<div class="cartao-cabeca" style="margin-top:18px"><h2>Prévia</h2>
      <span style="color:var(--tinta-3);font-size:.82rem">${num(mostrar.length)} de ${num(lista.length)}</span></div>
    <ul class="lista-q">${mostrar.map((q) => ui.itemQuestaoHTML(q, { acao: `data-abrir="${esc(q.id)}"` })).join('')}</ul>
    ${!mostrarTodas && lista.length > PREVIA ? `<p style="margin-top:12px"><button type="button" class="btn" data-f="ver-tudo">Ver mais</button></p>` : ''}`;

  alvo.querySelectorAll('[data-abrir]').forEach((b) => {
    b.addEventListener('click', () => {
      const ids = lista.map((q) => q.id);
      ui.iniciarSessao(ids, { titulo: 'Questões filtradas', indice: ids.indexOf(b.dataset.abrir) });
    });
  });
}

// ---------------- Ações ----------------
function idsSelecionados() {
  const lista = ordenarQuestoes(resultado, ordem);
  return (limite > 0 ? lista.slice(0, limite) : lista).map((q) => q.id);
}

async function criarCaderno() {
  const ids = idsSelecionados();
  if (!ids.length) return;
  const sugestao = cadernoEditado ? cadernoEditado.nome : sugerirNome();
  const nome = await ui.pedirTexto(cadernoEditado ? 'Salvar caderno' : 'Novo caderno', {
    rotulo: 'Nome do caderno', valor: sugestao, ok: 'Salvar',
    dica: `${num(ids.length)} questões serão congeladas neste caderno.`,
  });
  if (nome === null) return;
  const c = await storage.salvarCaderno({
    id: cadernoEditado ? cadernoEditado.id : undefined,
    nome: nome || sugestao, filtro, ids, ordem, modo: 'estudo',
    indice: cadernoEditado ? Math.min(cadernoEditado.indice || 0, ids.length - 1) : 0,
  });
  await ui.sincronizarProgresso();
  ui.toast('Caderno salvo.', 'ok');
  ui.navegar(`#/cadernos?abrir=${c.id}`);
}

async function resolverAgora(modo) {
  const ids = idsSelecionados();
  await ui.iniciarSessao(ids, {
    titulo: modo === 'prova' ? 'Modo prova' : 'Questões filtradas',
    modo,
  });
}

function sugerirNome() {
  const partes = [];
  if (filtro.bancas.length) partes.push(filtro.bancas.join('/'));
  if (filtro.assuntos.length) {
    partes.push(filtro.assuntos.map((k) => {
      const p = partesAssunto(k);
      return p[p.length - 1];
    }).join(', '));
  }
  if (filtro.anos.length) partes.push(filtro.anos.join('/'));
  if (filtro.status.includes('erradas')) partes.push('erradas');
  if (filtro.busca.trim()) partes.push(`"${filtro.busca.trim()}"`);
  const nome = partes.join(' · ').slice(0, 70);
  return nome || `Caderno de ${ui.fmtData(Date.now())}`;
}
