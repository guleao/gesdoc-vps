# Padrão dos workers de navegação (F3.25)

Este documento define o padrão de todo worker que navega num portal: Bernhoeft, Atlas, TST (CNDT), FGTS Digital, gov.br e os portais das operadoras. A referência viva é o leitor de pendências do Bernhoeft (`services/pendencias`), que já segue o padrão.

## 1. Estrutura de um worker

```
workers/navegacao/<portal>/
  worker.js          # fluxo: sessão -> navegação -> coleta/download -> resultado
  login.*            # login isolado (pode ser Python, se o captcha exigir)
  README.md          # telas usadas, seletores, códigos de saída, variáveis
```

Cada execução recebe a entrada por variáveis ou argumentos (CNPJ, competência, destino) e devolve:

- **stdout:** log de linha com horário (`[hh:mm:ss] mensagem`), sem senha nem token;
- **arquivo de resultado JSON** com `coletado_em`, `itens` e `evidencias[]`;
- **código de saída:**

| Código | Significado | Quem trata |
|---|---|---|
| 0 | ok | — |
| 1 | erro inesperado (bug, layout mudou) | alerta ao time e fila de intervenção |
| 2 | sessão expirada e sem como renovar sozinho | alerta "login manual necessário" |
| 3 | login automático falhou (captcha ou credencial) | tenta de novo no próximo ciclo e alerta depois de N falhas |

## 2. Sessão e login

- **Perfil persistente:** `launchPersistentContext(PROFILE_DIR)`. O login é reaproveitado entre execuções e só se loga de novo quando a sessão cai.
- **Detecção de sessão:** um seletor que só existe na tela de login. No Bernhoeft é `#password`; se ele não está na página, a sessão está ativa.
- **Login isolado:** o worker fecha o navegador, roda o login (que usa o mesmo perfil) e reabre. Dois navegadores nunca abrem o mesmo perfil ao mesmo tempo.
- **Credenciais:** sempre por variável de ambiente vinda do cofre (SOPS). Nunca em código, log, screenshot ou mensagem de alerta.
- **Captcha:** segue a estratégia de `docs/spikes/captcha.md`. Primeiro o resolvedor grátis, depois a reserva paga com chave no cofre e, por fim, o código 3 com alerta.
- **Idioma:** o navegador abre com `locale` fixo. No Bernhoeft precisa ser `en-US`, porque o desafio de áudio do reCAPTCHA só traz o link do MP3 em inglês.

## 3. Navegação

- **Esperar o estado, não o tempo:** `waitForSelector` ou `waitForLoadState('networkidle')`. `waitForTimeout` só para animação de menu, até 1 s.
- **Ler pela API da própria tela quando existir:** capturar a requisição que a tela faz e repetir com paginação própria. No Bernhoeft é `/AtualizarColaborador/ListarCompetenciasAjax`. É mais estável que ler a tabela HTML.
- **Menus em árvore e abas novas:** abrir o pai antes do filho (metisMenu no Bernhoeft) e capturar a aba com `context.waitForEvent('page')`.
- **Perfil novo ≠ perfil antigo:** o worker deve funcionar com perfil zerado. No Bernhoeft, um perfil novo abre o menu recolhido (`#bt-menu`) e mostra um banner de cookies ("Entendi").
- **Somente leitura por padrão:** clique que cria algo no portal (SOLICITAR, Enviar, Confirmar) só acontece com uma flag explícita e autorização registrada.

## 4. Download

- O portal pode cancelar o download do navegador. No Bernhoeft, o clique chama `/api/v1/Download`, que devolve `{"dados": "<URL assinada>"}`, e a aba fecha sozinha. Nesse caso, o worker intercepta a resposta e baixa a URL direto.
- **Nome do arquivo:** `<data do pedido>_<descrição>.<ext>`, gravado numa pasta do volume de dados. Se o arquivo daquele pedido já existe, o worker reaproveita e não baixa de novo.
- **Hash:** o worker registra o SHA-256 de todo arquivo baixado, que é a base da deduplicação (F3.7).

## 5. Evidência

- Toda falha de navegação grava um screenshot: `out/falha-<etapa>.png`. O Bernhoeft já faz isso com `out/falha-012.png`.
- Em sucesso, a evidência é o próprio arquivo baixado mais o JSON de resultado com `coletado_em`.
- Histórico datado em `out/historico/<timestamp>.json`, que não é sobrescrito.
- Screenshots e dados são sensíveis (dados de colaboradores): ficam no volume, fora do git, e seguem a política de retenção (F7.6).

## 6. Retry

| Situação | Ação |
|---|---|
| Timeout de rede ou portal lento | até 3 tentativas com espera de 15 s × tentativa |
| Captcha falhou | até 4 tentativas com pausa crescente (o Google limita desafios de áudio seguidos), depois a reserva paga |
| Credencial recusada ("verifique seus dados") | **não repetir**: alerta na hora (repetir pode bloquear a conta) |
| Arquivo esperado não veio | manter o estado anterior; não registrar como "resolvido" |

## 7. Mudança de layout

- **Sintoma:** um seletor essencial não aparece dentro do timeout (tabela, campo de login, link do menu).
- **Ação:**
  1. screenshot e HTML da página em `out/`;
  2. código 1 e alerta "layout mudou em <portal>/<etapa>";
  3. **pausar o worker**, sem retry em loop, até alguém ajustar o seletor.
- **Prevenção:** seletores por `id` ou texto visível (`#BotaoLogin`, "012 - Relatório de Documentos Pendentes"), nunca por posição (`div:nth-child(3)`). Seletores ficam no topo do arquivo, num lugar só.

## 8. Comparação e alerta

- O worker compara cada leitura com a anterior por chave estável e marca **NOVA**, **SAIU** ou **ALTERADA**.
- O alerta vai por webhook (`ALERT_WEBHOOK_URL`, POST JSON). O mesmo aviso não se repete em menos de 6 h.
- Se a fonte não carregou neste ciclo, o worker mantém os itens da leitura anterior, para não gerar um "SAIU" falso.

## 9. Execução no servidor

- Roda em contêiner a partir da imagem do serviço de navegação (F3.24), com `HEADLESS=1`, `--no-sandbox` e volume `/data` para o perfil.
- Limite de sessões simultâneas pelo serviço `workers/navegacao` (`MAX_SESSOES`). Um worker não abre navegador fora desse limite.
- Agendamento pelo n8n (chamada HTTP) ou pelo timer do serviço. Nunca dois ciclos do mesmo worker ao mesmo tempo, porque o perfil é exclusivo.

## Esqueleto

```js
const { chromium } = require('playwright');
const PROFILE = process.env.PROFILE_DIR;            // volume /data/profile
const SEL = { login: '#password' };                 // seletores num lugar só

async function abrir() {
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    headless: process.env.HEADLESS === '1', locale: 'en-US',
    executablePath: process.env.CHROME_PATH, args: ['--no-sandbox'],
  });
  return { ctx, page: ctx.pages()[0] || await ctx.newPage() };
}

async function ciclo(page) {
  await page.goto(BASE);
  if (await page.$(SEL.login)) { const e = new Error('login'); e.precisaLogin = true; throw e; }
  // navegar -> coletar -> baixar -> gravar resultado + histórico -> comparar -> alertar
}

(async () => {
  let { ctx, page } = await abrir();
  try { await ciclo(page); }
  catch (e) {
    await page.screenshot({ path: 'out/falha.png' }).catch(() => {});
    if (e.precisaLogin) { await ctx.close(); /* rodar login isolado; reabrir; repetir ciclo ou sair 2/3 */ }
    else process.exitCode = 1;
  } finally { await ctx.close().catch(() => {}); }
})();
```
