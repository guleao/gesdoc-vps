# Portal Bernhoeft (ContractWeb): mapa do portal (F3.17)

Mapeado de 05 a 08/10/2026 e revisto em 19/10/2026 com a conta de um operador da **NIP (lado contratada)**. Toda a exploração foi somente leitura.

**Situação da F3.17:** a parte de **leitura** está mapeada (abaixo). A parte de **envio** (telas, formatos, nomes de arquivo, campos obrigatórios e retorno) **não está**. Causa, confirmada em 19/10 pelo `loginapi.contractweb.com.br/api/v1/Auth/GetUserInfo` (menus e roles do usuário):
- **Perfil:** em carregamento, só `CARREGAMENTO_MENSAL_PESQUISAR` (+ `OPCIONAL2`). Não tem CRIAR/EDITAR, nem nenhuma role de Carregamento Mobilização, Veículo ou Ambiental. O documento de empresa entra pela Mobilização (a tela traz `action-mobilizacao-documentos-empresa`).
- **Vínculo:** nenhum contrato ligado ao operador. `ListarCompetenciasAjax` devolve `recordsTotal=0` em qualquer filtro (mês "todos", com e sem concluídos) desde 06/10.
- `/LinksContratante/CriarLink` "Sem Permissão" vem de `LINKS_POR_CONTRATANTE` ter só PESQUISAR. Publicar link é função da contratante e não tem relação com o envio.

O relatório 012 mostra documentos "Analisado" e "Não Analisado" nos contratos da NIP. Em 20/10 a Milena disse que **esta é a única conta Bernhoeft** que eles têm, então não há "login de quem já envia" a pedir. Esses envios saíram desta conta antes de perderem o vínculo/perfil, de um login que a Milena não conhece, ou do lado da Equatorial ou da Bernhoeft (perguntar). Para fechar a tarefa, falta o gestor da conta NIP no ContractWeb (ou o suporte Bernhoeft) vincular este operador aos contratos da Equatorial e dar o perfil de carregamento (Mensal e Mobilização com criar/editar).

**Exploração de 20/10 (só leitura, scripts `%TEMP%/gesdoc-teste/bern-explorar3..7.js`):**
- A conta é mesmo usada por uma pessoa: o analytics do portal (UserGuiding, `/sdk/identify`) registra o operador 83205 em Edge/Windows desde 23/05/2025, com 1697 sessões. O xlsx do 012 de 25/09 também foi pedido por "Rodrigo Rocha".
- O app novo (`app.contractweb.com.br`, 43 rotas lidas do router) só tem relatórios, dossiê, logs e autocadastro. **Não há tela de envio nele.** O envio é no newcontract.
- Todas as telas de carregamento abrem sem "Sem Permissão" e voltam com 0 competências: Mensal, Mobilização (`TipoCompetencia` 0, 1 e 2=todos; o 3 em diante cai no 2), Veículo (`/MobilizacaoVeiculo`) e Ambiental (`/ModuloAmbiental`). O contratante aparece (Equatorial, id 188), mas a lista de contratos no filtro do app vem vazia.
- No xlsx do 012, as 39 linhas são da competência "Documentos de Empresa": 17 Analisado, 13 Não Analisado e 9 Não Entregue.
- O nome das roles pode enganar: é possível que o upload dependa só do vínculo com o contrato e não de uma role CRIAR. O que falta descobrir é se a Milena vê hoje competências que o robô não vê, ou se o vínculo caiu depois de 25/09.

## Acesso

- Portal: `https://newcontract.contractweb.com.br/`. Os relatórios novos abrem em `https://app.contractweb.com.br/`.
- **Login:** campo `#Login` (e-mail), `#password` e botão `#BotaoLogin`. Há reCAPTCHA v2 do Google, resolvido conforme `docs/spikes/captcha.md`. O botão "Entrar com Microsoft" (`#btnLoginMicrosoft`) não é usado.
- **Sessão:** cookie no perfil do navegador. Dura poucas horas. Se `#password` aparece na página, a sessão caiu.
- **API:** existe a ContractWeb v3, mas sem documentação pública de envio de documentos, anexos ou status. O repositório público de testes da Bernhoeft cobre só contratos, terceiros, áreas e eventos. Por isso o conector usa o portal web.
- **Perfil novo:** abre com o menu lateral recolhido (expandir por `#bt-menu`) e com um banner de cookies (botão "Entendi").

## Menu

Menu lateral em árvore (metisMenu): Carregamento de Documentos, Relatórios, Utilitários, Integração e Suporte. Para abrir um item de terceiro nível, é preciso clicar no pai antes do filho.

## Telas de leitura

| Tela | Rota | O que mostra | Como o robô lê |
|---|---|---|---|
| Carregamento Trabalhista/Mensal | `/AtualizarColaborador?TipoCompetencia=0` | Competências por contrato, com status e indicação de documentos pendentes | Endpoint JSON da própria tela (abaixo) |
| Mobilização | `/AtualizarColaborador?TipoCompetencia=1` | O mesmo, para mobilização | Mesmo endpoint |
| Controle de Validade | `/RelatorioControleValidadeDocumentos` | Por colaborador: contrato, contratada, CPF, status, primeiro documento a vencer | Ainda não lida (vazia para esta conta) |
| Envio de Solicitação de Providências | `/EnvioRelatoriosPendencia` | Envios de pendência por contrato, com filtro de enviados e não enviados | Ainda não lida (vazia para esta conta) |
| **012 - Relatório de Documentos Pendentes** | Menu Relatórios › Documentos e Análise. Abre em nova aba em `app.contractweb.com.br/relatorio/documentos-pendentes` | Lista de pedidos de relatório (status, data, contratante, grupo de área, unidade) com download do xlsx | Tabela `table.q-table`, paginada |

### Endpoints usados

- `GET /AtualizarColaborador/ListarCompetenciasAjax?...&start=&length=[&concluido=on]`: lista paginada no formato DataTables (`data`, `recordsFiltered`). Campos: `id`, `contratante`, `competencia`, `contrato`, `contratada`, `area`, `cnpj`, `status_descricao`, `existe_docs_pendentes`.
- `GET /AtualizarColaborador/QuantidadeDocumentosPendentesAjax?idCompetencia=<id>`: devolve `quantidade_documentos_pendentes`.
- `GET strapi.contractweb.com.br/api/v1/Download?...`: devolve `{"dados": "<URL assinada>"}`. O portal cancela o download do navegador, então o robô baixa a URL assinada direto.

### Relatório 012 (xlsx)

- O botão **SOLICITAR** gera um relatório novo. Desde 28/10 (autorizado pelo usuário) o robô clica **no máximo 1 vez por dia**, com o contratante Equatorial e sem outro filtro (igual ao pedido de 25/09), só se a lista não tiver pedido de hoje; espera até 10 min ("ATUALIZAR LISTAGEM") e baixa o último pedido com status "Concluido". `SOLICITAR_012=0` desliga.
- Status dos pedidos: "Concluido" (tem download) e "Sem Conteúdo" (sem arquivo).
- Linha de cabeçalho: a primeira célula é "Contrato". Colunas lidas: contrato (1), contratada (2), risco (3), competência (4), área (5), descrição do documento (6), colaborador (8 e 9), **status (14)**, unidade (15) e tipo (16).
- **Status do documento:**
  - "Não Entregue": falta enviar. É a pendência que interessa.
  - "Não Analisado": enviado, aguardando análise da Bernhoeft.
- Chave estável de um documento: contrato, contratada, competência, área, descrição, colaborador e unidade.
- **Limitação:** o relatório mostra o estado do dia em que foi solicitado (o último baixado é de 25/09/2026). Para ter o estado do dia, alguém precisa clicar em SOLICITAR, ou o robô precisa ser autorizado a fazer isso.

## Envio (a mapear)

| Item da F3.17 | Situação |
|---|---|
| Telas de envio | Não acessíveis com a conta atual |
| Formatos e nomes de arquivo aceitos | A mapear |
| Campos obrigatórios | A mapear |
| Como o portal devolve o resultado do envio | Indício: o status do documento no relatório 012 passa de "Não Entregue" para "Não Analisado" e depois para o resultado da análise. A confirmar com um envio real (F3.19) |

## Referência

Implementação de leitura: `services/pendencias` (leitor do Bernhoeft, O2.6). Exceções: `docs/excecoes/bernhoeft.md`.
