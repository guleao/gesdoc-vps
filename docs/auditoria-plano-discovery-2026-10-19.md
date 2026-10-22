# Auditoria 19/10: projeto × plano de tarefas × discovery da Milena

Fontes comparadas:
- **Plano**: `EQT_GesDoc_36_Documentos_Stant_LabIA_Excel - Tarefas.pdf` (os dois PDFs de Downloads são o mesmo arquivo, mesmo md5). Feito marcado só em F1.1–F1.24 (menos F1.8 e F1.23) e F3.2–F3.4.
- **Discovery**: `Discovery_Oficial_Milena_EQT_36_Documentos.xlsx`. Controle 36: os **36 documentos estão "Não iniciado"**; só os docs 2, 3, 4, 6, 7, 26 e 66 têm fala ou passo a passo da Milena; nenhuma "Regra oficial normalizada" (seção C) foi preenchida.
- **Projeto**: código deste repositório e o Neon (consulta só leitura com o `robo_atlas`: `documento_regras` e contagem por doc/estado). A VPS não foi acessada nesta auditoria.

## 1. O que a Milena disse e o código ainda não segue

| Doc | O que a Milena disse | Como está no projeto | O que fazer |
|---|---|---|---|
| 2, 4, 7 (VA, seguro, saúde) | Um PDF só, na ordem **relação de beneficiários → boleto → comprovante**; o mesmo PDF sobe em cada pendência do mês | `sharepoint.js` lista as partes em **ordem alfabética do nome do arquivo** e pega **todos** os PDFs da pasta. A união ainda não existe | Na hora de unir: classificar cada parte (relação/boleto/comprovante) e montar nessa ordem, nunca pela ordem do nome |
| 7 (saúde) | A pasta tem **nota fiscal, que não vai** ("eles não exigem"); a listagem de beneficiários tem que vir padronizada todo mês | A NF entra na lista de partes do painel | Excluir NF das partes; pedir à NIP o padrão da listagem |
| 3 (VT) | Tem **complementares** (recarga de colaborador depois do envio). Ordem: relação + relação compl. + boleto + boleto compl. + comprovante + comprovante compl. A Joana Novais tira as relações **do portal CAJU** | Sem tratamento de complementar. A planilha diz que a fonte do VT é **GVBus** | Regra própria para o 3; confirmar CAJU × GVBus |
| 6 (VR) | **Não é documento: é uma declaração** que sobe para cada colaborador | `SEM_REGRA[6]` diz "não há pasta de VR" | Trocar o motivo; saber quem escreve a declaração e se há modelo |
| 26 (comprovante FGTS) | O nome do arquivo **não traz a unidade** (CEA = Amapá); sem isso não dá para saber de qual unidade é | A regra 26 não filtra por unidade; hoje não acha nada (bate com a fala dela) | Pedir à NIP a unidade no nome, ou casar pelo conteúdo (CNPJ do tomador ou valor) |
| 66 (ocorrências) | Baixa **o modelo no próprio Atlas** e preenche a planilha | `documento_regras.origem = SharePoint` e o motivo é "não achei pasta no SharePoint". O plano (O1.2) manda gerar o relatório a partir da Factorial, com aprovação humana | Corrigir a origem (não é SharePoint); decidir entre o modelo do Atlas e a geração pela Factorial |
| 2 (passo 4) | Ela exporta o relatório de atrasados no Atlas | O robô lê pela API e a regra do projeto proíbe "Exportar relatório" | Sem conflito: só registrar que o robô substitui esse passo |

## 2. Regras gravadas que não vieram da Milena (risco de "completar lacuna")

O guia do discovery diz para **não completar lacunas por conhecimento técnico**. Mesmo assim, estas regras estão em uso:
- **Pastas e nomes de arquivo** em `sharepoint.js` (24, 25, 26, 60, 61, 64, 65, 81) e `factorial.js` (67, 68, 69) foram deduzidos olhando as pastas. Nenhum desses docs foi demonstrado. O caso mais sensível: a **GFD (24) achada 7 vezes com o mesmo arquivo para 7 unidades**. Falta confirmar que uma guia vale para todas.
- **`documento_regras`**: `prazo_dias` e `validade_dias` preenchidos só nos docs 8 (7/180), 69 (30/365), 78 (90/730) e 83 (15/90), sem fonte na planilha (lá está "a confirmar"). Nas certidões a validade está vazia, embora a planilha diga CRF 30 dias, CND e CNDT 6 meses. `periodicidade` está vazia nos 36 (a planilha dá: 24 e 65 vencem dia 20, 56 até o 5º dia útil, 60 até o último dia útil, 66 até o dia 10, 84 anual).
- **Doc 9 (TRCT)**: `compor.js` usa **3 partes** (TRCT → termo de quitação → comprovante). A planilha diz "TCRT + comprovante" e o plano (F3.14) diz "9 e 10 em duas partes". O nome no Neon está "TCRT" (erro de digitação herdado da planilha).
- **Pacote 01**: o plano (F3.14, C3.13) diz que GFD + RE + comprovante formam um pacote só. O Neon tem 24, 25 e 26 como pendências separadas, com `requer_composicao = false`. Confirmar qual vale no Atlas.
- **78 e 79**: a planilha e o plano (C1.11) dizem que vão para **Atlas e Bernhoeft**, com estado separado por destino. `documento_regras.destino` diz só Atlas. Pode estar certo em `documento_destinos`, mas o `robo_atlas` não tem permissão para ler essa tabela, então não deu para conferir.
- **`enviar.js`** manda sempre `validity_date: null`. Para certidões (64, 81, 82) e ASO, a validade provavelmente importa no Atlas.

## 3. Arquitetura: o plano diz uma coisa, o projeto faz outra

| Plano | Realidade | Situação |
|---|---|---|
| F1.6/F1.7 ✓: Postgres em contêiner na VPS, `gesdoc_homolog` e `gesdoc_prod` | Robôs, painel e a sincronização do Evilásio usam o **Neon de produção**. Os contêineres **hml** gravam nele | Divergência sem registro (`docs/decisoes/001-banco.md` não está no repo). Já está na prioridade 4 (branch hml) |
| n8n orquestra tudo (F2, F3.26–37, um workflow por módulo, O2.3 mestre) | n8n com **0 workflows** (auditoria da VPS de 01/10). Quem orquestra é o laço do `robo.js` e o cron Python do Evilásio | Decidir: atualizar o plano ou migrar para n8n |
| F3.4 ✓: idempotência no Redis | Idempotência pela chave única do Neon e pelo `where estado = ...` | Funciona, mas o plano está desatualizado |
| F3.1: tabelas `competencias`, `estados_por_destino`, `hashes`, `fila_intervencao`, `calendario`, `notificacoes`, `auditoria` | No Neon há `documentos`, `documento_regras`, `documento_destinos`, `documento_protocolos`, `documento_envios`, `alerta`. **Sem migrations versionadas** neste repo | Já está na prioridade 5. F3.2 marcado como feito no plano não corresponde ao banco usado |
| F3.5–F3.12: motor de validação (estrutura, semântica por CPF/competência, hash, retificação) | Só confere extensão, tamanho e SHA-256 do próprio arquivo, além de nome e status no Atlas. **Não lê o conteúdo** (CPF ou competência dentro do PDF) e **não barra o mesmo arquivo em duas pendências** | Falta antes de liberar o envio |
| F3.39–41, CI: testes automatizados | Não há suíte nem CI neste repo (só os testes soltos em `%TEMP%/gesdoc-teste`) | Falta |
| F4.10, F7.5: login e perfis | Painel sem login; a proteção é só o Tailscale | Aceitável em hml; falta para prod |
| Fontes primárias (CAJU, GVBus, Santander, FGTS Digital, Serpro, Domínio, Caixa, TST) | **Lê o SharePoint**, onde a NIP guarda à mão. Isso não está no plano | Bom atalho para a fase 1, mas depende de a NIP continuar arquivando. Registrar como "caminho alternativo" nas fichas (C*.2) |

## 4. O que está em dia ou adiantado em relação ao plano

- O2.5/O2.6: leitores de pendências do Atlas e do Bernhoeft rodando na VPS e gravando no Neon.
- F3.16: envio ao Atlas implementado e conferido (177 schedule_ids, travas por nome e status). **Não rodado**, por causa da proibição de 15/10.
- F3.17 e F5.4: `docs/contratos/bernhoeft.md`, `docs/excecoes/bernhoeft.md`, `docs/spikes/captcha.md`, `docs/workers/padrao.md`. F3.18–19 bloqueados porque a conta não tem permissão de envio.
- F3.24: serviço de navegação (Playwright) no ar. Gotenberg de reserva.
- C1 (Factorial), em parte: 67, 68 e 69 achados por CPF, pasta e nome (`factorial.js`). A união de 8, 9 e 10 fica com o Evilásio.
- F4.7/F4.9/F7.2, em parte: painel com estado por documento, rastro, PDFs, ao vivo e saúde.
- F7.5, em parte: `seguranca/roles.sql` pronto, ainda não aplicado.

## 5. Status do cronograma

Pelo PDF, tudo deveria ter acontecido entre 23/09 e 20/10 (handover em 19–20/10). O PDF marca como feitos só a infra (F1) e F3.2–F3.4. Nenhum release (1 a 9) saiu e nenhum módulo C* foi liberado. O que existe de fato (leitores, painel, busca na Factorial e no SharePoint) não está marcado no PDF. **O PDF não reflete o projeto e o projeto não segue o PDF.** Os dois precisam ser reconciliados com o Augusto.

## 6. Ordem sugerida

1. **Terminar o discovery com a Milena** antes de ligar o `--gravar` ou a união: os docs 8, 24, 78, 81 e 60 inteiros (o guia já tem roteiro de 2 h). Junto, as perguntas de baixo, que destravam código já escrito.
2. Corrigir já, sem depender de ninguém: `origem` do 66; motivo do 6; ordem e filtro das partes dos benefícios (sem NF; relação → boleto → comprovante; complementares no 3).
3. Perguntas para a Milena/NIP: uma GFD vale para todas as unidades? Unidade no nome do comprovante do FGTS. TRCT tem 2 ou 3 partes? GFD + RE + comprovante sobem juntos ou separados? Quem faz a declaração do VR? VT vem do CAJU ou da GVBus? Prazos e validades por documento.
4. Com o Augusto: registrar a decisão Neon × Postgres da VPS e n8n × robôs Node, e atualizar o PDF de tarefas com o que já existe.
5. Antes de liberar o envio: validação de conteúdo (CPF e competência no PDF), bloqueio do mesmo hash em duas pendências, `validity_date` para certidões e ASO, e destino duplo do 78 e do 79.

## 7. Atualização: 2ª versão da planilha (19/10, à tarde)

Agora 29 dos 36 documentos têm fala ou passo a passo da Milena (antes eram 7). Continuam **todos "Não iniciado"** no Controle 36, e nenhuma "Regra oficial normalizada" foi preenchida: são relatos ainda não confirmados. Sem nada: 5 (odonto), 84, 95 e 112–116.
Responsáveis citados na NIP: Joana Novais (VT), Gabriela Mathias (DCTFWeb, folha e CND), Tatiana Almeida (baixa na CTPS).

**Confirma o que o código já faz**
- 8: aviso → recibo → comprovante, na pasta Férias da Factorial (igual ao `compor.js`).
- 10: guia do FGTS + comprovante, na pasta Offboarding, unidos (igual ao `compor.js`).
- 25 e 60: SharePoint, pasta ano/mês/FGTS e INSS (igual ao `sharepoint.js`).
- 61: "relatório completo da DCTFWeb" na pasta INSS (bate com a regra `declaracao completa`).
- 68: Offboarding, baixa da carteira (igual ao `factorial.js`).

**Contradiz ou muda o código**

| Doc | Milena (v2) | Projeto hoje | Ação |
|---|---|---|---|
| 9 TRCT | Pega **um arquivo só**, "comprovante TRCT", em Offboarding, e sobe | `compor.js` une 3 partes; o nome do Atlas "Comprovante de Pagamento do TRCT" está **sem par** no `neon.js` | Confirmar se é arquivo único. Se for, entra no `factorial.js` como 67–69 e o nome sem par vai para o 9 |
| 69 | "Pedido de desligamento" ou "pedido de demissão" | O `factorial.js` aceita também **"aviso prévio"** (que pode ser aviso do empregador, outro documento) e **não** aceita "pedido de desligamento" | Tirar "aviso prévio" e incluir "pedido de desligamento" |
| 56 | Pasta do mês → "comprovante de salário": **baixar todos e unir num PDF só** | `SEM_REGRA[56]`: "falta a regra de quais unir" | A regra é unir todos (implementável) |
| 59 | Pasta INSS do mês tem o comprovante de recolhimento; "**já está subindo automático**" | `SEM_REGRA[59]`: "não achei na pasta INSS" | Rever o nome do arquivo na pasta. Descobrir **quem já envia** (risco de envio em dobro) |
| 63 | Pasta **FOPAG** do mês → extrato da folha mensal; "**já está automatizado**" (Gabriela) | Sem regra no `sharepoint.js`. "Folha de Pagamento Mensal Analítica" está sem par no `neon.js` (provavelmente é o 63) | Regra `FOPAG` + `extrato`; mapear o nome; descobrir quem já envia |
| 64 CRF | Tirar **direto da Caixa** (consulta CRF pelo CNPJ). No Atlas o nome é "Certidão de regularidade do FGTS / CND do FGTS" | O robô pega a cópia da pasta de certidões do SharePoint, **sem olhar a validade (30 dias)** | Conferir a data de emissão antes de usar, ou emitir na Caixa (consulta pública, plano C2.10) |
| 81 CND | Tirar no rfb.gov.br / pgfn.gov.br (CNPJ e código de controle) | Mesma cópia do SharePoint, sem validade | Idem: checar a validade (6 meses) |
| 82 CNDT | "**Não fica armazenado em nenhum local**": TST, pelo CNPJ, **com captcha** | `documento_regras.origem = SharePoint`; nada busca | Origem errada. Dá para fazer com o serviço de navegação + Anti-Captcha que já temos (plano C2.17) |
| 66 | Modelo baixado no Atlas | `origem = SharePoint` | (igual à seção 1) |
| 83 ponto | Factorial → Controle de frequência → equipe "equatorial", marcar todos os "apoios à fiscalização", exportar: o PDF chega por e-mail | Nada implementado | Ver se a API da Factorial (attendance) gera isso; senão, navegação |
| 24 | "Verificar as observações; **quando houver reprovação, alertar o responsável do documento**" | O trigger marca REJEITADO, mas ninguém é avisado | Alerta de reprovação por responsável (plano F6/F7.3) |
| 67 | Conferir se o funcionário **não se recusou** a fazer o ASO demissional | Não trata a recusa | Perguntar como fica a recusa (declaração?) |
| 78 | O texto é **cópia do 67** (fala de ASO demissional e Offboarding) e diz "junto os PDFs" | `requer_composicao = false` | Provável erro de preenchimento: refazer com a Milena |
| 79 | "Desconsiderar último pedido em 2024" | Sem nome mapeado no `neon.js` (não entra no Neon) | Entender a regra antes de mapear |

**Nova pergunta forte:** quem "já sobe automático" o 59 e o 63? Se for a sincronização do Evilásio ou outra automação da NIP, o nosso envio não pode pegar esses tipos.

## 8. Corrigido em 19/10 (16:06, publicado na VPS)

- **69**: saiu "aviso prévio", entrou "pedido de desligamento". Atenção: 13 dos 18 doc 69 já LOCALIZADO são arquivos de aviso prévio (achados pela regra antiga). Ficam como estão no banco; confirmar com a Milena se aviso prévio serve antes de qualquer envio.
- **`neon.js`**: "Comprovante de Pagamento do TRCT" → 9; "Folha de Pagamento Mensal Analítica" → 63 (na coleta atual: 2 linhas novas do 63).
- **Benefícios 2, 3, 4, 7**: o `sharepoint.js` classifica cada arquivo (relação, boleto, comprovante, complementar; NF e planilha ficam de fora) e une pelo Gotenberg nessa ordem. Não une quando falta parte, sobra parte repetida ou há arquivo sem papel (ex.: ADITAMENTO do seguro, arquivos com nome de colaborador). PDF já unido pela NIP vale como arquivo único.
- **56**: pasta do tomador dentro de "Salario"/"COMPROVANTES DE SALARIOS"; usa o "01 - Salarios" se existir, senão une todos. Setembro não tem pasta do Amapá (CEA).
- **59 / 63 / 65**: 59 = comprovante DARF da pasta INSS; 63 = FOPAG/extrato por unidade; 65 = só a guia DARF. 59 e 63 levam o aviso "já sobe automático".
- **6, 66, 82**: motivo corrigido. A origem de 66 e 82 no banco precisa do owner: `docs/sql/2026-10-19-origens-66-82.sql`.
- Tudo só no painel (`--baixar`): nada novo é gravado no Neon pela busca do SharePoint.

## 9. Conferência PDF por PDF (19/10, noite)

Cada PDF achado ou unido foi lido de verdade (pdftotext e, nos escaneados, OCR), em container descartável na VPS. Nada foi gravado no Neon nem enviado. Os textos extraídos foram apagados.

**Factorial (o que já está LOCALIZADO/COMPOSTO no Neon)**
- **68, arquivo errado:** #269, #270, #273 e #275 apontam para o MESMO `eSocial.pdf` (23 páginas, mesmo tamanho), anexado na Factorial em 4 pessoas. Só o CPF do #269 está no texto. Falta: a NIP anexar o eSocial certo de cada um e voltar #270, #273 e #275 para PENDENTE_ENVIO (é gravação no Neon: precisa do OK). As outras 68 são a tela do S-2299 com o CPF certo.
- **67, dados de saúde:** #284 (5 páginas: pedido de exames, ASO e ficha clínica) e #297 (4 páginas: ASO, revisão de prontuário e anamnese com doenças) levam mais que o ASO. Não podem sair assim (LGPD): só a página do ASO. Os dois aparecem como "prontos" no `enviar.js`.
- **67:** 7 ASO estão REJEITADO ("Reprovado (atrasado)"): alguém já enviou e o Atlas reprovou. Ver o motivo antes de mandar de novo. O #122 não tem o arquivo na VPS e o nome não diz "demissional" (foi achado pela regra antiga).
- **69:** 12 dos LOCALIZADO são "AVISO PRÉVIO DO EMPREGADOR INDENIZADO" (121, 124, 146, 150, 224, 257, 260, 288, 294, 321, 324, 347), ou seja, dispensa pela empresa. O #329 é "AVISO TÉRMINO DE CONTRATO DE EXPERIÊNCIA". Os pedidos e cartas (#230, #235, #245, #307 e #341) são manuscritos do empregado. Pergunta para a Milena: na dispensa pela empresa e no fim de experiência, o que sobe no 69?
- **9:** TRCT + termo de quitação + comprovante Santander (3 partes, pelo `compor.js`), mas a Milena (v2) falou em arquivo único. Os pares #119/#120, #126/#128 e #142/#147 são da mesma pessoa, com dois pedidos no Atlas e o mesmo conteúdo.
- **10:** GFD rescisória + comprovante. OK.

**SharePoint**
- **Benefícios unidos:** em todos, o valor do boleto é igual ao do comprovante (VA 09: 115.588,09; VT 06: 6.138,30; VT 07: 5.653,00; VT 08: 5.699,30 + complementar 386,40; VT 09: 5.859,70; seguro 03/2025: 2.483,56). Na saúde, o comprovante é o total do contrato e a fatura da lotação 797 bate com ele.
- **Relações deitadas:** a relação do VA e o demonstrativo da saúde já vêm de lado (90°) no original da NIP, e o unido herda isso.
- **Travados com razão:**
  - VA 04: boleto avulso "Daniel Levy" (768,63), sem comprovante e sem relação.
  - VA 05 e 06: pedido avulso "Johnny Franklyn" (490,00, boleto + comprovante), que funciona como complementar mas vem com o nome do colaborador. Em 05 falta a relação.
  - VT 03: **dois pedidos**. Um é Mobilidade (2.221,60, completo); o outro é de outro fornecedor (1.251,60: pedido, boleto e comprovante), provável GVBus.
  - VT 04: dois boletos avulsos "aguardando pagamento", sem comprovante; um deles tem o ano errado no nome ("04.2025").
  - VT 05: só há o comprovante.
- **Seguro:** o ADITAMENTO é o "Aditamento de Cobrança" (fatura) da Prudential. Em 07/2026 a pasta `seguro/NIP GRUPO AP I` está vazia, e 09/2026 não tem pasta de seguro.
- **Saúde 01 e 02/2025:** o PDF que a NIP uniu tem **nota fiscal (NFS-e) e não tem a relação**.
- **24:** uma GFD só, do empregador inteiro (870 trabalhadores), e a RE de cada tomador é o detalhe dessa mesma guia. Usar o mesmo arquivo nas 7 unidades é coerente.
- **25:** cada RE traz o CNPJ do seu tomador. **O Amapá (CEA) não tem RE, FOPAG nem pasta de salário em 08 e 09** (em 07 tinha): perguntar se ainda há gente lá.
- **26:** o comprovante de 09 ainda não está na pasta (a guia vence em 20/10).
- **60, 61 e 65:** competência e CNPJ da matriz certos.
- **64 e 81:** o CRF vale até 27/10 (vence em 8 dias). A CND de setembro vale até 05/04/2027 e o robô não a achava porque procurava a pasta de outubro.

**Corrigido no código (local, testado isolado na VPS, NÃO publicado)**
- `sharepoint.js`:
  - Certidão: vale a mais nova ainda válida, pela data no nome e de qualquer mês, com aviso quando faltam 10 dias ou menos. O 64 também aceita "Certidão de regularidade FGTS".
  - PDF unido pela NIP: só é usado quando as partes soltas não fecham, e com aviso. Com isso a saúde 02/2026 passa a ser montada na ordem certa. `PDFsam_merge` conta como unido.
  - Pasta com uma subpasta só: o robô entra nela.
  - CEA também reconhece "Companhia de Eletricidade do AM", e "PLANO SAUDE" passa a valer.
  - Teste: 49 achados (antes eram 46).
- `enviar.js`: o mesmo arquivo em pendências de CPFs diferentes trava todas. No teste, as 4 do eSocial ficaram travadas.
- `factorial.js`: nesse mesmo caso, não grava LOCALIZADO.
