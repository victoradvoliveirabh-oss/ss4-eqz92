#!/usr/bin/env node
// Gera app/data/questoes.json e app/data/meta.json a partir de banco/questoes/*.json
// e copia banco/imagens/* para app/img/.
// Uso: node app/scripts/build-data.mjs   (a partir de qualquer pasta)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(AQUI, '..');
const RAIZ = path.resolve(APP, '..');
const DIR_Q = path.join(RAIZ, 'banco', 'questoes');
const DIR_IMG = path.join(RAIZ, 'banco', 'imagens');
const SAIDA_DATA = path.join(APP, 'data');
const SAIDA_IMG = path.join(APP, 'img');
const SAIDA_PDF = path.join(APP, 'provas');

export const BANCAS = ['ENAMED', 'ENARE', 'PSU-MG'];
export const AREAS = {
  'Clínica Médica': ['Cardiologia', 'Pneumologia', 'Gastroenterologia', 'Hepatologia', 'Nefrologia', 'Endocrinologia', 'Reumatologia', 'Hematologia', 'Oncologia', 'Infectologia', 'Neurologia', 'Psiquiatria', 'Dermatologia', 'Geriatria', 'Medicina Intensiva', 'Emergência Clínica'],
  'Cirurgia': ['Cirurgia Geral', 'Trauma', 'Cirurgia do Aparelho Digestivo', 'Coloproctologia', 'Cirurgia Vascular', 'Urologia', 'Ortopedia', 'Cirurgia Pediátrica', 'Cirurgia Torácica', 'Cirurgia Plástica e Queimados', 'Anestesiologia', 'Otorrinolaringologia', 'Oftalmologia', 'Neurocirurgia'],
  'Ginecologia e Obstetrícia': ['Obstetrícia', 'Ginecologia', 'Mastologia', 'Oncoginecologia', 'Reprodução Humana'],
  'Pediatria': ['Neonatologia', 'Puericultura', 'Infectologia Pediátrica', 'Emergência Pediátrica', 'Pneumologia Pediátrica', 'Gastroenterologia Pediátrica', 'Nefrologia Pediátrica', 'Cardiologia Pediátrica', 'Neurologia Pediátrica', 'Imunização'],
  'Medicina Preventiva e Social': ['Epidemiologia', 'Bioestatística', 'Saúde Pública e SUS', 'Medicina de Família e Comunidade', 'Vigilância em Saúde', 'Saúde do Trabalhador', 'Ética Médica e Medicina Legal'],
};

const ehTexto = (v) => typeof v === 'string' && v.trim() !== '';

/** Valida uma questão. Retorna { erros: [], avisos: [] }. Erros tornam a questão inválida. */
export function validarQuestao(q, imagensDisponiveis = null, { estrito = false } = {}) {
  const erros = [];
  const avisos = [];
  if (!q || typeof q !== 'object' || Array.isArray(q)) return { erros: ['não é um objeto'], avisos };
  if (!ehTexto(q.id)) erros.push('id ausente');
  if (!BANCAS.includes(q.banca)) erros.push(`banca inválida: ${JSON.stringify(q.banca)}`);
  if (!Number.isInteger(q.ano) || q.ano < 1990 || q.ano > 2100) erros.push(`ano inválido: ${JSON.stringify(q.ano)}`);
  if (!Number.isInteger(q.numero) || q.numero < 1) erros.push(`numero inválido: ${JSON.stringify(q.numero)}`);
  if (!ehTexto(q.enunciado)) erros.push('enunciado vazio');
  if (!Array.isArray(q.alternativas) || q.alternativas.length < 2) {
    erros.push('alternativas ausentes (mínimo 2)');
  } else {
    const letras = new Set();
    q.alternativas.forEach((a, i) => {
      if (!a || !/^[A-Z]$/.test(a.letra)) erros.push(`alternativa ${i + 1}: letra inválida`);
      else if (letras.has(a.letra)) erros.push(`alternativa ${a.letra} repetida`);
      else letras.add(a.letra);
      if (!a || typeof a.texto !== 'string') erros.push(`alternativa ${i + 1}: texto ausente`);
      else if (!a.texto.trim() && !(Array.isArray(q.imagens) && q.imagens.length)) avisos.push(`alternativa ${a.letra}: texto vazio`);
    });
    if (q.gabarito !== null && q.gabarito !== undefined) {
      if (!/^[A-Z]$/.test(q.gabarito)) erros.push(`gabarito inválido: ${JSON.stringify(q.gabarito)}`);
      else if (!letras.has(q.gabarito)) erros.push(`gabarito ${q.gabarito} não corresponde a nenhuma alternativa`);
    }
  }
  if (typeof q.anulada !== 'boolean') avisos.push('anulada ausente (assumido false)');
  if (q.anulada === true && q.gabarito) avisos.push('anulada=true mas gabarito preenchido (gabarito será ignorado)');
  if (q.anulada !== true && (q.gabarito === null || q.gabarito === undefined)) avisos.push('sem gabarito e não anulada');
  if (!(q.grande_area in AREAS)) erros.push(`grande_area inválida: ${JSON.stringify(q.grande_area)}`);
  if (!ehTexto(q.especialidade)) erros.push('especialidade ausente');
  else if (AREAS[q.grande_area] && !AREAS[q.grande_area].includes(q.especialidade)) avisos.push(`especialidade fora da lista: "${q.especialidade}"`);
  if (!ehTexto(q.tema)) avisos.push('tema ausente');
  // Referência completa
  for (const campo of ['ciclo', 'prova', 'caderno']) if (!ehTexto(q[campo])) avisos.push(`${campo} ausente`);
  if (!q.fonte || !ehTexto(q.fonte.prova_pdf)) avisos.push('fonte.prova_pdf ausente');
  else if (q.fonte.pagina === undefined || q.fonte.pagina === null) avisos.push('fonte.pagina ausente');
  if (!ehTexto(q.referencia)) {
    if (estrito) erros.push('referencia ausente (campo obrigatório)');
    else avisos.push('REFERENCIA AUSENTE (campo obrigatório) — gerada automaticamente pelos campos');
  } else {
    if (q.banca && !q.referencia.includes(q.banca)) avisos.push('referencia não contém a banca');
    if (q.ano && !q.referencia.includes(String(q.ano))) avisos.push('referencia não contém o ano');
    if (q.numero && !new RegExp(`\\b0*${q.numero}\\b`).test(q.referencia)) avisos.push('referencia não contém o número da questão');
  }
  if (ehTexto(q.id) && q.banca && q.ano && !q.id.startsWith(`${q.banca}-${q.ano}-`)) avisos.push('id não segue <BANCA>-<ano>-<nnn>');
  if (q.imagens !== undefined && !Array.isArray(q.imagens)) erros.push('imagens deve ser array');
  if (Array.isArray(q.imagens) && imagensDisponiveis) {
    for (const im of q.imagens) if (!imagensDisponiveis.has(im)) avisos.push(`imagem não encontrada: ${im}`);
  }
  if (q.revisao && q.revisao.extracao_ok === false) avisos.push(`revisao.extracao_ok=false${q.revisao.observacoes ? ': ' + q.revisao.observacoes : ''}`);
  return { erros, avisos };
}

export function montarReferencia(q) {
  const partes = [`${q.banca} ${q.ano}${q.ciclo ? ` (ciclo ${q.ciclo})` : ''}`];
  if (q.prova) partes.push(q.prova);
  if (q.caderno) partes.push(q.caderno);
  partes.push(`Questão ${q.numero}`);
  return partes.join(' · ');
}

/** Normaliza para o formato enxuto usado pelo app. */
/** Último trecho de um caminho tipo "provas_oficiais/ENARE/2024-2025/arquivo.pdf". */
export function nomeArquivo(caminho) {
  if (typeof caminho !== 'string' || !caminho.trim()) return '';
  return caminho.split(/[/\\]/).pop();
}

/** O bloco em que a banca cobrou a questão (vem como tag "bloco da prova: X"). */
export function blocoDaProva(q) {
  if (typeof q.bloco === 'string' && q.bloco.trim()) return q.bloco.trim();
  const t = (Array.isArray(q.tags) ? q.tags : []).find((x) => String(x).startsWith('bloco da prova:'));
  return t ? t.replace('bloco da prova:', '').trim() : '';
}

export function limparQuestao(q) {
  const anulada = q.anulada === true;
  return {
    id: q.id,
    banca: q.banca,
    ciclo: q.ciclo || '',
    ano: q.ano,
    prova: q.prova || '',
    caderno: q.caderno || '',
    numero: q.numero,
    referencia: ehTexto(q.referencia) ? q.referencia.trim() : montarReferencia(q),
    enunciado: q.enunciado,
    alternativas: q.alternativas.map((a) => ({ letra: a.letra, texto: a.texto })),
    gabarito: anulada ? null : (q.gabarito || null),
    anulada,
    imagens: Array.isArray(q.imagens) ? q.imagens : [],
    grande_area: q.grande_area,
    especialidade: q.especialidade,
    tema: (q.tema || '').trim() || 'Sem tema',
    subtema: q.subtema || '',
    // como a banca organizou a prova — dimensão própria de filtro, separada da nossa
    // classificação clínica (a questão de hipertensão do bloco "Coletiva" é as duas coisas)
    bloco: blocoDaProva(q),
    tags: (Array.isArray(q.tags) ? q.tags : []).filter((t) => !String(t).startsWith('bloco da prova:')),
    fonte: q.fonte ? {
      pagina: q.fonte.pagina ?? null,
      caderno_codigo: q.fonte.caderno_codigo || '',
      // só o nome do arquivo: o PDF é espelhado em app/provas/ e o link é montado no app
      prova_arquivo: nomeArquivo(q.fonte.prova_pdf),
      gabarito_arquivo: nomeArquivo(q.fonte.gabarito_pdf),
    } : null,
    revisao: q.revisao ? { extracao_ok: q.revisao.extracao_ok !== false, classificacao_ok: q.revisao.classificacao_ok !== false, observacoes: q.revisao.observacoes || '' } : null,
  };
}

export function chaveProva(q) {
  return `${q.banca}||${q.ano}||${q.prova || ''}`;
}

export function gerarMeta(questoes, { modoExemplo, arquivos }) {
  const bancas = new Map(), anos = new Map(), provas = new Map(), blocos = new Map();
  const areas = new Map();
  let comImagem = 0, anuladas = 0;
  for (const q of questoes) {
    bancas.set(q.banca, (bancas.get(q.banca) || 0) + 1);
    if (q.bloco) blocos.set(q.bloco, (blocos.get(q.bloco) || 0) + 1);
    anos.set(q.ano, (anos.get(q.ano) || 0) + 1);
    const cp = chaveProva(q);
    if (!provas.has(cp)) provas.set(cp, { chave: cp, banca: q.banca, ano: q.ano, ciclo: q.ciclo, prova: q.prova, cadernos: new Set(), total: 0 });
    const p = provas.get(cp); p.total++; if (q.caderno) p.cadernos.add(q.caderno);
    if (!areas.has(q.grande_area)) areas.set(q.grande_area, { total: 0, esp: new Map() });
    const a = areas.get(q.grande_area); a.total++;
    if (!a.esp.has(q.especialidade)) a.esp.set(q.especialidade, { total: 0, temas: new Map() });
    const e = a.esp.get(q.especialidade); e.total++;
    e.temas.set(q.tema, (e.temas.get(q.tema) || 0) + 1);
    if (q.imagens.length) comImagem++;
    if (q.anulada) anuladas++;
  }
  const ordemArea = Object.keys(AREAS);
  const cmp = (a, b) => a.localeCompare(b, 'pt-BR');
  return {
    geradoEm: new Date().toISOString(),
    modoExemplo,
    arquivos,
    total: questoes.length,
    comImagem,
    anuladas,
    bancas: [...bancas].sort((a, b) => BANCAS.indexOf(a[0]) - BANCAS.indexOf(b[0])).map(([nome, total]) => ({ nome, total })),
    anos: [...anos].sort((a, b) => a[0] - b[0]).map(([ano, total]) => ({ ano, total })),
    blocos: [...blocos].sort((a, b) => b[1] - a[1]).map(([nome, total]) => ({ nome, total })),
    provas: [...provas.values()]
      .sort((a, b) => BANCAS.indexOf(a.banca) - BANCAS.indexOf(b.banca) || b.ano - a.ano || cmp(a.prova, b.prova))
      .map((p) => ({ ...p, cadernos: [...p.cadernos] })),
    areas: [...areas]
      .sort((a, b) => ordemArea.indexOf(a[0]) - ordemArea.indexOf(b[0]))
      .map(([nome, a]) => {
        const lista = AREAS[nome] || [];
        const pos = (n) => (lista.indexOf(n) === -1 ? 999 : lista.indexOf(n));
        return {
          nome,
          total: a.total,
          especialidades: [...a.esp]
            .sort((x, y) => pos(x[0]) - pos(y[0]) || cmp(x[0], y[0]))
            .map(([en, e]) => ({
              nome: en,
              total: e.total,
              temas: [...e.temas].sort((x, y) => cmp(x[0], y[0])).map(([tn, total]) => ({ nome: tn, total })),
            })),
        };
      }),
  };
}

function principal() {
  const inicio = Date.now();
  if (!fs.existsSync(DIR_Q)) { console.error(`Pasta não encontrada: ${DIR_Q}`); process.exit(1); }
  const todos = fs.readdirSync(DIR_Q).filter((f) => f.toLowerCase().endsWith('.json')).sort();
  const reais = todos.filter((f) => !f.startsWith('_'));
  const modoExemplo = reais.length === 0;
  const usar = modoExemplo ? todos : reais;
  const ignorados = modoExemplo ? [] : todos.filter((f) => f.startsWith('_'));

  const imagensBanco = fs.existsSync(DIR_IMG) ? fs.readdirSync(DIR_IMG).filter((f) => fs.statSync(path.join(DIR_IMG, f)).isFile()) : [];
  const imagensUsaveis = imagensBanco.filter((f) => modoExemplo || !f.startsWith('_'));
  const setImagens = new Set(imagensUsaveis);

  const questoes = [];
  const vistos = new Map();
  const resumoArquivos = [];
  let totalAvisos = 0, totalInvalidas = 0, totalDuplicadas = 0, falhasArquivo = 0;
  const avisosDetalhe = [];

  for (const arq of usar) {
    const r = { arquivo: arq, lidas: 0, validas: 0, invalidas: 0, duplicadas: 0, avisos: 0 };
    let dados;
    try {
      dados = JSON.parse(fs.readFileSync(path.join(DIR_Q, arq), 'utf8').replace(/^﻿/, ''));
    } catch (e) {
      console.error(`ERRO  ${arq}: JSON inválido (${e.message}) — arquivo ignorado`);
      falhasArquivo++; r.erro = 'JSON inválido'; resumoArquivos.push(r); continue;
    }
    if (!Array.isArray(dados)) { console.error(`ERRO  ${arq}: raiz não é um array — arquivo ignorado`); falhasArquivo++; r.erro = 'raiz não é array'; resumoArquivos.push(r); continue; }
    dados.forEach((q, i) => {
      r.lidas++;
      const rotulo = `${arq} #${i + 1}${q && q.id ? ` (${q.id})` : ''}`;
      const { erros, avisos } = validarQuestao(q, setImagens, { estrito: process.argv.includes('--estrito') });
      if (erros.length) {
        r.invalidas++; totalInvalidas++;
        console.warn(`INVÁLIDA  ${rotulo}: ${erros.join('; ')}`);
        return;
      }
      if (vistos.has(q.id)) {
        r.duplicadas++; totalDuplicadas++;
        const orig = vistos.get(q.id);
        const igual = orig.enunciado === q.enunciado;
        console.warn(`DUPLICADA ${rotulo}: id já visto em ${orig._arquivo}${igual ? '' : ' (CONTEÚDO DIFERENTE — verifique)'} — mantida a primeira`);
        return;
      }
      if (avisos.length) { r.avisos += avisos.length; totalAvisos += avisos.length; avisosDetalhe.push(`${rotulo}: ${avisos.join('; ')}`); }
      const limpa = limparQuestao(q);
      vistos.set(q.id, { enunciado: q.enunciado, _arquivo: arq });
      questoes.push(limpa);
      r.validas++;
    });
    resumoArquivos.push(r);
  }

  // Ordenação padrão: banca, ano desc, prova, número
  questoes.sort((a, b) => BANCAS.indexOf(a.banca) - BANCAS.indexOf(b.banca) || b.ano - a.ano || a.prova.localeCompare(b.prova, 'pt-BR') || a.numero - b.numero || a.id.localeCompare(b.id));

  fs.mkdirSync(SAIDA_DATA, { recursive: true });
  fs.writeFileSync(path.join(SAIDA_DATA, 'questoes.json'), JSON.stringify(questoes));
  const meta = gerarMeta(questoes, { modoExemplo, arquivos: resumoArquivos.map((r) => r.arquivo) });
  fs.writeFileSync(path.join(SAIDA_DATA, 'meta.json'), JSON.stringify(meta, null, 1));

  // Imagens: espelha banco/imagens -> app/img
  fs.mkdirSync(SAIDA_IMG, { recursive: true });
  for (const f of fs.readdirSync(SAIDA_IMG)) if (!setImagens.has(f)) fs.rmSync(path.join(SAIDA_IMG, f), { force: true, recursive: true });
  let copiadas = 0;
  for (const f of imagensUsaveis) {
    const de = path.join(DIR_IMG, f), para = path.join(SAIDA_IMG, f);
    const sd = fs.statSync(de);
    if (fs.existsSync(para) && fs.statSync(para).size === sd.size && fs.statSync(para).mtimeMs >= sd.mtimeMs) continue;
    fs.copyFileSync(de, para); copiadas++;
  }

  // PDFs: espelha para app/provas/ os cadernos e gabaritos citados pelas questões,
  // para o app poder abrir o caderno oficial na página exata da questão.
  fs.mkdirSync(SAIDA_PDF, { recursive: true });
  const pdfsCitados = new Map(); // nome do arquivo -> caminho de origem
  for (const arq of usar) {
    let brutos;
    try { brutos = JSON.parse(fs.readFileSync(path.join(DIR_Q, arq), 'utf8').replace(/^﻿/, '')); } catch (e) { continue; }
    if (!Array.isArray(brutos)) continue;
    for (const q of brutos) {
      if (!q || !q.fonte) continue;
      for (const campo of ['prova_pdf', 'gabarito_pdf']) {
        const caminho = q.fonte[campo];
        if (typeof caminho !== 'string' || !caminho.toLowerCase().endsWith('.pdf')) continue;
        const nome = nomeArquivo(caminho);
        const de = path.resolve(RAIZ, caminho);
        if (fs.existsSync(de)) pdfsCitados.set(nome, de);
        else console.warn(`AVISO PDF não encontrado: ${caminho} (o link do caderno não vai funcionar)`);
      }
    }
  }
  for (const f of fs.readdirSync(SAIDA_PDF)) if (!pdfsCitados.has(f)) fs.rmSync(path.join(SAIDA_PDF, f), { force: true, recursive: true });
  let pdfsCopiados = 0;
  for (const [nome, de] of pdfsCitados) {
    const para = path.join(SAIDA_PDF, nome);
    const sd = fs.statSync(de);
    if (fs.existsSync(para) && fs.statSync(para).size === sd.size) continue;
    fs.copyFileSync(de, para); pdfsCopiados++;
  }

  if (avisosDetalhe.length) {
    console.log('\nAvisos (questões mantidas):');
    const max = process.argv.includes('--todos-avisos') ? Infinity : 40;
    avisosDetalhe.slice(0, max).forEach((a) => console.log('  AVISO ' + a));
    if (avisosDetalhe.length > max) console.log(`  ... +${avisosDetalhe.length - max} questões com aviso (use --todos-avisos)`);
  }
  console.log('\n===== Resumo do build =====');
  if (modoExemplo) console.log('MODO EXEMPLO: nenhum arquivo real encontrado; usando arquivos _*.json');
  if (ignorados.length) console.log(`Ignorados (prefixo _): ${ignorados.join(', ')}`);
  console.log('Arquivo'.padEnd(34) + 'lidas válidas inválidas duplic. avisos');
  for (const r of resumoArquivos) {
    console.log(r.arquivo.padEnd(34) + (r.erro ? `ERRO: ${r.erro}` : `${String(r.lidas).padStart(5)} ${String(r.validas).padStart(7)} ${String(r.invalidas).padStart(9)} ${String(r.duplicadas).padStart(7)} ${String(r.avisos).padStart(6)}`));
  }
  console.log(`\nQuestões no app: ${questoes.length}  (inválidas: ${totalInvalidas}, duplicadas: ${totalDuplicadas}, arquivos com erro: ${falhasArquivo}, avisos: ${totalAvisos})`);
  console.log(`Por banca: ${meta.bancas.map((b) => `${b.nome} ${b.total}`).join(' · ') || '—'}`);
  console.log(`Provas: ${meta.provas.length} · Com imagem: ${meta.comImagem} · Anuladas: ${meta.anuladas}`);
  console.log(`Por área: ${meta.areas.map((a) => `${a.nome} ${a.total}`).join(' · ') || '—'}`);
  console.log(`Imagens: ${imagensUsaveis.length} disponíveis, ${copiadas} copiadas/atualizadas`);
  console.log(`PDFs em provas/: ${pdfsCitados.size} (${pdfsCopiados} copiados/atualizados)`);
  console.log(`Saída: ${path.relative(RAIZ, SAIDA_DATA)}/questoes.json, meta.json  (${Date.now() - inicio} ms)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) principal();
