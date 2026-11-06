// Neon x Atlas "Entregues" (04/11): linha do Neon que saiu das listas (Atrasados/Próximas) e aparece em Entregues no Atlas
// vira ENVIADO (entregue no portal, pelo robô ou por fora). Caso real: CPF com 4 linhas no Neon paradas em "A enviar" e
// 6 documentos "Entregues" no Atlas; e a #463 (ENVIADO com situação "A enviar").
// Roda num Postgres descartável (PGlite) com as permissões do robo_atlas (seguranca/roles.sql) e um atlas.db falso.
// Rodar: node teste/t-neon-entregues.js   (PGlite em %TEMP%/gesdoc-teste/pglite ou PGLITE_DIR)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { DatabaseSync } = require('node:sqlite');

const PGLITE_DIR = process.env.PGLITE_DIR || path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'Temp', 'gesdoc-teste', 'pglite2');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 't-neon-entregues-'));
process.env.ATLAS_DB = path.join(tmp, 'atlas.db');
let ok = 0, falhou = 0;
const t = (cond, msg) => { cond ? ok++ : (falhou++, console.log('FALHOU', msg)); };

const COLETADO = '2026-11-04T13:59:00.000Z';
const base = { cliente: 'Equatorial Energia', categoria: 'Prestação de Serviço', tipo: 'Recorrente', grupos: null, n_docs: 1, validade: null, critico: 0 };
// pendência no formato do pendencias.js
const P = (o) => ({ ...base, aba: 'Atrasados', status: 'DelayNotSent', funcionario: null, cpf: null, enviado_em: null, validado_em: null,
  cnpj_filial: '02867678000797', pedido: '00361', unidades: 'EQUATORIAL GOIÁS', competencia: '10/2026', prazo_envio: '2026-11-10', ...o });

const VT = P({ documento: 'Vale Transporte (Relação de Beneficiários + Boleto + Comprovante)', aba: 'Próximas entregas', status: 'PendingNotSent' });
const ASO = (n, comp) => P({ documento: 'ASO Demissional', tipo: 'Desmobilização', funcionario: 'FULANO DE TESTE', cpf: '111.222.333-44', competencia: comp, prazo_envio: `2026-${comp.slice(0, 2)}-15` });
const FGTS = P({ documento: 'FGTS - Guia de recolhimento (boleto)' });
const SEGURO = P({ documento: 'Seguro de Vida (Relação de Beneficiários + Boleto + Comprovante)' });
const SAUDE = P({ documento: 'Plano de Saúde (Relação de Beneficiários + Boleto + Comprovante)' }); // sai das listas e não aparece em Entregues
const FGTS9 = P({ documento: 'FGTS - Guia de recolhimento (boleto)', competencia: '09/2026', prazo_envio: '2026-10-10' }); // depois só em Reprovados

function atlasDb(linhas) {
  if (fs.existsSync(process.env.ATLAS_DB)) fs.rmSync(process.env.ATLAS_DB);
  const db = new DatabaseSync(process.env.ATLAS_DB);
  const cols = Object.keys(P({ documento: '' }));
  db.exec(`create table coletas (id integer primary key, coletado_em text); create table pendencias (id integer primary key, coleta_id int, ${cols.map((c) => c + ' text').join(', ')})`);
  db.prepare('insert into coletas (id, coletado_em) values (1, ?)').run(COLETADO);
  const ins = db.prepare(`insert into pendencias (coleta_id, ${cols.join(', ')}) values (1, ${cols.map(() => '?').join(', ')})`);
  for (const l of linhas) ins.run(...cols.map((c) => (l[c] == null ? null : String(l[c]))));
  db.close();
}

(async () => {
  const { PGlite } = await import(pathToFileURL(path.join(PGLITE_DIR, 'node_modules', '@electric-sql', 'pglite', 'dist', 'index.js')).href);
  const pg = new PGlite();
  await pg.exec(`
    create role robo_atlas;
    create table documento_regras (doc_id int unique not null, ativo boolean default true);
    insert into documento_regras (doc_id) values (3), (4), (7), (24), (67);
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
  // Igual ao driver do Neon: sql.query() é preguiçoso (só roda no await ou na transaction), transaction() roda tudo junto.
  const sql = {
    query: (text, params = []) => ({ text, params, then: (a, b) => pg.query(text, params).then((r) => r.rows).then(a, b) }),
    transaction: async (qs) => { await pg.exec('begin'); try { const out = []; for (const q of qs) out.push((await pg.query(q.text, q.params)).rows); await pg.exec('commit'); return out; } catch (e) { await pg.exec('rollback'); throw e; } },
  };
  await pg.exec('set role robo_atlas');
  const { enviarNeon } = require(path.join(__dirname, '..', 'atlas-robo', 'neon'));
  const logs = [];
  const rodar = (o = {}) => enviarNeon({ sql, log: (m) => logs.push(m), ...o });
  const linha = async (where) => (await pg.query(`select * from documentos where ${where}`)).rows;

  // 1ª coleta: tudo pendente (VT, 4 ASO do mesmo CPF, FGTS, Seguro, Plano de Saúde, FGTS 09)
  const asos = [ASO(1, '07/2026'), ASO(2, '08/2026'), ASO(3, '09/2026'), ASO(4, '10/2026')];
  atlasDb([VT, ...asos, FGTS, SEGURO, SAUDE, FGTS9]);
  await rodar({ entregues: [] });
  t((await linha('true')).length === 9, '1ª coleta grava 9 linhas');
  // nosso robô enviou o VT (como a #463: está no envios.log) e o ASO 10/2026 (log perdido, mas o enviar.js gravou a situação);
  // achou o Seguro (LOCALIZADO); uma linha de outro processo (aba vazia) igual ao FGTS
  await pg.exec('reset role');
  await pg.exec(`update documentos set estado = 'ENVIADO', atualizado_em = now() where nome like 'Vale Transporte%';
    update documentos set estado = 'LOCALIZADO' where nome like 'Seguro%';
    update documentos set estado = 'ENVIADO', situacao = 'Enviado pela automação (automático)' where cpf = '11122233344' and competencia = '10/2026';
    insert into documentos (doc_id, estado, nome, competencia, numero_pedido, prazo_envio) values (24, 'PENDENTE_ENVIO', 'FGTS - Guia de recolhimento (boleto)', '10/2026', '00361', '2026-11-10');`);
  await pg.exec('set role robo_atlas');
  const idVt = (await linha(`nome like 'Vale Transporte%'`))[0].id;
  fs.writeFileSync(path.join(tmp, 'envios.log'), `[2026-10-26T21:15:20.000Z] #${idVt} schedule 9 ...
[2026-10-26T21:15:26.000Z] #${idVt} ENVIADO ao schedule 9; status no Atlas agora: WaitingForPredecessors
[x] #999 PULOU
`);

  // 2ª coleta: VT, os 4 ASO e o Seguro saíram das listas (entregues no Atlas); FGTS continua atrasado.
  // Entregues traz também um 5º e 6º ASO que nunca passaram pelas listas (não estão no Neon: nada a marcar).
  atlasDb([FGTS, { ...FGTS9, aba: 'Reprovados', status: 'Rejected' }]);
  const ent = [
    { ...VT, aba: 'Entregues', status: 'WaitingForPredecessors', enviado_em: '2026-10-26T21:15:26' },
    ...asos.map((a, i) => ({ ...a, aba: 'Entregues', status: i === 0 ? 'Approved' : 'WaitingAnalysis', enviado_em: `2026-10-2${i}T10:00:00`, validado_em: i === 0 ? '2026-10-25T09:00:00' : null })),
    { ...ASO(5, '05/2026'), aba: 'Entregues', status: 'Approved' }, { ...ASO(6, '06/2026'), aba: 'Entregues', status: 'Approved' },
    { ...SEGURO, aba: 'Entregues', status: 'XyzNovo' },
    { ...FGTS, aba: 'Entregues', status: 'Approved' }, // impossível na prática, mas a linha que ainda está nas listas manda
  ];
  // simulação não grava nada
  let r = await rodar({ entregues: ent, simular: true });
  t(r.entregues === 6 && r.fora === 1 && (await linha(`estado = 'ENVIADO'`)).length === 2 && !(await linha(`aba = 'Fora do Atlas'`)).length, 'simulação: conta 6 + 1 fora e não grava');
  // sem a lista Entregues: nada muda
  r = await rodar({ entregues: null });
  t(r.entregues === 0 && r.fora === 0 && (await linha(`aba in ('Entregues', 'Fora do Atlas')`)).length === 0, 'sem lista Entregues: nada marcado');
  t(logs.some((m) => /sem a lista Entregues/.test(m)), 'sem lista: avisa no log');

  r = await rodar({ entregues: ent });
  t(r.entregues === 6, `marca 6 (VT + 4 ASO + Seguro): ${r.entregues}`);
  t(r.pelaAutomacao === 2 && r.manuais === 4, `2 pela automação, 4 manuais: ${r.pelaAutomacao}/${r.manuais}`);
  const vt = (await linha(`nome like 'Vale Transporte%'`))[0];
  t(vt.estado === 'ENVIADO' && vt.aba === 'Entregues' && vt.situacao === 'Entregue pela automação: aguardando predecessores', `#463 (envios.log): situação deixa de ser "A enviar" (${vt.situacao})`);
  const as = await linha(`cpf = '11122233344' order by competencia`);
  t(as.length === 4 && as.every((x) => x.estado === 'ENVIADO' && x.aba === 'Entregues'), 'os 4 ASO do CPF viram ENVIADO');
  t(as[0].situacao === 'Entregue manualmente no portal: aprovado' && as[0].validado_em && as[1].situacao === 'Entregue manualmente no portal: em análise', 'situação e validação vêm do Atlas; sem prova do robô = manual');
  t(as[3].situacao === 'Entregue pela automação: em análise', `enviado pelo robô sem envios.log: a situação do enviar.js prova (${as[3].situacao})`);
  t(as.every((x) => x.enviado_em), 'data de envio vem do Atlas');
  t((await linha(`cpf = '11122233344'`)).length === 4, 'os ASO que nunca passaram pelas listas não criam linha');
  const seg = (await linha(`nome like 'Seguro%'`))[0];
  t(seg.estado === 'ENVIADO' && seg.situacao === 'Entregue manualmente no portal: (XyzNovo)', `LOCALIZADO entregue por fora vira ENVIADO (não sai de novo): ${seg.estado} ${seg.situacao}`);
  const fg = await linha(`nome like 'FGTS%' and competencia = '10/2026' order by id`);
  t(fg[0].estado === 'PENDENTE_ENVIO' && fg[0].aba === 'Atrasados', 'linha que continua nas listas não é marcada');
  t(fg[1].aba === null && fg[1].estado === 'PENDENTE_ENVIO', 'linha de outro processo (aba vazia) nunca é tocada');

  const sd = (await linha(`nome like 'Plano de Saúde%'`))[0];
  t(sd.aba === 'Fora do Atlas' && sd.situacao === 'Não aparece mais no Atlas' && sd.estado === 'PENDENTE_ENVIO', 'saiu das listas e não está em Entregues: "Não aparece mais no Atlas", estado igual');
  const f9 = (await linha(`nome like 'FGTS%' and competencia = '09/2026'`))[0];
  t(f9.aba === 'Atrasados', 'só em Reprovados: não é marcada como fora');

  // 3ª coleta igual: não regrava quem já está marcado (atualizado_em não muda)
  const antes = vt.atualizado_em.getTime();
  r = await rodar({ entregues: ent });
  t(r.entregues === 0 && r.fora === 0 && (await linha(`nome like 'Vale Transporte%'`))[0].atualizado_em.getTime() === antes, 'rodada seguinte não regrava');
  // voltou a aparecer nas listas: a coleta reescreve aba e situação
  atlasDb([FGTS, SAUDE]);
  r = await rodar({ entregues: ent });
  const sd2 = (await linha(`nome like 'Plano de Saúde%'`))[0];
  t(sd2.aba === 'Atrasados' && sd2.situacao === 'Não enviado no prazo', `voltou ao Atlas: aba/situação da coleta (${sd2.aba} / ${sd2.situacao})`);
  atlasDb([FGTS]);

  // lista do arquivo: só vale se for da mesma coleta
  fs.writeFileSync(path.join(tmp, 'entregues.json'), JSON.stringify({ coletado_em: '2026-11-04T12:00:00.000Z', itens: ent }));
  await pg.exec('reset role'); await pg.exec(`update documentos set estado = 'PENDENTE_ENVIO', aba = 'Atrasados' where nome like 'Vale Transporte%'`); await pg.exec('set role robo_atlas');
  r = await rodar();
  t(r.entregues === 0, 'entregues.json de outra coleta: ignorado');
  fs.writeFileSync(path.join(tmp, 'entregues.json'), JSON.stringify({ coletado_em: COLETADO, itens: ent }));
  r = await rodar();
  t(r.entregues === 1, `entregues.json da mesma coleta: usado (${r.entregues})`);

  console.log(`${ok} ok, ${falhou} falhou`);
  process.exitCode = falhou ? 1 : 0;
  fs.rmSync(tmp, { recursive: true, force: true });
})().catch((e) => { console.error('ERRO', e); process.exitCode = 1; });
