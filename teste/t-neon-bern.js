// Passo 4 (10/11): bernhoeft-robo/neon-bern.js grava os documentos do 012 no Neon (portal = Bernhoeft), com motivo pela esteira,
// e uma linha por leitura em coletas. Postgres descartável (PGlite) com o esquema do Passo 1 e o SQL das regras do Bernhoeft.
// Rodar: node teste/t-neon-bern.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const PGLITE_DIR = process.env.PGLITE_DIR || path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'Temp', 'gesdoc-teste', 'pglite2');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 't-neon-bern-'));
fs.mkdirSync(path.join(tmp, 'pacotes', 'auto'), { recursive: true });
fs.mkdirSync(path.join(tmp, 'envio'), { recursive: true });
let ok = 0, falhou = 0;
const t = (cond, msg) => { cond ? ok++ : (falhou++, console.log('FALHOU', msg)); };

const BRIG = 'EQT - Brigada de Incêndio com relação de todos os membros, certificados de treinamento, cronograma de reuniões, simulados e relatórios';
const AET = 'EQT - Análise Ergonômica do Trabalho (AET)';
const DD = 'EQT - Certificado de Direção Defensiva (Para todos os condutores)';
const it = (contrato, area, descricao, status) => ({ contrato, contratada: 'NIP GLOBAL LTDA', competencia: 'Documentos de Empresa', area, descricao, status,
  unidade: 'Corporativo', tipo: 'Empresa', chave: `doc:${contrato}|NIP GLOBAL LTDA|Documentos de Empresa|${area}|${descricao}||Corporativo`, docs_pendentes: status === 'Não Entregue' });
const RS = it('4600029828/2024 - RS', 'GERÊNCIA OBRAS', BRIG, 'Não Entregue');
const RS2 = it('4600029828/2024 - RS', 'GERÊNCIA PROJETOS', BRIG, 'Não Entregue'); // mesmo contrato e documento, outra área
const GO = it('5000000897/2025 - GO', 'GERÊNCIA PROJETOS AT', AET, 'Não Entregue');
const DDGO = it('757/2025 - GO', 'GERÊNCIA X', DD, 'Não Entregue');
const PA = it('00223/2025 - PA', 'GERÊNCIA TRANSMISSÃO', 'EQT - Projeto de Prevenção e Combate Incêndio e AVCB da edificação', 'Não Analisado');
const NOVO = it('356/2026 - MA', 'GERÊNCIA Y', 'EQT - Documento que ninguém cadastrou', 'Não Entregue');
const doc = (itens, lido = true, em = '2026-11-10T21:00:00.000Z') => ({ coletado_em: em, itens: [{ chave: 'comp:x', status: 'x' }, ...itens],
  relatorio012: { pedidos: [{ status: 'Sem Conteúdo', solicitado_em: '10/11/2026 00:23:02' }, { status: 'Concluido', solicitado_em: '30/10/2026 10:42:00' }], ...(lido ? { documentos_por_status: { x: 1 } } : {}) } });

(async () => {
  const { PGlite } = await import(pathToFileURL(path.join(PGLITE_DIR, 'node_modules', '@electric-sql', 'pglite', 'dist', 'index.js')).href);
  const pg = new PGlite();
  await pg.exec(`
    create role robo_atlas;
    create table documento_regras (id serial primary key, doc_id int not null unique, nome varchar not null, descricao text, categoria varchar,
      origem varchar not null, destino varchar not null, chave varchar, competencia varchar, ativo boolean default true);
    create table documento_regra_destinos (doc_id int not null references documento_regras(doc_id), destino varchar not null, primary key (doc_id, destino));
    insert into documento_regras (doc_id, nome, origem, destino) values (24, 'GFD', 'SharePoint', 'Atlas'), (112, 'Certificado de Direção Defensiva', 'Factorial', 'Bernhoeft');
    create table documentos (id serial primary key, doc_id int not null references documento_regras(doc_id), colaborador_id varchar, competencia varchar, estado varchar not null,
      criado_em timestamp default now(), atualizado_em timestamp, prazo_envio date, cliente varchar, unidade varchar, nome varchar, categoria varchar,
      aba varchar, situacao varchar, funcionario varchar, cpf varchar(11), tipo varchar, grupo varchar, numero_pedido varchar, cnpj_filial varchar(14),
      portal varchar, portal_item_id varchar, status_portal varchar, situacao_portal varchar, motivo_reprovacao text, aberto_no_portal boolean,
      visto_no_portal_em timestamptz, motivo varchar, responsavel varchar, motivo_em timestamptz);
    create unique index documentos_chave_natural on documentos (cliente, doc_id, cpf, cnpj_filial, competencia, nome, numero_pedido, prazo_envio) nulls not distinct;
    create table coletas (id bigserial primary key, portal varchar not null, inicio timestamptz not null default now(), fim timestamptz, ok boolean, totais jsonb, erro text);
    insert into documentos (doc_id, estado, portal, aba, aberto_no_portal, nome) values (24, 'PENDENTE_ENVIO', 'Atlas', 'Atrasados', true, 'GFD');
  `);
  await pg.exec(fs.readFileSync(path.join(__dirname, '..', 'docs', 'sql', '2026-11-10-regras-bernhoeft.sql'), 'utf8'));
  await pg.exec(`
    grant select on documentos, documento_regras to robo_atlas;
    grant insert (doc_id, competencia, estado, cliente, unidade, nome, categoria, aba, situacao, tipo, grupo, numero_pedido, portal, portal_item_id,
      status_portal, situacao_portal, aberto_no_portal, visto_no_portal_em, motivo, responsavel, motivo_em) on documentos to robo_atlas;
    grant update (doc_id, competencia, estado, cliente, unidade, nome, categoria, aba, situacao, tipo, grupo, numero_pedido, portal, portal_item_id,
      status_portal, situacao_portal, aberto_no_portal, visto_no_portal_em, motivo, responsavel, motivo_em, atualizado_em) on documentos to robo_atlas;
    grant usage on sequence documentos_id_seq, coletas_id_seq to robo_atlas;
    grant select, insert on coletas to robo_atlas;
    set role robo_atlas;
  `);
  t((await pg.query(`select count(*)::int n from documento_regras where doc_id between 201 and 217 and destino = 'Bernhoeft'`)).rows[0].n === 17, 'SQL: 17 regras do Bernhoeft');
  const sql = {
    query: (text, params = []) => ({ text, params, then: (a, b) => pg.query(text, params).then((r) => r.rows).then(a, b) }),
    transaction: async (qs) => { await pg.exec('begin'); try { const out = []; for (const q of qs) out.push((await pg.query(q.text, q.params)).rows); await pg.exec('commit'); return out; } catch (e) { await pg.exec('rollback'); throw e; } },
  };
  const q = async (s) => (await pg.query(s)).rows;
  const { gravar, gravarFalha } = require(path.join(__dirname, '..', 'bernhoeft-robo', 'neon-bern'));
  // esteira: RS pronto com confiança baixa; GO pronto com confiança alta; DD sem regra de busca; RS2 sem arquivo
  fs.writeFileSync(path.join(tmp, 'pacotes', 'auto', 'estado.json'), JSON.stringify({ itens: [
    { pendencia: { chave: RS.chave }, estado: 'pronto', confianca: 'baixa', motivo: 'genérico (o nome não cita contrato nem estado): conferir' },
    { pendencia: { chave: GO.chave }, estado: 'pronto', confianca: 'alta' },
    { pendencia: { chave: DDGO.chave }, estado: 'nao_encontrado', motivo: 'tipo de documento sem regra de busca' },
    { pendencia: { chave: RS2.chave }, estado: 'nao_encontrado', motivo: 'nenhum arquivo deste tipo para este contrato/estado' },
  ] }));
  fs.writeFileSync(path.join(tmp, 'envio', 'modo.json'), JSON.stringify({ liberado: true, automatico: true, confianca: 'media' }));
  const logs = [];
  const op = { sql, pacotes: path.join(tmp, 'pacotes'), dirEnvio: path.join(tmp, 'envio'), log: (m) => logs.push(m), inicio: '2026-11-10T20:59:00.000Z' };

  const r1 = await gravar({ ...op, doc: doc([RS, RS2, GO, DDGO, PA, NOVO]) });
  const d = Object.fromEntries((await q(`select * from documentos where portal = 'Bernhoeft'`)).map((x) => [x.portal_item_id, x]));
  t(Object.keys(d).length === 5, `5 gravados (o sem regra fica de fora), deu ${Object.keys(d).length}`);
  t(logs.some((l) => /sem regra.*ninguém cadastrou/.test(l)), 'sem regra listado no log');
  t(d[RS.chave] && d[RS2.chave] && d[RS.chave].id !== d[RS2.chave].id, 'mesmo contrato/documento em duas áreas = duas linhas');
  t(d[RS.chave].motivo === 'confianca_baixa' && d[RS.chave].responsavel === 'operacao', 'pronto com confiança abaixo da mínima = operacao/confianca_baixa');
  t(d[GO.chave].motivo === 'pronto' && d[GO.chave].responsavel === 'sistema', 'pronto com confiança suficiente = sistema/pronto');
  t(d[DDGO.chave].motivo === 'sem_robo' && d[RS2.chave].motivo === 'falta_arquivo' && d[RS2.chave].responsavel === 'cliente', 'sem regra de busca / sem arquivo');
  t(d[RS.chave].aberto_no_portal === true && d[RS.chave].situacao_portal === 'ATRASADO' && d[RS.chave].estado === 'PENDENTE_ENVIO', 'Não Entregue = aberto, ATRASADO, PENDENTE_ENVIO');
  t(d[PA.chave].aberto_no_portal === false && d[PA.chave].situacao_portal === 'EM_ANALISE' && d[PA.chave].estado === 'ENVIADO' && d[PA.chave].motivo == null, 'Não Analisado = fechado, EM_ANALISE, ENVIADO');
  t((await q(`select aba from documentos where portal = 'Atlas'`))[0].aba === 'Atrasados', 'linha do Atlas intocada');
  let col = await q(`select * from coletas where portal = 'Bernhoeft' order by id`);
  t(col.length === 1 && col[0].ok && col[0].totais.nao_entregue === 5 && col[0].totais.gravadas === 5 && col[0].totais.sem_regra === 1 && col[0].totais.aviso === null, 'coletas: 1 linha com os totais');
  t(col[0].totais.relatorio_012.usado === '30/10/2026 10:42:00', 'coletas: data do 012 usado');

  // 2ª leitura com o xlsx velho (pedido de hoje sem conteúdo): atualiza, ninguém sai, aviso no totais
  await gravar({ ...op, doc: doc([RS, RS2, GO, DDGO, PA], false, '2026-11-10T21:30:00.000Z') });
  t((await q(`select count(*)::int n from documentos where portal = 'Bernhoeft'`))[0].n === 5, 'leitura repetida não duplica');
  col = await q(`select * from coletas where portal = 'Bernhoeft' order by id`);
  t(col.length === 2 && /sem conteúdo/i.test(col[1].totais.aviso || ''), 'aviso quando o 012 de hoje não veio');

  // 3ª leitura (xlsx novo): GO foi enviado (Não Analisado), RS2 saiu do 012
  await gravar({ ...op, doc: doc([RS, { ...GO, status: 'Não Analisado' }, DDGO, PA], true, '2026-11-11T09:00:00.000Z') });
  const d3 = Object.fromEntries((await q(`select * from documentos where portal = 'Bernhoeft'`)).map((x) => [x.portal_item_id, x]));
  t(d3[GO.chave].estado === 'ENVIADO' && d3[GO.chave].aberto_no_portal === false && d3[GO.chave].motivo == null, 'enviado: fechado e sem motivo');
  t(d3[RS2.chave].aberto_no_portal === false && d3[RS2.chave].situacao_portal === 'FORA_DO_PORTAL', 'saiu do 012: fechado, FORA_DO_PORTAL');
  t((await q(`select count(*)::int n from documentos where portal = 'Bernhoeft' and aberto_no_portal`))[0].n === 2, 'abertos = 2 (RS e DD)');

  // Falha da leitura
  await gravarFalha({ sql, inicio: '2026-11-11T10:00:00.000Z', erro: 'Sessão expirada (login automático falhou). postgresql://a:b@c/d' });
  const fal = (await q(`select * from coletas where portal = 'Bernhoeft' and ok = false`))[0];
  t(fal && /login/.test(fal.erro) && !/postgresql:/.test(fal.erro), 'falha gravada sem URL');

  console.log(`${ok} ok, ${falhou} falhou`);
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exitCode = falhou ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 1; });
