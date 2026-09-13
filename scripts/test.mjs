// Testes dos módulos puros: node app/scripts/test.mjs
import assert from 'node:assert/strict';
import * as N from '../js/nucleo.js';
import * as S from '../js/storage.js';
import { validarQuestao, montarReferencia } from './build-data.mjs';

let ok = 0, falhas = 0;
async function teste(nome, fn) {
  try { await fn(); ok++; console.log('  ok  ' + nome); }
  catch (e) { falhas++; console.log('FALHOU ' + nome + '\n      ' + (e.stack || e).toString().split('\n').slice(0, 3).join('\n      ')); }
}

const q = (id, o = {}) => ({
  id, banca: 'ENARE', ano: 2022, prova: 'Acesso Direto', caderno: 'Tipo 1', numero: 1, ciclo: '2022-2023',
  referencia: 'ENARE 2022 · Questão 1',
  enunciado: 'Texto', alternativas: [{ letra: 'A', texto: 'x' }, { letra: 'B', texto: 'y' }], gabarito: 'A', anulada: false,
  imagens: [], grande_area: 'Clínica Médica', especialidade: 'Cardiologia', tema: 'IC', ...o,
});

const Q = N.prepararQuestoes([
  q('ENARE-2022-001', { enunciado: 'Paciente com insuficiência cardíaca e dispneia' }),
  q('ENARE-2022-002', { numero: 2, especialidade: 'Pneumologia', tema: 'Asma', imagens: ['a.png'] }),
  q('ENARE-2021-001', { ano: 2021, grande_area: 'Pediatria', especialidade: 'Neonatologia', tema: 'Icterícia', anulada: true, gabarito: null }),
  q('PSU-MG-2022-001', { banca: 'PSU-MG', prova: 'Prova Geral', grande_area: 'Cirurgia', especialidade: 'Trauma', tema: 'ATLS', alternativas: [{ letra: 'A', texto: 'Gestação ectópica' }, { letra: 'B', texto: 'z' }] }),
  q('ENAMED-2023-001', { banca: 'ENAMED', ano: 2023, prova: 'ENAMED', tema: 'Arritmias' }),
]);
const porId = new Map(Q.map((x) => [x.id, x]));
const ids = (l) => l.map((x) => x.id).sort();

console.log('Filtragem');
await teste('filtro vazio retorna tudo', () => assert.equal(N.filtrar(Q, N.filtroVazio()).length, 5));
await teste('banca múltipla', () => assert.deepEqual(ids(N.filtrar(Q, { bancas: ['PSU-MG', 'ENAMED'] })), ['ENAMED-2023-001', 'PSU-MG-2022-001']));
await teste('anos lista e faixa', () => {
  assert.equal(N.filtrar(Q, { anos: [2021] }).length, 1);
  assert.equal(N.filtrar(Q, { anoMin: 2022, anoMax: 2022 }).length, 3);
});
await teste('prova específica', () => assert.deepEqual(ids(N.filtrar(Q, { provas: ['ENARE||2022||Acesso Direto'] })), ['ENARE-2022-001', 'ENARE-2022-002']));
await teste('assunto vale em qualquer nível (marcar o pai pega a subárvore)', () => {
  assert.deepEqual(ids(N.filtrar(Q, { assuntos: ['Cirurgia'] })), ['PSU-MG-2022-001']);
  assert.deepEqual(ids(N.filtrar(Q, { assuntos: ['Clínica Médica||Cardiologia'] })), ['ENAMED-2023-001', 'ENARE-2022-001']);
  assert.deepEqual(ids(N.filtrar(Q, { assuntos: ['Clínica Médica||Cardiologia||IC'] })), ['ENARE-2022-001']);
});
await teste('assuntos de ramos diferentes somam (OU)', () => {
  assert.deepEqual(ids(N.filtrar(Q, { assuntos: ['Cirurgia', 'Pediatria'] })), ['ENARE-2021-001', 'PSU-MG-2022-001']);
});
await teste('ancestral marcado engole o descendente', () => {
  const f = N.normalizarFiltro({ assuntos: ['Clínica Médica', 'Clínica Médica||Cardiologia', 'Cirurgia'] });
  assert.deepEqual(f.assuntos, ['Clínica Médica', 'Cirurgia']);
});
await teste('filtro salvo no formato antigo vira assuntos', () => {
  const f = N.normalizarFiltro({ areas: ['Cirurgia'], especialidades: [], temas: ['Clínica Médica||Cardiologia||IC'] });
  assert.deepEqual(f.assuntos, ['Cirurgia', 'Clínica Médica||Cardiologia||IC']);
  assert.equal(f.areas, undefined, 'não guarda mais os campos antigos');
});
await teste('imagem com/sem', () => { assert.equal(N.filtrar(Q, { imagem: 'com' }).length, 1); assert.equal(N.filtrar(Q, { imagem: 'sem' }).length, 4); });
await teste('anuladas excluir/somente', () => { assert.equal(N.filtrar(Q, { anuladas: 'excluir' }).length, 4); assert.equal(N.filtrar(Q, { anuladas: 'somente' }).length, 1); });
await teste('busca sem acento e case-insensitive, várias palavras (E)', () => {
  assert.deepEqual(ids(N.filtrar(Q, { busca: 'INSUFICIENCIA cardiaca' })), ['ENARE-2022-001']);
  assert.deepEqual(ids(N.filtrar(Q, { busca: 'gestacao' })), ['PSU-MG-2022-001']);
  assert.equal(N.filtrar(Q, { busca: 'cardiaca asma' }).length, 0);
});
const prog = {
  respostas: {
    'ENARE-2022-001': { t: [{ d: 1, m: 'B', c: false }, { d: 2, m: 'A', c: true }] },
    'ENARE-2022-002': { t: [{ d: 3, m: 'B', c: false }] },
    'ENARE-2021-001': { t: [{ d: 3, m: 'B', c: null }] },
  },
  favoritos: { 'PSU-MG-2022-001': 1 },
  anotacoes: { 'ENAMED-2023-001': { texto: 'rever', d: 1 }, 'ENARE-2022-002': { texto: '  ', d: 1 } },
};
await teste('status', () => {
  const st = N.indiceStatus(prog);
  assert.deepEqual(ids(N.filtrar(Q, { status: ['erradas'] }, st)), ['ENARE-2022-002']);
  assert.deepEqual(ids(N.filtrar(Q, { status: ['acertadas'] }, st)), ['ENARE-2022-001']);
  assert.deepEqual(ids(N.filtrar(Q, { status: ['nao_resolvidas'] }, st)), ['ENAMED-2023-001', 'PSU-MG-2022-001']);
  assert.deepEqual(ids(N.filtrar(Q, { status: ['favoritas', 'anotadas'] }, st)), ['ENAMED-2023-001', 'PSU-MG-2022-001']);
});
await teste('facetas ignoram o próprio critério', () => {
  const { resultado, contagens } = N.filtrarComFacetas(Q, { bancas: ['ENARE'], assuntos: ['Pediatria'] });
  assert.equal(resultado.length, 1);
  assert.deepEqual(contagens.bancas, { ENARE: 1 }, 'banca conta com o assunto aplicado');
  // assunto conta ignorando o próprio critério: as 3 questões do ENARE, em cada nível
  assert.equal(contagens.assuntos['Clínica Médica'], 2);
  assert.equal(contagens.assuntos['Clínica Médica||Cardiologia'], 1);
  assert.equal(contagens.assuntos['Pediatria'], 1);
  assert.equal(contagens.assuntos['Pediatria||Neonatologia||Icterícia'], 1);
  assert.equal(contagens.assuntos['Cirurgia'], undefined, 'outra banca não entra');
});
await teste('facetas: resultado igual a filtrar()', () => {
  const f = { anoMin: 2022, busca: 'a', status: [] };
  assert.deepEqual(ids(N.filtrarComFacetas(Q, f).resultado), ids(N.filtrar(Q, f)));
});
await teste('normalizarFiltro tolera lixo', () => {
  const f = N.normalizarFiltro({ bancas: 'x', imagem: '??', anoMin: '', extra: 1 });
  assert.deepEqual(f, N.filtroVazio());
  assert.equal(N.contarCriterios({ bancas: ['A'], busca: 'x', anoMin: 2020 }), 3);
});

console.log('Revisão espaçada');
const D = N.DIA;
const t0 = new Date(2026, 0, 10, 14, 0).getTime();
const dia0 = N.inicioDoDia(t0);
await teste('erro agenda para 1 dia', () => {
  const r = N.estadoRevisao([{ d: t0, c: false }]);
  assert.equal(r.ativa, true); assert.equal(r.etapa, 0); assert.equal(r.proxima, dia0 + D);
});
await teste('acertos nas datas devidas avançam 1→3→7→15 e concluem', () => {
  let tent = [{ d: t0, c: false }];
  let r = N.estadoRevisao(tent);
  const esperado = [3, 7, 15];
  for (let i = 0; i < 3; i++) {
    tent.push({ d: r.proxima + 3600e3, c: true });
    const ant = r.proxima;
    r = N.estadoRevisao(tent);
    assert.equal(r.etapa, i + 1);
    assert.equal(r.proxima, N.inicioDoDia(ant + 3600e3) + esperado[i] * D);
  }
  tent.push({ d: r.proxima + 1000, c: true });
  r = N.estadoRevisao(tent);
  assert.equal(r.ativa, false); assert.equal(r.concluida, true);
});
await teste('acerto antes da data não avança; novo erro reinicia', () => {
  let r = N.estadoRevisao([{ d: t0, c: false }, { d: t0 + 1000, c: true }]);
  assert.equal(r.etapa, 0);
  r = N.estadoRevisao([{ d: t0, c: false }, { d: dia0 + D + 10, c: true }, { d: dia0 + 2 * D + 10, c: false }]);
  assert.equal(r.etapa, 0); assert.equal(r.proxima, dia0 + 3 * D);
});
await teste('listasRevisao', () => {
  const p = { respostas: { a: { t: [{ d: t0, c: false }] }, b: { t: [{ d: t0, c: false }, { d: t0 + 5, c: true }] }, c: { t: [{ d: t0, c: true }] } } };
  const l = N.listasRevisao(p, dia0 + D + 1);
  assert.deepEqual(l.devidas.map((x) => x.id).sort(), ['a', 'b']);
  assert.deepEqual(l.erradasUltima, ['a']);
  assert.deepEqual(l.jaErradas.sort(), ['a', 'b']);
  assert.equal(N.listasRevisao(p, t0).agendadas.length, 2);
});

console.log('Estatísticas');
await teste('geral e por área/banca, modos', () => {
  const e = N.estatisticas(porId, prog);
  assert.equal(e.totalRespostas, 3); assert.equal(e.acertos, 1); assert.equal(e.questoesResolvidas, 2);
  assert.equal(e.porArea.length, 1); assert.equal(e.porArea[0].total, 3);
  assert.equal(N.estatisticas(porId, prog, { modo: 'primeira' }).acertos, 0);
  assert.equal(N.estatisticas(porId, prog, { modo: 'ultima' }).acertos, 1);
  assert.equal(e.temasMaisErrados[0].erros, 1);
  assert.equal(e.evolucao.pontos.length, 1);
});
await teste('ignora questões inexistentes', () => {
  assert.equal(N.estatisticas(porId, { respostas: { X: { t: [{ d: 1, c: true }] } } }).totalRespostas, 0);
});

console.log('Simulado');
await teste('corrigir', () => {
  const r = N.corrigirSimulado(porId, ['ENARE-2022-001', 'ENARE-2022-002', 'ENARE-2021-001', 'PSU-MG-2022-001'], { 'ENARE-2022-001': 'A', 'ENARE-2022-002': 'B', 'ENARE-2021-001': 'A' });
  assert.equal(r.acertos, 1); assert.equal(r.erros, 1); assert.equal(r.brancos, 1); assert.equal(r.anuladas, 1); assert.equal(r.validas, 3);
  assert.ok(Math.abs(r.nota - 1 / 3) < 1e-9);
});
await teste('prova completa em ordem e embaralhar preserva elementos', () => {
  assert.deepEqual(N.questoesDaProva(Q, 'ENARE||2022||Acesso Direto').map((x) => x.numero), [1, 2]);
  assert.deepEqual(N.embaralhar(Q).map((x) => x.id).sort(), ids(Q));
});

console.log('Storage');
function mockStorage(falhar = false) {
  const m = new Map();
  globalThis.localStorage = {
    getItem: (k) => { if (falhar) throw new Error('bloqueado'); return m.has(k) ? m.get(k) : null; },
    setItem: (k, v) => { if (falhar) throw new Error('bloqueado'); m.set(k, String(v)); },
  };
  S._reiniciarCache();
  return m;
}
await teste('salvar e recarregar', async () => {
  const m = mockStorage();
  await S.salvarResposta('Q1', { marcada: 'A', correta: true });
  await S.definirFavorito('Q1', true);
  await S.salvarAnotacao('Q1', 'nota');
  await S.salvarCaderno({ nome: 'Cardio', filtro: { areas: ['Clínica Médica'] } });
  await S.salvarPreferencias({ tema: 'escuro' });
  assert.equal(m.size, 1);
  S._reiniciarCache();
  const p = await S.carregarProgresso();
  assert.equal(p.respostas.Q1.t.length, 1);
  assert.ok(p.favoritos.Q1); assert.equal(p.anotacoes.Q1.texto, 'nota');
  assert.equal(p.cadernos[0].nome, 'Cardio'); assert.equal(p.preferencias.tema, 'escuro');
});
await teste('caderno guarda ids, ordem e posição; atualizarCaderno mexe em campo solto', async () => {
  mockStorage();
  const c = await S.salvarCaderno({ nome: 'Cardio', filtro: { areas: ['Clínica Médica'] }, ids: ['a', 'b'], ordem: 'aleatoria' });
  assert.deepEqual(c.ids, ['a', 'b']);
  assert.equal(c.ordem, 'aleatoria');
  assert.equal(c.indice, 0);
  await S.atualizarCaderno(c.id, { indice: 1 });
  const p = await S.carregarProgresso();
  assert.equal(p.cadernos[0].indice, 1);
  assert.equal(p.cadernos.length, 1, 'atualizar não duplica');
  assert.equal(await S.atualizarCaderno('inexistente', { indice: 3 }), null);
});
await teste('exportar → importar (substituir e mesclar sem duplicar)', async () => {
  mockStorage();
  await S.salvarResposta('Q1', { marcada: 'A', correta: true, data: 100 });
  const backup = await S.exportar();
  mockStorage();
  await S.salvarResposta('Q2', { marcada: 'B', correta: false, data: 200 });
  await S.importar(backup, { modo: 'mesclar' });
  await S.importar(backup, { modo: 'mesclar' });
  let p = await S.carregarProgresso();
  assert.equal(p.respostas.Q1.t.length, 1); assert.equal(p.respostas.Q2.t.length, 1);
  await S.importar(backup, { modo: 'substituir' });
  p = await S.carregarProgresso();
  assert.equal(p.respostas.Q2, undefined);
  await assert.rejects(() => S.importar('{nao json'), /JSON válido/);
  await assert.rejects(() => S.importar('{"a":1}'), /não parece/);
});
await teste('funciona em memória se localStorage falhar', async () => {
  mockStorage(true);
  await S.salvarResposta('Q1', { marcada: 'A', correta: true });
  assert.equal((await S.carregarProgresso()).respostas.Q1.t.length, 1);
  assert.equal(S.statusArmazenamento().persistente, false);
});

console.log('Árvore de assuntos');
const META = {
  areas: [
    { nome: 'Clínica Médica', especialidades: [
      { nome: 'Cardiologia', temas: [{ nome: 'IC' }, { nome: 'Arritmias' }] },
      { nome: 'Pneumologia', temas: [{ nome: 'Asma' }] },
    ] },
    { nome: 'Pediatria', especialidades: [{ nome: 'Neonatologia', temas: [{ nome: 'Icterícia' }] }] },
  ],
};
const ARV = N.arvoreAssuntos(META);
const PLANOS = N.achatarAssuntos(ARV);
const PORCHAVE = new Map(PLANOS.map((n) => [n.chave, n]));

await teste('árvore tem os três níveis com caminho completo', () => {
  assert.equal(ARV.length, 2);
  assert.equal(PLANOS.length, 2 + 3 + 4, 'áreas + especialidades + temas');
  const tema = PORCHAVE.get('Clínica Médica||Cardiologia||IC');
  assert.deepEqual(tema.caminho, ['Clínica Médica', 'Cardiologia', 'IC']);
  assert.equal(tema.nivel, 2);
  assert.equal(tema.filhos.length, 0);
});
await teste('busca varre todos os níveis, sem acento e com várias palavras', () => {
  assert.deepEqual(N.buscarAssuntos(PLANOS, 'ictericia').map((n) => n.caminho.join(' / ')), ['Pediatria / Neonatologia / Icterícia']);
  assert.deepEqual(N.buscarAssuntos(PLANOS, 'cardio').map((n) => n.nome), ['Cardiologia']);
  assert.equal(N.buscarAssuntos(PLANOS, 'xyz').length, 0);
  assert.equal(N.buscarAssuntos(PLANOS, '').length, 0);
});
await teste('selecionado x parcial', () => {
  const sel = ['Clínica Médica||Cardiologia'];
  assert.equal(N.assuntoSelecionado('Clínica Médica||Cardiologia||IC', sel), true, 'filho herda a marca do pai');
  assert.equal(N.assuntoSelecionado('Clínica Médica', sel), false);
  assert.equal(N.assuntoParcial('Clínica Médica', sel), true, 'área fica em estado parcial');
  assert.equal(N.assuntoParcial('Pediatria', sel), false);
});
await teste('desmarcar um filho de um pai marcado mantém os irmãos', () => {
  let sel = ['Clínica Médica'];
  sel = N.alternarAssunto(sel, PORCHAVE.get('Clínica Médica||Cardiologia||IC'), PORCHAVE);
  assert.deepEqual([...sel].sort(), ['Clínica Médica||Cardiologia||Arritmias', 'Clínica Médica||Pneumologia'].sort());
  assert.equal(N.assuntoSelecionado('Clínica Médica||Pneumologia||Asma', sel), true);
  assert.equal(N.assuntoSelecionado('Clínica Médica||Cardiologia||IC', sel), false);
});
await teste('marcar o pai engole o filho que já estava marcado', () => {
  let sel = ['Clínica Médica||Cardiologia||IC'];
  sel = N.alternarAssunto(sel, PORCHAVE.get('Clínica Médica'), PORCHAVE);
  assert.deepEqual(sel, ['Clínica Médica']);
});

console.log('Seleção para cadernos');
await teste('ordenarQuestoes por prova, recentes e antigas', () => {
  assert.deepEqual(N.ordenarQuestoes(Q, 'recentes').map((x) => x.ano), [2023, 2022, 2022, 2022, 2021]);
  assert.deepEqual(N.ordenarQuestoes(Q, 'antigas').map((x) => x.ano), [2021, 2022, 2022, 2022, 2023]);
  assert.deepEqual(N.ordenarQuestoes(Q, 'prova').map((x) => x.id)[0], 'ENAMED-2023-001');
  assert.equal(N.ordenarQuestoes(Q, 'aleatoria').length, Q.length);
});
await teste('selecionarQuestoes aplica filtro, ordem e limite', () => {
  const vazio = { ultima: new Map(), resolvidas: new Set(), favoritas: new Set(), anotadas: new Set() };
  const r = N.selecionarQuestoes(Q, { bancas: ['ENARE'] }, vazio, { ordem: 'antigas' });
  assert.deepEqual(r.ids, ['ENARE-2021-001', 'ENARE-2022-001', 'ENARE-2022-002']);
  assert.equal(r.total, 3);
  const c = N.selecionarQuestoes(Q, {}, vazio, { limite: 2 });
  assert.equal(c.ids.length, 2);
  assert.equal(c.total, 5, 'total ignora o limite');
});
await teste('resumoIds conta andamento e aproveitamento', () => {
  const st = {
    ultima: new Map([['a', true], ['b', false]]),
    resolvidas: new Set(['a', 'b']), favoritas: new Set(), anotadas: new Set(),
  };
  const r = N.resumoIds(['a', 'b', 'c', 'd'], st);
  assert.equal(r.resolvidas, 2); assert.equal(r.pendentes, 2);
  assert.equal(r.acertos, 1); assert.equal(r.erros, 1);
  assert.equal(r.pct, 0.5); assert.equal(r.andamento, 0.5);
});

console.log('Validação do build');
await teste('questão válida sem erros; referência exigida', () => {
  const v = validarQuestao(q('ENARE-2022-001', { fonte: { prova_pdf: 'x.pdf', pagina: 1 }, referencia: 'ENARE 2022 (ciclo 2022-2023) · Acesso Direto · Tipo 1 · Questão 1' }));
  assert.deepEqual(v.erros, []); assert.deepEqual(v.avisos, []);
  assert.ok(validarQuestao(q('X', { referencia: '' })).avisos.some((a) => /REFERENCIA/.test(a)));
  assert.ok(validarQuestao(q('X', { referencia: '' }), null, { estrito: true }).erros.length);
  assert.ok(validarQuestao(q('X', { gabarito: 'E' })).erros.length);
  assert.ok(validarQuestao(q('X', { grande_area: 'Outra' })).erros.length);
  assert.equal(montarReferencia(q('X')), 'ENARE 2022 (ciclo 2022-2023) · Acesso Direto · Tipo 1 · Questão 1');
});

console.log(`\n${ok} ok, ${falhas} falha(s)`);
process.exit(falhas ? 1 : 0);
