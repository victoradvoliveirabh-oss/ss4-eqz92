// ui.js — estado compartilhado + utilidades e blocos de interface reaproveitados
// por todas as telas (filtro, cadernos, player, desempenho).
import * as storage from './storage.js';
import { SEP, indiceStatus, prepararQuestoes } from './nucleo.js';

export const estado = {
  questoes: [],     // lista completa, já preparada (campos _busca, _esp, _tema, _prova)
  porId: new Map(),
  meta: null,
  progresso: null,  // documento do storage (não mutar)
  status: null,     // índice derivado: { ultima, resolvidas, favoritas, anotadas }
  prefs: {},
};

export const $ = (sel, raiz = document) => raiz.querySelector(sel);
export const $$ = (sel, raiz = document) => [...raiz.querySelectorAll(sel)];

export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export const pct = (x) => `${Math.round((x || 0) * 100)}%`;
export const num = (n) => Number(n || 0).toLocaleString('pt-BR');
export const plural = (n, um, muitos) => `${num(n)} ${n === 1 ? um : muitos}`;

export function fmtData(ts, comHora = false) {
  if (!ts) return '—';
  const d = new Date(ts);
  const s = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  return comHora ? `${s} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : s;
}

export function fmtRelogio(ms) {
  const neg = ms < 0;
  const t = Math.floor(Math.abs(ms) / 1000);
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  const dd = (n) => String(n).padStart(2, '0');
  return `${neg ? '-' : ''}${h ? h + ':' : ''}${dd(m)}:${dd(s)}`;
}

export function fmtDuracao(ms) {
  const min = Math.round((ms || 0) / 60000);
  if (min < 1) return 'menos de 1 min';
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`;
}

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export const partesChave = (k) => String(k).split(SEP);

// ---------------- Carregamento dos dados ----------------

export async function carregarDados() {
  const [questoes, meta] = await Promise.all([
    fetch('data/questoes.json').then((r) => { if (!r.ok) throw new Error('questoes.json'); return r.json(); }),
    fetch('data/meta.json').then((r) => { if (!r.ok) throw new Error('meta.json'); return r.json(); }),
  ]);
  estado.questoes = prepararQuestoes(questoes);
  estado.porId = new Map(questoes.map((q) => [q.id, q]));
  estado.meta = meta;
  await sincronizarProgresso();
}

/** Relê o progresso do storage e recalcula o índice de status. */
export async function sincronizarProgresso() {
  estado.progresso = await storage.carregarProgresso();
  estado.prefs = estado.progresso.preferencias || {};
  estado.status = indiceStatus(estado.progresso);
  return estado.progresso;
}

/** Tentativas registradas para uma questão (mais antiga primeiro). */
export function tentativasDe(id) {
  const r = estado.progresso && estado.progresso.respostas[id];
  return r && Array.isArray(r.t) ? [...r.t].sort((a, b) => a.d - b.d) : [];
}

export const anotacaoDe = (id) => (estado.progresso && estado.progresso.anotacoes[id]) || null;
export const riscadasDe = (id) => (estado.progresso && estado.progresso.riscadas[id]) || [];
export const ehFavorita = (id) => !!(estado.progresso && estado.progresso.favoritos[id]);

// ---------------- Toast ----------------
export function toast(msg, tipo = 'info', ms = 2600) {
  let area = $('#toasts');
  if (!area) { area = document.createElement('div'); area.id = 'toasts'; area.setAttribute('aria-live', 'polite'); document.body.append(area); }
  const el = document.createElement('div');
  el.className = `toast toast-${tipo}`;
  el.textContent = msg;
  area.append(el);
  setTimeout(() => { el.classList.add('saindo'); setTimeout(() => el.remove(), 300); }, ms);
}

// ---------------- Modal ----------------
/** Abre um modal. botoes: [{rotulo, valor, classe}]. Resolve com o valor do botão (ou null ao fechar). */
export function modal({ titulo, corpo = '', botoes = [{ rotulo: 'OK', valor: true, classe: 'btn-primario' }], classe = '', aoAbrir }) {
  return new Promise((resolve) => {
    const fundo = document.createElement('div');
    fundo.className = 'modal-fundo';
    fundo.innerHTML = `<div class="modal ${classe}" role="dialog" aria-modal="true" ${titulo ? 'aria-label="' + esc(titulo) + '"' : ''}>
      ${titulo ? `<h2>${esc(titulo)}</h2>` : ''}
      <div class="modal-corpo">${corpo}</div>
      ${botoes.length ? `<div class="modal-botoes">${botoes.map((b, i) => `<button type="button" class="btn ${b.classe || ''}" data-i="${i}">${esc(b.rotulo)}</button>`).join('')}</div>` : ''}
    </div>`;
    const anterior = document.activeElement;
    const fechar = (valor) => {
      document.removeEventListener('keydown', onTecla);
      fundo.remove();
      if (anterior && anterior.focus) anterior.focus();
      resolve(valor);
    };
    const onTecla = (e) => { if (e.key === 'Escape') { e.preventDefault(); fechar(null); } };
    fundo.addEventListener('click', (e) => {
      if (e.target === fundo) return fechar(null);
      const b = e.target.closest('[data-i]');
      if (b) fechar(botoes[+b.dataset.i].valor);
    });
    document.addEventListener('keydown', onTecla);
    document.body.append(fundo);
    if (aoAbrir) aoAbrir(fundo.querySelector('.modal'), fechar);
    else {
      const alvo = fundo.querySelector('input, textarea, .btn-primario, button');
      if (alvo) alvo.focus();
    }
  });
}

export async function confirmar(mensagem, { titulo = 'Confirmar', ok = 'Confirmar', cancelar = 'Cancelar', perigo = false } = {}) {
  const r = await modal({
    titulo,
    corpo: `<p>${esc(mensagem)}</p>`,
    botoes: [{ rotulo: cancelar, valor: false }, { rotulo: ok, valor: true, classe: perigo ? 'btn-perigo' : 'btn-primario' }],
  });
  return r === true;
}

export async function pedirTexto(titulo, { rotulo = '', valor = '', ok = 'Salvar', dica = '' } = {}) {
  let campo = null;
  const r = await modal({
    titulo,
    corpo: `<div class="campo"><label for="m-txt">${esc(rotulo)}</label>
      <input id="m-txt" type="text" value="${esc(valor)}">
      ${dica ? `<small style="color:var(--tinta-3)">${esc(dica)}</small>` : ''}</div>`,
    botoes: [{ rotulo: 'Cancelar', valor: null }, { rotulo: ok, valor: '@ok', classe: 'btn-primario' }],
    aoAbrir: (m, fechar) => {
      campo = m.querySelector('#m-txt');
      campo.focus(); campo.select();
      campo.addEventListener('keydown', (e) => { if (e.key === 'Enter') fechar('@ok'); });
    },
  });
  return r === '@ok' ? String(campo.value || '').trim() : null;
}

export function abrirImagem(src, alt = '') {
  modal({ corpo: `<img src="${esc(src)}" alt="${esc(alt)}">`, botoes: [], classe: 'modal-img' });
}

export async function copiarTexto(texto) {
  try {
    if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(texto); return true; }
  } catch (e) { /* cai no método antigo */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = texto; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.append(ta); ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch (e) { return false; }
}

// ---------------- Navegação ----------------
export function navegar(hash) {
  if (location.hash === hash) window.dispatchEvent(new HashChangeEvent('hashchange'));
  else location.hash = hash;
}

/**
 * Abre o player com uma lista de ids.
 * modo: 'estudo' (gabarito na hora) | 'prova' (sem gabarito, corrige no fim)
 */
export async function iniciarSessao(ids, { titulo = 'Estudo', modo = 'estudo', indice = 0, cadernoId = null } = {}) {
  if (!ids || !ids.length) { toast('Nenhuma questão para resolver.', 'aviso'); return; }
  await storage.salvarPreferencias({
    sessao: { ids, indice, titulo, modo, cadernoId, respostas: {}, criadaEm: Date.now(), tempoMs: 0 },
  });
  await sincronizarProgresso();
  navegar('#/resolver');
}

// ---------------- Blocos de questão ----------------
export function enunciadoHTML(texto) {
  return String(texto || '')
    .split(/\n\s*\n/)
    .map((p) => `<p>${esc(p.trim()).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

export function referenciaHTML(q, { extra = '' } = {}) {
  const selos = [];
  if (q.anulada) selos.push('<span class="selo selo-anulada">Anulada</span>');
  if (q.imagens && q.imagens.length) selos.push('<span class="selo">com imagem</span>');
  const cod = q.fonte && q.fonte.caderno_codigo ? ` <span class="ref-cod">(cód. ${esc(q.fonte.caderno_codigo)})</span>` : '';
  return `<div class="referencia">
    <div class="ref-principal">${esc(q.referencia)}${cod}</div>
    <div class="ref-detalhes">
      <span class="ref-id">${esc(q.id)}</span>
      ${q.fonte && q.fonte.pagina ? `<span>· pág. ${esc(q.fonte.pagina)} do PDF</span>` : ''}
      ${selos.join(' ')} ${extra}
    </div>
    <div>${classificacaoHTML(q)}</div>
  </div>`;
}

export function classificacaoHTML(q) {
  return `<span class="classif">${esc(q.grande_area)} › ${esc(q.especialidade)} › ${esc(q.tema)}${q.subtema ? ` <span class="subtema">(${esc(q.subtema)})</span>` : ''}</span>`;
}

export function imagensHTML(q) {
  if (!q.imagens || !q.imagens.length) return '';
  return `<div class="imagens">${q.imagens.map((nome, i) => `
    <button type="button" class="imagem-q" data-ampliar="img/${esc(nome)}" aria-label="Ampliar imagem ${i + 1}">
      <img src="img/${esc(nome)}" alt="Imagem ${i + 1} da questão" loading="lazy">
      <span class="imagem-dica">Toque para ampliar</span>
    </button>`).join('')}</div>`;
}

/** Alternativas. opcoes: { selecionada, riscadas, revelar, desabilitar } */
export function alternativasHTML(q, { selecionada = null, riscadas = [], revelar = false, desabilitar = false } = {}) {
  const r = new Set(riscadas);
  return `<ol class="alternativas" role="list">${q.alternativas.map((a) => {
    const cl = ['alt'];
    if (selecionada === a.letra) cl.push('selecionada');
    if (r.has(a.letra)) cl.push('riscada');
    if (revelar && q.gabarito) {
      if (a.letra === q.gabarito) cl.push('correta');
      else if (selecionada === a.letra) cl.push('errada');
    }
    return `<li class="${cl.join(' ')}" data-letra="${a.letra}">
      <button type="button" class="alt-corpo" data-acao="selecionar" ${desabilitar ? 'disabled' : ''} aria-pressed="${selecionada === a.letra}">
        <span class="alt-letra">${a.letra}</span><span class="alt-texto">${esc(a.texto)}</span>
      </button>
      <button type="button" class="alt-riscar" data-acao="riscar" ${desabilitar ? 'disabled' : ''} aria-pressed="${r.has(a.letra)}" aria-label="${r.has(a.letra) ? 'Desfazer risco da' : 'Riscar'} alternativa ${a.letra}" title="Riscar (ou toque longo na alternativa)">
        <span aria-hidden="true">${r.has(a.letra) ? '↺' : '⊘'}</span>
      </button>
    </li>`;
  }).join('')}</ol>`;
}

/** Liga clique/toque longo nas alternativas. Retorna função para desligar. */
export function ligarAlternativas(raiz, { aoSelecionar, aoRiscar }) {
  let timer = null, disparou = false, inicio = null;
  const alvoAlt = (e) => e.target.closest('.alt');
  const cancelar = () => { clearTimeout(timer); timer = null; };
  const onDown = (e) => {
    const botao = e.target.closest('[data-acao="selecionar"]');
    if (!botao || botao.disabled) return;
    disparou = false; inicio = [e.clientX, e.clientY];
    const alt = alvoAlt(e);
    timer = setTimeout(() => {
      disparou = true;
      if (navigator.vibrate) try { navigator.vibrate(15); } catch (x) { /* ignora */ }
      aoRiscar(alt.dataset.letra);
    }, 550);
  };
  const onMove = (e) => { if (timer && inicio && Math.hypot(e.clientX - inicio[0], e.clientY - inicio[1]) > 12) cancelar(); };
  const onClick = (e) => {
    const b = e.target.closest('[data-acao]');
    if (!b || b.disabled || !raiz.contains(b)) return;
    const letra = alvoAlt(e).dataset.letra;
    if (b.dataset.acao === 'selecionar') {
      if (disparou) { disparou = false; return; }
      aoSelecionar(letra);
    } else if (b.dataset.acao === 'riscar') aoRiscar(letra);
  };
  const onCtx = (e) => { if (e.target.closest('.alt-corpo')) e.preventDefault(); };
  raiz.addEventListener('pointerdown', onDown);
  raiz.addEventListener('pointermove', onMove);
  raiz.addEventListener('pointerup', cancelar);
  raiz.addEventListener('pointercancel', cancelar);
  raiz.addEventListener('pointerleave', cancelar);
  raiz.addEventListener('click', onClick);
  raiz.addEventListener('contextmenu', onCtx);
  return () => {
    raiz.removeEventListener('pointerdown', onDown); raiz.removeEventListener('pointermove', onMove);
    raiz.removeEventListener('pointerup', cancelar); raiz.removeEventListener('pointercancel', cancelar);
    raiz.removeEventListener('pointerleave', cancelar); raiz.removeEventListener('click', onClick);
    raiz.removeEventListener('contextmenu', onCtx);
  };
}

/** Item de lista de questão (prévia do filtro, listas de revisão). */
export function itemQuestaoHTML(q, { acao = '', extra = '', ocultarClassif = false } = {}) {
  const st = estado.status;
  const selos = [];
  if (st) {
    const ult = st.ultima.get(q.id);
    if (ult === true) selos.push('<span class="selo selo-certa" title="Última resposta certa">✓ acertou</span>');
    else if (ult === false) selos.push('<span class="selo selo-errada" title="Última resposta errada">✗ errou</span>');
    if (st.favoritas.has(q.id)) selos.push('<span class="selo selo-fav" title="Favorita">★ favorita</span>');
    if (st.anotadas.has(q.id)) selos.push('<span class="selo" title="Tem anotação">anotação</span>');
  }
  if (q.anulada) selos.push('<span class="selo selo-anulada">anulada</span>');
  if (q.imagens && q.imagens.length) selos.push('<span class="selo">imagem</span>');
  const txt = q.enunciado.replace(/\s+/g, ' ');
  return `<li class="item-q">
    <button type="button" class="item-q-botao" ${acao}>
      <span class="item-ref">${esc(q.referencia)}</span>
      ${ocultarClassif ? '' : `<span class="item-classif">${esc(q.grande_area)} › ${esc(q.especialidade)} › ${esc(q.tema)}</span>`}
      <span class="item-txt">${esc(txt.length > 230 ? txt.slice(0, 230) + '…' : txt)}</span>
      <span class="item-selos">${selos.join('')}${extra}</span>
    </button>
  </li>`;
}

// ---------------- Indicadores ----------------
export function barraHTML(fracao, rotulo = '') {
  const p = Math.round((fracao || 0) * 100);
  const nivel = p >= 70 ? 'bom' : p >= 50 ? 'medio' : 'ruim';
  return `<span class="barra" role="img" aria-label="${esc(rotulo)} ${p}%"><span class="barra-preench nivel-${nivel}" style="width:${p}%"></span></span>`;
}

export function anelHTML(fracao, { rotulo = '', tamanho = 104 } = {}) {
  const p = Math.max(0, Math.min(1, fracao || 0));
  const raio = 44, circ = 2 * Math.PI * raio;
  const nivel = p >= 0.7 ? 'var(--marca)' : p >= 0.5 ? '#d19a00' : 'var(--vermelho)';
  return `<div class="anel" style="width:${tamanho}px;height:${tamanho}px" role="img" aria-label="${esc(rotulo)} ${Math.round(p * 100)}%">
    <svg viewBox="0 0 104 104" aria-hidden="true">
      <circle cx="52" cy="52" r="${raio}" fill="none" stroke="var(--linha)" stroke-width="11"></circle>
      <circle cx="52" cy="52" r="${raio}" fill="none" stroke="${nivel}" stroke-width="11" stroke-linecap="round"
        stroke-dasharray="${circ}" stroke-dashoffset="${circ * (1 - p)}"></circle>
    </svg>
    <span class="anel-txt">${Math.round(p * 100)}%</span>
  </div>`;
}

export function kpiHTML(rotulo, valor, nota = '', destaque = false) {
  return `<div class="kpi${destaque ? ' destaque' : ''}">
    <div class="kpi-rotulo">${esc(rotulo)}</div>
    <div class="kpi-valor">${valor}</div>
    ${nota ? `<div class="kpi-nota">${nota}</div>` : ''}
  </div>`;
}

export function vazioHTML(titulo, texto = '', acao = '') {
  return `<div class="vazio"><h3>${esc(titulo)}</h3>${texto ? `<p>${esc(texto)}</p>` : ''}${acao}</div>`;
}

export function cabecalhoHTML(titulo, sub = '', acoes = '') {
  return `<div class="pagina-topo">
    <div><h1>${esc(titulo)}</h1>${sub ? `<p class="sub">${sub}</p>` : ''}</div>
    ${acoes ? `<div class="acoes-topo">${acoes}</div>` : ''}
  </div>`;
}

/** Aviso fixo quando os dados carregados são o conjunto fictício de exemplo. */
export function avisoExemploHTML() {
  if (!estado.meta || !estado.meta.modoExemplo) return '';
  return `<div class="aviso-exemplo">Modo exemplo: as questões carregadas são fictícias, só para testar o app.
    Rode <code>npm run dados</code> depois de colocar os arquivos reais em <code>banco/questoes/</code>.</div>`;
}
