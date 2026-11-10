// Passo 2 (10/11): o neon.js grava portal, portal_item_id (document_schedule_id), status_portal, motivo_reprovacao,
// aberto_no_portal e uma linha por leitura em "coletas". A aba Reprovados só dá o motivo, nunca soma. Linha do Bernhoeft
// (portal = Bernhoeft) nunca é tocada pelo robô Atlas. Antes da migração, o neon.js grava como antes.
// Roda num Postgres descartável (PGlite) com as permissões do robo_atlas e o esquema do Passo 1 como está no Neon (10/11).
// Rodar: node teste/t-neon-passo2.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { DatabaseSync } = require('node:sqlite');

const PGLITE_DIR = process.env.PGLITE_DIR || path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'Temp', 'gesdoc-teste', 'pglite2');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 't-neon-passo2-'));
process.env.ATLAS_DB = path.join(tmp, 'atlas.db');
process.env.ATLAS_ENVIOS_LOG = path.join(tmp, 'envios.log');
let ok = 0, falhou = 0;
const t = (cond, msg) => { cond ? ok++ : (falhou++, console.log('FALHOU', msg)); };

const base = { cliente: 'Equatorial Energia', categoria: 'Prestação de Serviço', tipo: 'Recorrente', grupos: null, n_docs: 1, validade: null, critico: 0,
  funcionario: null, cpf: null, enviado_em: null, validado_em: null, cnpj_filial: '02867678000797', pedido: '00361', unidades: 'EQUATORIAL GOIÁS',
  motivo_reprovacao: null };
const P = (o) => ({ ...base, aba: 'Atrasados', status: 'DelayNotSent', competencia: '10/2026', prazo_envio: '2026-11-10', ...o });
const VT = P({ documento: 'Vale Transporte (Relação de Beneficiários + Boleto + Comprovante)', aba: 'Próximas entregas', status: 'PendingNotSent', document_schedule_id: 'vt-1' });
const FGTS = P({ documento: 'FGTS - Guia de recolhimento (boleto)', document_schedule_id: 'fgts-1' });
const SEG = P({ documento: 'Seguro de Vida (Relação de Beneficiários + Boleto + Comprovante)', status: 'DelayRejected', document_schedule_id: 'seg-1', motivo_reprovacao: 'Falta a relação' });
const SEG_REP = { ...SEG, aba: 'Reprovados' }; // o mesmo reprovado, repetido na aba Reprovados
const SAUDE = P({ documento: 'Plano de Saúde (Relação de Beneficiários + Boleto + Comprovante)', document_schedule_id: 'saude-1' });

const PASSO1 = `
  alter table documentos add column portal varchar, add column portal_item_id varchar, add column status_portal varchar,
    add column situacao_portal varchar, add column motivo_reprovacao text, add column aberto_no_portal boolean,
    add column visto_no_portal_em timestamptz, add column motivo varchar, add column responsavel varchar, add column motivo_em timestamptz;
  update documentos set portal = 'Atlas';
  create table coletas (id bigserial primary key, portal varchar not null, inicio timestamptz not null default now(), fim timestamptz, ok boolean, totais jsonb, erro text);
  create table documento_eventos (id bigserial primary key, documento_id int not null references documentos(id) on delete restrict, em timestamptz not null default now(),
    robo varchar not null, tipo varchar not null, resultado varchar not null, motivo varchar, responsavel varchar, detalhe text, dados jsonb);
  grant select, insert, update on coletas to robo_atlas; grant select, insert on documento_eventos to robo_atlas;
  grant insert (portal, portal_item_id, status_portal, situacao_portal, motivo_reprovacao, aberto_no_portal, visto_no_portal_em, motivo, responsavel, motivo_em) on documentos to robo_atlas;
  grant update (portal, portal_item_id, status_portal, situacao_portal, motivo_reprovacao, aberto_no_portal, visto_no_portal_em, motivo, responsavel, motivo_em) on documentos to robo_atlas;
  grant usage on sequence coletas_id_seq, documento_eventos_id_seq to robo_atlas;
`;
let coletaId = 0;
function atlasDb(linhas, coletadoEm, totais) {
  if (fs.existsSync(process.env.ATLAS_DB)) fs.rmSync(process.env.ATLAS_DB);
  const db = new DatabaseSync(process.env.ATLAS_DB);
  const cols = [...new Set([...Object.keys(P({ documento: '' })), 'document_schedule_id'])];
  db.exec(`create table coletas (id integer primary key, coletado_em text, atrasados int, proximas int, reprovados int, entregues int);
    create table pendencias (id integer primary key, coleta_id int, ${cols.map((c) => c + ' text').join(', ')})`);
  coletaId++;
  db.prepare('insert into coletas values (?, ?, ?, ?, ?, ?)').run(coletaId, coletadoEm, totais.a, totais.p, totais.r, totais.e);
  const ins = db.prepare(`insert into pendencias (coleta_id, ${cols.join(', ')}) values (?, ${cols.map(() => '?').join(', ')})`);
  for (const l of linhas) ins.run(coletaId, ...cols.map((c) => (l[c] == null ? null : String(l[c]))));
  db.close();
}

(async () => {
  const { PGlite } = await import(pathToFileURL(path.join(PGLITE_DIR, 'node_modules', '@electric-sql', 'pglite', 'dist', 'index.js')).href);
  const pg = new PGlite();
  await pg.exec(`
    create role robo_atlas; create role painel_leitura; create role sinc_factorial;
    create table documento_regras (doc_id int unique not null, ativo boolean default true);
    insert into documento_regras (doc_id) values (3), (4), (7), (24), (900);
    create table documentos (id serial primary key, doc_id int not null, colaborador_id varchar, competencia varchar, estado varchar not null,
      caminho_origem varchar, tamanho_bytes bigint, hash_arquivo varchar, criado_em timestamp default now(), atualizado_em timestamp, prazo_envio date,
      cliente varchar, unidade varchar, nome varchar, categoria varchar, aba varchar, situacao varchar, funcionario varchar, cpf varchar(11),
      tipo varchar, grupo varchar, numero_pedido varchar, cnpj_filial varchar(14), qtd_docs int, enviado_em timestamp, validado_em timestamp,
      validade date, critico boolean);
    create unique index documentos_chave_natural on documentos (cliente, doc_id, cpf, cnpj_filial, competencia, nome, numero_pedido, prazo_envio) nulls not distinct;
    grant select on documentos, documento_regras to robo_atlas;
    grant insert (doc_id, colaborador_id, competencia, estado, prazo_envio, cliente, unidade, nome, categoria, aba, situacao,
      funcionario, cpf, tipo, grupo, numero_pedido, cnpj_filial, qtd_docs, enviado_em, validado_em, validade, critico) on documentos to robo_atlas;
    grant update (doc_id, colaborador_id, competencia, estado, prazo_envio, cliente, unidade, nome, categoria, aba, situacao,
      funcionario, cpf, tipo, grupo, numero_pedido, cnpj_filial, qtd_docs, enviado_em, validado_em, validade, critico,
      caminho_origem, tamanho_bytes, hash_arquivo, atualizado_em) on documentos to robo_atlas;
    grant usage on sequence documentos_id_seq to robo_atlas;
  `);
  const sql = {
    query: (text, params = []) => ({ text, params, then: (a, b) => pg.query(text, params).then((r) => r.rows).then(a, b) }),
    transaction: async (qs) => { await pg.exec('begin'); try { const out = []; for (const q of qs) out.push((await pg.query(q.text, q.params)).rows); await pg.exec('commit'); return out; } catch (e) { await pg.exec('rollback'); throw e; } },
  };
  const { enviarNeon } = require(path.join(__dirname, '..', 'atlas-robo', 'neon'));
  const logs = [];
  const rodar = (o = {}) => enviarNeon({ sql, log: (m) => logs.push(m), ...o });
  const q = async (s) => (await pg.query(s)).rows;

  // A. Antes da migração: grava como antes (sem as colunas novas, sem erro)
  await pg.exec('set role robo_atlas');
  atlasDb([VT, FGTS, SEG, SEG_REP, SAUDE], '2026-11-10T13:00:00.000Z', { a: 3, p: 1, r: 1, e: 10 });
  await rodar({ entregues: [] });
  t((await q('select * from documentos')).length === 4, 'antes da migração: 4 linhas (o reprovado repetido não duplica)');

  // B. Passo 1 (como owner): o mesmo que está no Neon desde 10/11 (colunas, coletas, documento_eventos e permissões)
  await pg.exec('reset role');
  await pg.exec(PASSO1);
  // Linha do Bernhoeft (Passo 4) que o robô Atlas não pode tocar, mesmo com aba preenchida
  await pg.exec(`insert into documento_regras (doc_id) values (901) on conflict do nothing;
    insert into documentos (doc_id, estado, portal, aba, situacao, nome, aberto_no_portal) values (900, 'PENDENTE_ENVIO', 'Bernhoeft', 'Não Entregue', 'Não Entregue', 'EQT - Brigada', true)`);
  await pg.exec('set role robo_atlas');

  // C. 1ª leitura depois da migração: tudo aberto, Plano de Saúde sai (vai para Entregues)
  atlasDb([VT, FGTS, SEG, SEG_REP], '2026-11-10T14:00:00.000Z', { a: 2, p: 1, r: 1, e: 11 });
  const ent = [{ ...SAUDE, aba: 'Entregues', status: 'Approved', document_schedule_id: 'saude-1' }];
  await rodar({ entregues: ent });
  const d = Object.fromEntries((await q('select * from documentos')).map((r) => [r.portal_item_id || r.nome, r]));
  t(d['vt-1']?.aberto_no_portal === true && d['vt-1'].portal === 'Atlas' && d['vt-1'].status_portal === 'PendingNotSent', 'VT aberto, portal Atlas, status cru');
  t(d['fgts-1']?.aberto_no_portal === true && d['fgts-1'].status_portal === 'DelayNotSent', 'FGTS aberto');
  t(d['seg-1']?.motivo_reprovacao === 'Falta a relação' && d['seg-1'].status_portal === 'DelayRejected', 'reprovado com o motivo');
  const saude = (await q(`select * from documentos where nome like 'Plano de Sa%'`))[0];
  t(saude.aberto_no_portal === false && saude.estado === 'ENVIADO' && saude.status_portal === 'Approved', 'Plano de Saúde fechado (Entregues)');
  const bern = (await q(`select * from documentos where portal = 'Bernhoeft'`))[0];
  t(bern.aberto_no_portal === true && bern.aba === 'Não Entregue' && bern.situacao === 'Não Entregue', 'linha do Bernhoeft intocada');
  const abertosAtlas = (await q(`select count(*)::int n from documentos where portal = 'Atlas' and aberto_no_portal`))[0].n;
  t(abertosAtlas === 3, `abertas no banco = abertas no portal (3), deu ${abertosAtlas}`);
  let col = await q('select * from coletas order by id');
  const tt = col[0]?.totais || {};
  t(col.length === 1 && col[0].ok === true && tt.abertos === 3 && tt.reprovados === 1 && tt.atrasados === 2 && tt.saidos_entregues === 1 && col[0].inicio && col[0].fim, 'coletas: 1 linha ok, abertos 3 (Reprovados não soma), 1 saiu para Entregues');
  t(d['vt-1'].situacao_portal === 'NO_PRAZO' && d['fgts-1'].situacao_portal === 'ATRASADO' && d['seg-1'].situacao_portal === 'REPROVADO' && saude.situacao_portal === 'APROVADO', 'situacao_portal no vocabulário do ODA');

  // D. Leitura sem o motivo (consulta falhou): o motivo antigo fica; mesma leitura de novo não duplica coletas
  atlasDb([VT, FGTS, { ...SEG, motivo_reprovacao: null }], '2026-11-10T15:00:00.000Z', { a: 2, p: 1, r: 1, e: 11 });
  await rodar({ entregues: ent });
  await rodar({ entregues: ent });
  t((await q(`select motivo_reprovacao from documentos where portal_item_id = 'seg-1'`))[0].motivo_reprovacao === 'Falta a relação', 'motivo não some quando a leitura vem sem ele');
  col = await q('select * from coletas order by id');
  t(col.length === 2, `mesma leitura 2 vezes = 1 linha em coletas (deu ${col.length})`);

  // E. FGTS sai e não está em Entregues: Fora do Atlas e fechado
  atlasDb([VT, SEG, SEG_REP], '2026-11-10T16:00:00.000Z', { a: 1, p: 1, r: 1, e: 11 });
  await rodar({ entregues: ent });
  const fg = (await q(`select * from documentos where portal_item_id = 'fgts-1'`))[0];
  t(fg.aberto_no_portal === false && fg.aba === 'Fora do Atlas' && fg.situacao_portal === 'FORA_DO_PORTAL', 'FGTS fora do Atlas e fechado');
  t((await q(`select count(*)::int n from documentos where portal = 'Atlas' and aberto_no_portal`))[0].n === 2, 'abertas = 2');

  // F. Simulação não grava coletas
  atlasDb([VT, SEG], '2026-11-10T17:00:00.000Z', { a: 1, p: 1, r: 0, e: 11 });
  await rodar({ entregues: ent, simular: true });
  t((await q('select count(*)::int n from coletas'))[0].n === 3, 'simulação não grava coletas');

  // G. Reprovado no prazo (PendingRejected): situação "Reprovado (no prazo)" e, se já estava LOCALIZADO, vira REJEITADO pelo trigger
  // (o trigger não está neste banco de teste: confere só a situação gravada)
  const PR = P({ documento: 'Vale Transporte (Relação de Beneficiários + Boleto + Comprovante)', aba: 'Próximas entregas', status: 'PendingRejected', document_schedule_id: 'vt-1' });
  atlasDb([PR, SEG], '2026-11-10T18:00:00.000Z', { a: 1, p: 1, r: 1, e: 11 });
  await rodar({ entregues: ent });
  const vt = (await q(`select * from documentos where portal_item_id = 'vt-1'`))[0];
  t(vt.situacao === 'Reprovado (no prazo)' && vt.situacao_portal === 'REPROVADO', 'PendingRejected = Reprovado (no prazo)');

  // H. Leitura que falhou: linha em coletas com ok = false e o erro, sem URL
  const { gravarColetaFalha } = require(path.join(__dirname, '..', 'atlas-robo', 'neon'));
  await gravarColetaFalha({ sql, inicio: '2026-11-10T19:00:00.000Z', erro: 'Login: código 2FA não chegou postgresql://x:y@h/db' });
  const fal = (await q('select * from coletas where ok = false'))[0];
  t(fal && fal.portal === 'Atlas' && /2FA/.test(fal.erro) && !/postgresql:/.test(fal.erro), 'falha da leitura gravada em coletas (sem URL)');

  console.log(`${ok} ok, ${falhou} falhou`);
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exitCode = falhou ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 1; });
