// Funções puras (sem DOM): filtragem, facetas, revisão espaçada, estatísticas, simulado.
// Testáveis em Node: node scripts/test.mjs

export const AREAS = ['Clínica Médica', 'Cirurgia', 'Ginecologia e Obstetrícia', 'Pediatria', 'Medicina Preventiva e Social'];
export const INTERVALOS_REVISAO = [1, 3, 7, 15]; // dias
export const DIA = 86400000;
export const SEP = '||';

export const STATUS = [
  ['nao_resolvidas', 'Não resolvidas'],
  ['erradas', 'Erradas'],
  ['acertadas', 'Acertadas'],
  ['favoritas', 'Favoritas'],
  ['anotadas', 'Com anotação'],
];

export function normalizar(txt) {
  return String(txt ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function chaveProva(q) {
  return `${q.banca}${SEP}${q.ano}${SEP}${q.prova || ''}`;
}

/** Acrescenta campos derivados (prefixo _) usados pela filtragem. Muta e retorna a lista. */
export function prepararQuestoes(lista) {
  for (const q of lista) {
    q._esp = q.grande_area + SEP + q.especialidade;
    q._tema = q._esp + SEP + q.tema;
    // chaves de assunto do nó e de todos os seus ancestrais (área, especialidade, tema)
    q._chaves = [q.grande_area, q._esp, q._tema];
    q._prova = chaveProva(q);
    q._busca = normalizar([q.id, q.enunciado, ...(q.alternativas || []).map((a) => a.texto)].join(' \n '));
  }
  return lista;
}

export function filtroVazio() {
  return { bancas: [], anos: [], anoMin: null, anoMax: null, provas: [], assuntos: [], imagem: 'todas', anuladas: 'incluir', status: [], busca: '' };
}

export function normalizarFiltro(f) {
  const base = filtroVazio();
  if (!f || typeof f !== 'object') return base;
  for (const k of Object.keys(base)) {
    if (Array.isArray(base[k])) base[k] = Array.isArray(f[k]) ? [...f[k]] : [];
    else if (f[k] !== undefined) base[k] = f[k];
  }
  if (!['todas', 'com', 'sem'].includes(base.imagem)) base.imagem = 'todas';
  if (!['incluir', 'excluir', 'somente'].includes(base.anuladas)) base.anuladas = 'incluir';
  base.anoMin = Number.isInteger(+base.anoMin) && base.anoMin !== null && base.anoMin !== '' ? +base.anoMin : null;
  base.anoMax = Number.isInteger(+base.anoMax) && base.anoMax !== null && base.anoMax !== '' ? +base.anoMax : null;
  base.busca = typeof base.busca === 'string' ? base.busca : '';
  // compatibilidade com filtros salvos antes de 'assuntos' (áreas/especialidades/temas separados)
  for (const k of ['areas', 'especialidades', 'temas']) {
    if (Array.isArray(f[k])) for (const v of f[k]) if (!base.assuntos.includes(v)) base.assuntos.push(v);
  }
  base.assuntos = enxugarAssuntos(base.assuntos);
  return base;
}

export function filtroEstaVazio(f) {
  const n = normalizarFiltro(f);
  const v = filtroVazio();
  return JSON.stringify(n) === JSON.stringify(v);
}

/**
 * Assunto é uma chave hierárquica: 'Área', 'Área||Especialidade' ou 'Área||Especialidade||Tema'.
 * Selecionar um nó vale por toda a subárvore abaixo dele.
 */
export function ehDescendente(chave, ancestral) {
  return chave === ancestral || chave.startsWith(ancestral + SEP);
}

/** Remove duplicatas e descendentes já cobertos por um ancestral selecionado. */
export function enxugarAssuntos(lista) {
  const unicos = [...new Set(lista.filter((k) => typeof k === 'string' && k))];
  return unicos.filter((k) => !unicos.some((outro) => outro !== k && ehDescendente(k, outro)));
}

/** Partes de uma chave de assunto: ['Área', 'Especialidade', 'Tema'] (o que existir). */
export const partesAssunto = (chave) => String(chave).split(SEP);

/** Conta critérios ativos (para exibir no botão). */
export function contarCriterios(f) {
  const n = normalizarFiltro(f);
  let c = 0;
  for (const k of ['bancas', 'anos', 'provas', 'assuntos', 'status']) c += n[k].length;
  if (n.anoMin !== null) c++;
  if (n.anoMax !== null) c++;
  if (n.imagem !== 'todas') c++;
  if (n.anuladas !== 'incluir') c++;
  if (n.busca.trim()) c++;
  return c;
}

/**
 * Índice de status por questão a partir do progresso.
 * ultima[id] = true/false (última tentativa avaliada), resolvidas = Set de ids com qualquer tentativa.
 */
export function indiceStatus(progresso) {
  const ultima = new Map();
  const resolvidas = new Set();
  const respostas = (progresso && progresso.respostas) || {};
  for (const id of Object.keys(respostas)) {
    const t = respostas[id].t || [];
    if (!t.length) continue;
    resolvidas.add(id);
    let ult = null, dUlt = -Infinity;
    for (const x of t) if (typeof x.c === 'boolean' && x.d >= dUlt) { dUlt = x.d; ult = x.c; }
    if (ult !== null) ultima.set(id, ult);
  }
  const favoritas = new Set(Object.keys((progresso && progresso.favoritos) || {}));
  const anotadas = new Set(Object.entries((progresso && progresso.anotacoes) || {}).filter(([, a]) => a && String(a.texto || '').trim()).map(([id]) => id));
  return { ultima, resolvidas, favoritas, anotadas };
}

function compilar(filtro, status) {
  const f = normalizarFiltro(filtro);
  const setOuNull = (arr) => (arr.length ? new Set(arr) : null);
  const bancas = setOuNull(f.bancas);
  const anos = setOuNull(f.anos.map(Number));
  const provas = setOuNull(f.provas);
  const assuntos = setOuNull(f.assuntos);
  const palavras = normalizar(f.busca).split(/\s+/).filter(Boolean);
  const st = f.status.length ? new Set(f.status) : null;
  const idx = status || { ultima: new Map(), resolvidas: new Set(), favoritas: new Set(), anotadas: new Set() };

  const base = (q) => {
    if (f.imagem === 'com' && !(q.imagens && q.imagens.length)) return false;
    if (f.imagem === 'sem' && q.imagens && q.imagens.length) return false;
    if (f.anuladas === 'excluir' && q.anulada) return false;
    if (f.anuladas === 'somente' && !q.anulada) return false;
    if (palavras.length) for (const p of palavras) if (!q._busca.includes(p)) return false;
    if (st) {
      let ok = false;
      if (st.has('nao_resolvidas') && !idx.resolvidas.has(q.id)) ok = true;
      else if (st.has('erradas') && idx.ultima.get(q.id) === false) ok = true;
      else if (st.has('acertadas') && idx.ultima.get(q.id) === true) ok = true;
      else if (st.has('favoritas') && idx.favoritas.has(q.id)) ok = true;
      else if (st.has('anotadas') && idx.anotadas.has(q.id)) ok = true;
      if (!ok) return false;
    }
    return true;
  };
  return {
    base,
    banca: (q) => !bancas || bancas.has(q.banca),
    ano: (q) => (!anos || anos.has(q.ano)) && (f.anoMin === null || q.ano >= f.anoMin) && (f.anoMax === null || q.ano <= f.anoMax),
    prova: (q) => !provas || provas.has(q._prova),
    assunto: (q) => !assuntos || q._chaves.some((k) => assuntos.has(k)),
  };
}

export function filtrar(questoes, filtro, status) {
  const c = compilar(filtro, status);
  return questoes.filter((q) => c.base(q) && c.banca(q) && c.ano(q) && c.prova(q) && c.assunto(q));
}

/**
 * Filtra e calcula contagens por faceta. Cada faceta é contada ignorando o próprio critério:
 * o número ao lado de uma opção é quantas questões existem nela com os OUTROS filtros aplicados.
 * Em 'assuntos', cada questão soma para o seu tema, sua especialidade e sua área.
 */
export function filtrarComFacetas(questoes, filtro, status) {
  const c = compilar(filtro, status);
  const cont = { bancas: {}, anos: {}, provas: {}, assuntos: {} };
  const inc = (o, k) => { o[k] = (o[k] || 0) + 1; };
  const resultado = [];
  for (const q of questoes) {
    if (!c.base(q)) continue;
    const b = c.banca(q), a = c.ano(q), p = c.prova(q), s = c.assunto(q);
    if (a && p && s) inc(cont.bancas, q.banca);
    if (b && p && s) inc(cont.anos, q.ano);
    if (b && a && s) inc(cont.provas, q._prova);
    if (b && a && p) for (const k of q._chaves) inc(cont.assuntos, k);
    if (b && a && p && s) resultado.push(q);
  }
  return { resultado, contagens: cont };
}

// ---------------- Revisão espaçada ----------------

/**
 * Estado de revisão de uma questão derivado só do histórico de tentativas (sem armazenamento extra).
 * Errou → etapa 0, volta em 1 dia. Acertou na data devida (ou depois) → avança: 3, 7, 15 dias.
 * Acertar a 4ª revisão (após 15 dias) conclui. Acerto antes da data não altera. Novo erro reinicia.
 */
export function estadoRevisao(tentativas) {
  const t = (tentativas || []).filter((x) => typeof x.c === 'boolean').sort((a, b) => a.d - b.d);
  let ativa = false, etapa = 0, proxima = null, concluida = false;
  for (const x of t) {
    if (x.c === false) {
      ativa = true; concluida = false; etapa = 0; proxima = inicioDoDia(x.d) + INTERVALOS_REVISAO[0] * DIA;
    } else if (ativa && x.d >= proxima) {
      etapa++;
      if (etapa >= INTERVALOS_REVISAO.length) { ativa = false; concluida = true; proxima = null; }
      else proxima = inicioDoDia(x.d) + INTERVALOS_REVISAO[etapa] * DIA;
    }
  }
  return { ativa, etapa, proxima, concluida };
}

export function inicioDoDia(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Listas para a tela de revisão. idsValidos (Set) restringe às questões existentes. */
export function listasRevisao(progresso, agora = Date.now(), idsValidos = null) {
  const devidas = [], agendadas = [], erradasUltima = [], jaErradas = [];
  const respostas = (progresso && progresso.respostas) || {};
  for (const id of Object.keys(respostas)) {
    if (idsValidos && !idsValidos.has(id)) continue;
    const t = respostas[id].t || [];
    const avaliadas = t.filter((x) => typeof x.c === 'boolean').sort((a, b) => a.d - b.d);
    if (!avaliadas.length) continue;
    if (avaliadas.some((x) => !x.c)) jaErradas.push(id);
    if (avaliadas[avaliadas.length - 1].c === false) erradasUltima.push(id);
    const r = estadoRevisao(avaliadas);
    if (r.ativa) {
      if (r.proxima <= agora) devidas.push({ id, ...r });
      else agendadas.push({ id, ...r });
    }
  }
  devidas.sort((a, b) => a.proxima - b.proxima);
  agendadas.sort((a, b) => a.proxima - b.proxima);
  return { devidas, agendadas, erradasUltima, jaErradas };
}

// ---------------- Estatísticas ----------------

/**
 * @param {Map<string,object>} porId  questões por id
 * @param {object} progresso
 * @param {{modo?: 'todas'|'primeira'|'ultima', agora?: number}} opcoes
 */
export function estatisticas(porId, progresso, { modo = 'todas' } = {}) {
  const respostas = (progresso && progresso.respostas) || {};
  const tent = []; // {q, c, d}
  let questoesResolvidas = 0;
  for (const id of Object.keys(respostas)) {
    const q = porId.get(id);
    if (!q) continue;
    const t = (respostas[id].t || []).filter((x) => typeof x.c === 'boolean').sort((a, b) => a.d - b.d);
    if (!t.length) continue;
    questoesResolvidas++;
    const escolhidas = modo === 'primeira' ? [t[0]] : modo === 'ultima' ? [t[t.length - 1]] : t;
    for (const x of escolhidas) tent.push({ q, c: x.c, d: x.d });
  }
  const agrupar = (chave, rotulo) => {
    const m = new Map();
    for (const x of tent) {
      const k = chave(x.q);
      if (!m.has(k)) m.set(k, { chave: k, ...rotulo(x.q), total: 0, acertos: 0 });
      const g = m.get(k); g.total++; if (x.c) g.acertos++;
    }
    return [...m.values()].map((g) => ({ ...g, erros: g.total - g.acertos, pct: g.total ? g.acertos / g.total : 0 }));
  };
  const acertos = tent.filter((x) => x.c).length;
  const porArea = agrupar((q) => q.grande_area, (q) => ({ nome: q.grande_area })).sort((a, b) => AREAS.indexOf(a.nome) - AREAS.indexOf(b.nome));
  const porEspecialidade = agrupar((q) => q._esp || q.grande_area + SEP + q.especialidade, (q) => ({ nome: q.especialidade, area: q.grande_area })).sort((a, b) => b.total - a.total);
  const porBanca = agrupar((q) => q.banca, (q) => ({ nome: q.banca })).sort((a, b) => a.nome.localeCompare(b.nome));
  const porAno = agrupar((q) => q.ano, (q) => ({ nome: String(q.ano) })).sort((a, b) => a.chave - b.chave);
  const porTema = agrupar((q) => q._tema || [q.grande_area, q.especialidade, q.tema].join(SEP), (q) => ({ nome: q.tema, especialidade: q.especialidade, area: q.grande_area }));
  const temasMaisErrados = porTema.filter((g) => g.erros > 0).sort((a, b) => b.erros - a.erros || a.pct - b.pct || b.total - a.total);

  return {
    totalRespostas: tent.length,
    questoesResolvidas,
    acertos,
    erros: tent.length - acertos,
    pct: tent.length ? acertos / tent.length : 0,
    porArea, porEspecialidade, porBanca, porAno, porTema, temasMaisErrados,
    evolucao: evolucao(tent),
  };
}

/** Agrupa tentativas por dia (período ≤ 45 dias) ou por semana (segunda-feira). */
export function evolucao(tent) {
  if (!tent.length) return { unidade: 'dia', pontos: [] };
  const ds = tent.map((x) => x.d);
  const min = Math.min(...ds), max = Math.max(...ds);
  const unidade = max - min <= 45 * DIA ? 'dia' : 'semana';
  const chave = (ts) => {
    const d = new Date(inicioDoDia(ts));
    if (unidade === 'semana') { const dow = (d.getDay() + 6) % 7; d.setDate(d.getDate() - dow); }
    return d.getTime();
  };
  const m = new Map();
  for (const x of tent) {
    const k = chave(x.d);
    if (!m.has(k)) m.set(k, { inicio: k, total: 0, acertos: 0 });
    const g = m.get(k); g.total++; if (x.c) g.acertos++;
  }
  return { unidade, pontos: [...m.values()].sort((a, b) => a.inicio - b.inicio).map((g) => ({ ...g, pct: g.acertos / g.total })) };
}

// ---------------- Simulado ----------------

export function embaralhar(lista, rng = Math.random) {
  const a = [...lista];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

export function questoesDaProva(questoes, chave) {
  return questoes.filter((q) => (q._prova || chaveProva(q)) === chave).sort((a, b) => a.numero - b.numero);
}

/** Corrige um simulado. respostas = { id: 'A' }. */
export function corrigirSimulado(porId, ids, respostas) {
  let acertos = 0, erros = 0, brancos = 0, anuladas = 0, validas = 0;
  const areas = new Map();
  const itens = [];
  for (const id of ids) {
    const q = porId.get(id);
    if (!q) continue;
    const marcada = respostas[id] || null;
    let situacao;
    if (q.anulada || !q.gabarito) { anuladas++; situacao = 'anulada'; }
    else {
      validas++;
      if (!marcada) { brancos++; situacao = 'branco'; }
      else if (marcada === q.gabarito) { acertos++; situacao = 'certa'; }
      else { erros++; situacao = 'errada'; }
      if (!areas.has(q.grande_area)) areas.set(q.grande_area, { nome: q.grande_area, total: 0, acertos: 0 });
      const g = areas.get(q.grande_area); g.total++; if (situacao === 'certa') g.acertos++;
    }
    itens.push({ id, marcada, gabarito: q.gabarito, situacao });
  }
  return {
    total: itens.length, validas, acertos, erros, brancos, anuladas,
    nota: validas ? acertos / validas : 0,
    porArea: [...areas.values()].sort((a, b) => AREAS.indexOf(a.nome) - AREAS.indexOf(b.nome)).map((g) => ({ ...g, pct: g.total ? g.acertos / g.total : 0 })),
    itens,
  };
}

// ---------------- Seleção para cadernos / sessões ----------------

export const ORDENS = [
  ['prova', 'Ordem da prova'],
  ['recentes', 'Provas mais recentes'],
  ['antigas', 'Provas mais antigas'],
  ['aleatoria', 'Aleatória'],
];

/** Ordena uma lista de questões (não muta a original). */
export function ordenarQuestoes(lista, ordem = 'prova', rng = Math.random) {
  const a = [...lista];
  const porProva = (x, y) => x.banca.localeCompare(y.banca, 'pt-BR') || x.ano - y.ano || String(x.prova).localeCompare(String(y.prova), 'pt-BR') || x.numero - y.numero;
  if (ordem === 'aleatoria') return embaralhar(a, rng);
  if (ordem === 'recentes') return a.sort((x, y) => y.ano - x.ano || porProva(x, y));
  if (ordem === 'antigas') return a.sort((x, y) => x.ano - y.ano || porProva(x, y));
  return a.sort(porProva);
}

/**
 * Filtra + ordena + corta: é o que vira um caderno.
 * @returns {{ids: string[], total: number}} total = quantas casaram antes do limite.
 */
export function selecionarQuestoes(questoes, filtro, status, { ordem = 'prova', limite = 0, rng = Math.random } = {}) {
  const achadas = filtrar(questoes, filtro, status);
  const ordenadas = ordenarQuestoes(achadas, ordem, rng);
  const ids = (limite > 0 ? ordenadas.slice(0, limite) : ordenadas).map((q) => q.id);
  return { ids, total: achadas.length };
}

/** Resumo de progresso de um conjunto de ids, a partir do índice de status. */
export function resumoIds(ids, status) {
  const total = ids.length;
  let resolvidas = 0, acertos = 0, erros = 0;
  for (const id of ids) {
    if (!status.resolvidas.has(id)) continue;
    resolvidas++;
    const u = status.ultima.get(id);
    if (u === true) acertos++;
    else if (u === false) erros++;
  }
  return {
    total, resolvidas, acertos, erros,
    pendentes: total - resolvidas,
    pct: acertos + erros ? acertos / (acertos + erros) : 0,
    andamento: total ? resolvidas / total : 0,
  };
}

// ---------------- Árvore de assuntos ----------------

/**
 * Monta a árvore de assuntos a partir do meta gerado pelo build.
 * Cada nó: { chave, nome, nivel (0..2), caminho: [nomes dos ancestrais + o próprio], filhos }
 * Só entram assuntos que têm questão no banco (o meta já é construído a partir delas).
 */
export function arvoreAssuntos(meta) {
  const areas = (meta && meta.areas) || [];
  return areas.map((a) => ({
    chave: a.nome,
    nome: a.nome,
    nivel: 0,
    caminho: [a.nome],
    filhos: (a.especialidades || []).map((e) => {
      const kEsp = a.nome + SEP + e.nome;
      return {
        chave: kEsp,
        nome: e.nome,
        nivel: 1,
        caminho: [a.nome, e.nome],
        filhos: (e.temas || []).map((t) => ({
          chave: kEsp + SEP + t.nome,
          nome: t.nome,
          nivel: 2,
          caminho: [a.nome, e.nome, t.nome],
          filhos: [],
        })),
      };
    }),
  }));
}

/** Lista plana de todos os nós da árvore, em ordem de leitura. */
export function achatarAssuntos(arvore, saida = []) {
  for (const no of arvore) {
    saida.push(no);
    if (no.filhos.length) achatarAssuntos(no.filhos, saida);
  }
  return saida;
}

/**
 * Busca por nome em qualquer nível (ignora acento/maiúscula; várias palavras = todas).
 * Retorna os nós que casam, com o caminho completo para desambiguar homônimos.
 */
export function buscarAssuntos(planos, termo) {
  const palavras = normalizar(termo).split(/\s+/).filter(Boolean);
  if (!palavras.length) return [];
  return planos.filter((no) => {
    const alvo = normalizar(no.nome);
    return palavras.every((p) => alvo.includes(p));
  });
}

/** true se o nó (ou algum ancestral dele) está selecionado. */
export function assuntoSelecionado(chave, selecionados) {
  return selecionados.some((s) => ehDescendente(chave, s));
}

/** true se algum selecionado está ABAIXO deste nó (estado "parcial" da caixa). */
export function assuntoParcial(chave, selecionados) {
  return !assuntoSelecionado(chave, selecionados) && selecionados.some((s) => ehDescendente(s, chave));
}

/**
 * Marca/desmarca um assunto mantendo a lista enxuta:
 * marcar um pai engole os filhos; desmarcar um filho de um pai marcado
 * substitui o pai pelos irmãos que continuam valendo.
 */
export function alternarAssunto(selecionados, no, planosPorChave) {
  if (assuntoSelecionado(no.chave, selecionados)) return removerAssunto(selecionados, no, planosPorChave);
  return enxugarAssuntos([...selecionados, no.chave]);
}

function removerAssunto(selecionados, no, planosPorChave) {
  const saida = [];
  for (const s of selecionados) {
    if (s === no.chave) continue;                       // era exatamente este
    if (ehDescendente(s, no.chave)) continue;           // estava abaixo: sai junto
    if (ehDescendente(no.chave, s)) {                   // um ancestral estava marcado: abre em irmãos
      saida.push(...irmaosAteRaiz(no, s, planosPorChave));
      continue;
    }
    saida.push(s);
  }
  return enxugarAssuntos(saida);
}

/** Do ancestral marcado até o nó retirado, guarda todos os irmãos de cada nível. */
function irmaosAteRaiz(no, ancestral, planosPorChave) {
  const manter = [];
  let atual = no.chave;
  while (atual !== ancestral) {
    const pai = atual.split(SEP).slice(0, -1).join(SEP);
    const noPai = planosPorChave.get(pai);
    if (!noPai) break;
    for (const irmao of noPai.filhos) if (irmao.chave !== atual) manter.push(irmao.chave);
    atual = pai;
  }
  return manter;
}
