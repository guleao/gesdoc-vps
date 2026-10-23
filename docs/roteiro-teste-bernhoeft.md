# Roteiro do teste da Mobilização no Bernhoeft (chamada com o time deles)

Robô: `bernhoeft-robo/mobilizacao.js` (fluxo do vídeo do Pablo, `docs/bernhoeft-mobilizacao-video-2026-10-22.md`).
Nunca rodou contra o portal. A lógica de escolha (arquivo ou comentário) passou no teste offline 10/10 (`%TEMP%/gesdoc-teste/t-mobil-decidir.js`).

## Antes da chamada (no PC)
1. Dependências: já instaladas em 23/10 (`npm ci` + Chromium do Playwright).
2. Chave da Factorial como variável de usuário (NÃO está neste PC; a de verdade está no cofre hml da VPS). Sem imprimir:
   `[Environment]::SetEnvironmentVariable('FACTORIAL_API_KEY', '<chave>', 'User')` e abrir um terminal novo.
   Conferir: `[bool]$env:FACTORIAL_API_KEY` e `[bool]$env:BERNHOEFT_USER` → True.
3. Sessão: este PC não tem `profile/`. No começo da chamada, `node login.js` (login à mão, com o captcha) cria a sessão.
4. Plano: copiar `plano.exemplo.json` para `plano.json` (fica fora do git: tem CPF) e preencher:
   - `contrato` e `contratada` exatamente como aparecem na lista do portal;
   - um colaborador de teste combinado com o time (CPF, e as três respostas: administrativo, dirige, faz NR);
   - `mobilizacao_id`: deixar `null` para criar uma nova, ou o número da URL `EtapaN/<id>` para continuar uma.

## Na chamada, nesta ordem
| passo | comando | grava no portal? | o que conferir |
|---|---|---|---|
| 1 | `node mobilizacao.js plano.json --descobrir` | não | abre o menu Mobilização e a Nova Mobilização; o relatório mostra o que ele faria com os arquivos da Factorial |
| 2 | conferir `out/mobilizacao/<data>/` | – | prints + HTML + chamadas de cada tela: ajustar os seletores que falharem |
| 3 | `node mobilizacao.js plano.json --executar --passo` | sim, 1 clique por vez | ele pergunta antes de cada gravação (Enter faz, `n` pula, `q` para) |
| 4 | com o id da mobilização criada no plano: `--descobrir` de novo | não | vê as etapas 2–5 por dentro |
| 5 | `--executar --passo --concluir` | sim | só se o time do Bernhoeft disser que pode concluir |

## Perguntas para o time do Bernhoeft
- Nosso operador (83205) pode criar mobilização em quais contratos? Quais contratos estão travados por documento de empresa (Brigada, Plano de Emergência)?
- A planilha modelo da etapa 2 ("Escolher arquivo") aceita vários colaboradores de uma vez? Seria mais seguro que digitar campo por campo.
- Existe API ou só a tela?
- O "Não conforme" logo depois de subir é sempre a pré-análise automática? Quanto tempo leva a análise humana?
- Comentário (balão) sem arquivo é aceito como "não se aplica" ou precisa de documento?
- Como achar um colaborador já cadastrado (relatório do menu da esquerda) para continuar a mobilização dele?

## O que pode dar errado (e o que fazer)
- "Sessão caiu" (saída 2): rodar `node login.js` de novo.
- Botão ou campo não achado: o robô para, tira print e grava o HTML; ajustar o seletor no `mobilizacao.js` (funções `abrirMobilizacao`, `etapa2`, `etapa5`).
- Dados da Factorial: RG não vem; PIS é "o campo que não é o CPF" (conferir); função, salário e admissão vêm do contrato atual (conferir os nomes dos campos).
