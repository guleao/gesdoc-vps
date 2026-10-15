# Portal Bernhoeft (ContractWeb): mapa do portal (F3.17)

Mapeado de 05 a 08/10/2026 com a conta do lado contratante (Equatorial). Toda a exploração foi somente leitura.

**Situação da F3.17:** a parte de **leitura** está mapeada (abaixo). A parte de **envio** (telas, formatos, nomes de arquivo, campos obrigatórios e retorno) **não está**, porque a conta atual não tem permissão de upload: `/LinksContratante/CriarLink` responde "Sem Permissão" e as telas de Carregamento estão vazias. Para fechar a tarefa, falta uma destas opções:
- uma conta do lado **contratada** com acesso ao envio;
- a permissão de upload liberada na conta atual;
- a gravação do fluxo de envio feita por quem já envia hoje.

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

- O botão **SOLICITAR** gera um relatório novo. Isso tem efeito no portal, por isso **o robô não clica**. Ele só baixa o último pedido com status "Concluido".
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
