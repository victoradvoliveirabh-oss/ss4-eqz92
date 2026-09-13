/**
 * storage.js — camada de persistência do progresso da Samanta.
 *
 * Implementação atual: um único documento JSON em localStorage (chave CHAVE).
 * Para trocar por sincronização em nuvem, basta reimplementar ESTE módulo mantendo
 * as mesmas funções exportadas (todas assíncronas, exceto as marcadas "síncrona").
 * Se o localStorage falhar (modo privado, cota, bloqueio), tudo continua funcionando
 * em memória durante a sessão e `statusArmazenamento()` informa o problema.
 *
 * ── Formato do documento de progresso (versao 1) ─────────────────────────────
 * {
 *   versao: 1,
 *   atualizadoEm: <ms epoch>,
 *   respostas:  { [idQuestao]: { t: [ { d: <ms>, m: 'B'|null, c: true|false|null, modo: 'estudo'|'simulado'|'revisao' } ] } },
 *               // c = null quando a questão é anulada/sem gabarito (não entra em estatística)
 *   favoritos:  { [idQuestao]: <ms quando favoritou> },
 *   anotacoes:  { [idQuestao]: { texto: string, d: <ms> } },
 *   riscadas:   { [idQuestao]: ['A','C'] },
 *   cadernos:   [ { id, nome, filtro: <objeto filtro>, ids: [idQuestao], ordem, modo, indice,
 *                   criadoEm, atualizadoEm } ],
 *   simulados:  [ { id, titulo, ids: [...], respostas: {id:'A'}, iniciadoEm, finalizadoEm,
 *                   duracaoMs, limiteMin, resultado: {total, validas, acertos, erros, brancos, anuladas, nota, porArea} } ],
 *   simuladoAtivo: null | { id, titulo, ids, respostas, riscadas, marcadas, indice, iniciadoEm,
 *                           acumuladoMs, retomadoEm, pausado, limiteMin },
 *   preferencias: { tema: 'auto'|'claro'|'escuro', ultimoFiltro: <filtro>, ultimaOrdem: string,
 *                   sessao: { ids, indice, titulo, modo: 'estudo'|'prova', cadernoId,
 *                             respostas: {id:'A'}, criadaEm, tempoMs } | null, ... }
 * }
 *
 * ── Interface ────────────────────────────────────────────────────────────────
 * carregarProgresso()                 → Promise<documento>  (NÃO mutar o objeto retornado)
 * salvarResposta(id, {marcada, correta, modo, data?}) → Promise<void>   acrescenta tentativa
 * listarRespostas()                   → Promise<{[id]: {t:[...]}}>
 * definirFavorito(id, bool)           → Promise<void>
 * salvarAnotacao(id, texto)           → Promise<void>   (texto vazio remove)
 * salvarRiscadas(id, letras[])        → Promise<void>
 * listarCadernos()                    → Promise<caderno[]>
 * salvarCaderno({id?, nome, filtro, ids, ordem, modo, indice}) → Promise<caderno>  (cria ou atualiza por id)
 * atualizarCaderno(id, parcial)       → Promise<caderno|null>  (mexe só nos campos passados)
 * removerCaderno(id)                  → Promise<void>
 * carregarSimuladoAtivo()             → Promise<obj|null>   (legado: a prova em andamento
 * salvarSimuladoAtivo(obj|null)       → Promise<void>        hoje mora em preferencias.sessao)
 * registrarSimulado(sim)              → Promise<void>   adiciona ao histórico
 * listarSimulados()                   → Promise<sim[]>  (mais recente primeiro)
 * removerSimulado(id)                 → Promise<void>
 * carregarPreferencias()              → Promise<obj>
 * salvarPreferencias(parcial)         → Promise<obj>    (merge raso)
 * exportar()                          → Promise<string> JSON completo (backup)
 * importar(json, {modo:'mesclar'|'substituir'}) → Promise<{respostas, favoritos, anotacoes, cadernos, simulados}>
 *                                       lança Error com mensagem em português se o JSON for inválido
 * statusArmazenamento()  (síncrona)   → { persistente: bool, erro: string|null }
 * aoMudar(callback)      (síncrona)   → função para cancelar; chamado após qualquer gravação
 */

const CHAVE = 'samanta-banco-questoes:progresso:v1';

let doc = null;
let persistente = true;
let ultimoErro = null;
const ouvintes = new Set();

export function progressoVazio() {
  return { versao: 1, atualizadoEm: 0, respostas: {}, favoritos: {}, anotacoes: {}, riscadas: {}, cadernos: [], simulados: [], simuladoAtivo: null, preferencias: {} };
}

const ehObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

function sanear(bruto) {
  const base = progressoVazio();
  if (!ehObj(bruto)) return base;
  for (const k of ['respostas', 'favoritos', 'anotacoes', 'riscadas', 'preferencias']) if (ehObj(bruto[k])) base[k] = bruto[k];
  for (const k of ['cadernos', 'simulados']) if (Array.isArray(bruto[k])) base[k] = bruto[k];
  if (ehObj(bruto.simuladoAtivo)) base.simuladoAtivo = bruto.simuladoAtivo;
  base.atualizadoEm = Number(bruto.atualizadoEm) || 0;
  for (const id of Object.keys(base.respostas)) {
    const r = base.respostas[id];
    if (!ehObj(r) || !Array.isArray(r.t)) delete base.respostas[id];
  }
  return base;
}

function garantir() {
  if (doc) return doc;
  let bruto = null;
  try {
    const s = globalThis.localStorage ? globalThis.localStorage.getItem(CHAVE) : null;
    if (!globalThis.localStorage) throw new Error('localStorage indisponível');
    bruto = s ? JSON.parse(s) : null;
  } catch (e) {
    persistente = false;
    ultimoErro = String(e && e.message || e);
  }
  doc = sanear(bruto);
  return doc;
}

function gravar() {
  doc.atualizadoEm = Date.now();
  try {
    globalThis.localStorage.setItem(CHAVE, JSON.stringify(doc));
    persistente = true;
    ultimoErro = null;
  } catch (e) {
    persistente = false;
    ultimoErro = String(e && e.message || e);
  }
  for (const cb of ouvintes) { try { cb(doc); } catch (e) { /* ignora */ } }
}

const novoId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export function statusArmazenamento() {
  garantir();
  return { persistente, erro: ultimoErro };
}

export function aoMudar(cb) {
  ouvintes.add(cb);
  return () => ouvintes.delete(cb);
}

export async function carregarProgresso() {
  return garantir();
}

export async function salvarResposta(id, { marcada = null, correta = null, modo = 'estudo', data = Date.now() } = {}) {
  garantir();
  if (!doc.respostas[id]) doc.respostas[id] = { t: [] };
  doc.respostas[id].t.push({ d: data, m: marcada, c: typeof correta === 'boolean' ? correta : null, modo });
  gravar();
}

export async function listarRespostas() {
  return garantir().respostas;
}

export async function definirFavorito(id, favorito) {
  garantir();
  if (favorito) doc.favoritos[id] = Date.now();
  else delete doc.favoritos[id];
  gravar();
}

export async function salvarAnotacao(id, texto) {
  garantir();
  const t = String(texto || '');
  if (t.trim()) doc.anotacoes[id] = { texto: t, d: Date.now() };
  else delete doc.anotacoes[id];
  gravar();
}

export async function salvarRiscadas(id, letras) {
  garantir();
  if (Array.isArray(letras) && letras.length) doc.riscadas[id] = [...new Set(letras)].sort();
  else delete doc.riscadas[id];
  gravar();
}

export async function listarCadernos() {
  return garantir().cadernos;
}

/**
 * Cria ou atualiza um caderno.
 * Campos: nome, filtro, ids (lista congelada de questões), ordem, modo ('estudo'|'prova'), indice.
 */
export async function salvarCaderno({ id, nome, filtro = null, ids = null, ordem = 'prova', modo = 'estudo', indice = 0 }) {
  garantir();
  const agora = Date.now();
  let c = id ? doc.cadernos.find((x) => x.id === id) : null;
  if (c) Object.assign(c, { nome, filtro, ids, ordem, modo, indice, atualizadoEm: agora });
  else {
    c = { id: novoId(), nome, filtro, ids, ordem, modo, indice, criadoEm: agora, atualizadoEm: agora };
    doc.cadernos.push(c);
  }
  gravar();
  return c;
}

/** Atualiza campos soltos de um caderno (ex.: posição atual). */
export async function atualizarCaderno(id, parcial) {
  garantir();
  const c = doc.cadernos.find((x) => x.id === id);
  if (!c) return null;
  Object.assign(c, parcial, { atualizadoEm: Date.now() });
  gravar();
  return c;
}

export async function removerCaderno(id) {
  garantir();
  doc.cadernos = doc.cadernos.filter((c) => c.id !== id);
  gravar();
}

export async function carregarSimuladoAtivo() {
  return garantir().simuladoAtivo;
}

export async function salvarSimuladoAtivo(sim) {
  garantir();
  doc.simuladoAtivo = sim || null;
  gravar();
}

export async function registrarSimulado(sim) {
  garantir();
  const s = { ...sim, id: sim.id || novoId() };
  doc.simulados = doc.simulados.filter((x) => x.id !== s.id);
  doc.simulados.push(s);
  gravar();
}

export async function listarSimulados() {
  return [...garantir().simulados].sort((a, b) => (b.finalizadoEm || 0) - (a.finalizadoEm || 0));
}

export async function removerSimulado(id) {
  garantir();
  doc.simulados = doc.simulados.filter((x) => x.id !== id);
  gravar();
}

export async function carregarPreferencias() {
  return garantir().preferencias;
}

export async function salvarPreferencias(parcial) {
  garantir();
  doc.preferencias = { ...doc.preferencias, ...parcial };
  gravar();
  return doc.preferencias;
}

export async function exportar() {
  garantir();
  return JSON.stringify({ app: 'samanta-banco-questoes', exportadoEm: new Date().toISOString(), progresso: doc });
}

/** Mescla b em a (retorna novo objeto). Tentativas são unidas sem duplicar (mesmo instante e letra). */
export function mesclarProgresso(a, b) {
  const r = sanear(JSON.parse(JSON.stringify(a)));
  const s = sanear(b);
  for (const [id, resp] of Object.entries(s.respostas)) {
    const alvo = r.respostas[id] || (r.respostas[id] = { t: [] });
    const vistos = new Set(alvo.t.map((x) => `${x.d}|${x.m}`));
    for (const x of resp.t) if (!vistos.has(`${x.d}|${x.m}`)) { alvo.t.push(x); vistos.add(`${x.d}|${x.m}`); }
    alvo.t.sort((x, y) => x.d - y.d);
  }
  for (const [id, v] of Object.entries(s.favoritos)) if (!(id in r.favoritos)) r.favoritos[id] = v;
  for (const [id, v] of Object.entries(s.anotacoes)) {
    if (!r.anotacoes[id] || (v && v.d > r.anotacoes[id].d)) r.anotacoes[id] = v;
  }
  for (const [id, v] of Object.entries(s.riscadas)) if (!r.riscadas[id]) r.riscadas[id] = v;
  const porId = (lista, item) => lista.findIndex((x) => x.id === item.id);
  for (const c of s.cadernos) {
    const i = porId(r.cadernos, c);
    if (i === -1) r.cadernos.push(c);
    else if ((c.atualizadoEm || 0) > (r.cadernos[i].atualizadoEm || 0)) r.cadernos[i] = c;
  }
  for (const sim of s.simulados) if (porId(r.simulados, sim) === -1) r.simulados.push(sim);
  if (!r.simuladoAtivo && s.simuladoAtivo) r.simuladoAtivo = s.simuladoAtivo;
  r.preferencias = { ...s.preferencias, ...r.preferencias };
  return r;
}

export async function importar(json, { modo = 'mesclar' } = {}) {
  garantir();
  let obj;
  try {
    obj = typeof json === 'string' ? JSON.parse(json.trim()) : json;
  } catch (e) {
    throw new Error('O texto colado não é um JSON válido. Copie o backup inteiro, do primeiro "{" ao último "}".');
  }
  const prog = ehObj(obj) && ehObj(obj.progresso) ? obj.progresso : obj;
  if (!ehObj(prog) || !(ehObj(prog.respostas) || Array.isArray(prog.cadernos) || ehObj(prog.favoritos))) {
    throw new Error('Esse JSON não parece um backup deste aplicativo.');
  }
  const limpo = sanear(prog);
  doc = modo === 'substituir' ? limpo : mesclarProgresso(doc, limpo);
  gravar();
  return {
    respostas: Object.values(limpo.respostas).reduce((n, r) => n + r.t.length, 0),
    favoritos: Object.keys(limpo.favoritos).length,
    anotacoes: Object.keys(limpo.anotacoes).length,
    cadernos: limpo.cadernos.length,
    simulados: limpo.simulados.length,
  };
}

/** Só para testes: descarta o cache em memória. */
export function _reiniciarCache() {
  doc = null; persistente = true; ultimoErro = null;
}
