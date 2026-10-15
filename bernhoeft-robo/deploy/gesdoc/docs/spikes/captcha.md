# Spike: estratégia de captcha (F5.4)

Data: 09/10/2026. Base: os testes no portal Bernhoeft (05 a 08/10), a inspeção do formulário da CNDT (09/10) e preços públicos dos fornecedores.

## Decisão

1. **Usar o canal oficial sempre que existir.** API ou login por certificado não têm captcha. Isso vale para o gov.br e para a Receita.
2. **Usar o resolvedor grátis primeiro, quando o portal oferece áudio:** reCAPTCHA do Bernhoeft e botão "Ouvir" da CNDT.
3. **Pagar só como reserva:** 2Captcha como principal e Anti-Captcha como segundo. A chave fica no cofre (`*_API_KEY`). Os dois usam o mesmo protocolo `createTask`/`getTaskResult`, e trocar de um para outro é só mudar a variável `CAPTCHA_FALLBACK`.
4. **Depois de N falhas, abrir pendência na fila de intervenção** (código de saída 3, ver `docs/workers/padrao.md`). Nunca entrar em retry infinito.

## Portais

| Portal | Captcha | Estratégia | Situação |
|---|---|---|---|
| Bernhoeft (ContractWeb) | reCAPTCHA v2 do Google, no login | Áudio com `playwright-recaptcha`, grátis. Reserva paga com o tipo `RecaptchaV2TaskProxyless` | **Funcionando** no Windows desde 08/10, cerca de 9 s por login. Só roda quando a sessão cai, poucas vezes por dia |
| CNDT (TST) | Captcha de **imagem** próprio do TST (`#captcha-resposta`, imagem em base64, `tokenDesafio` oculto), com botão de áudio `#botao-ouvir-captcha` | Imagem por serviço pago (`ImageToTextTask`). Testar antes se o áudio do TST é resolvível por reconhecimento de voz local | Formulário inspecionado em 09/10. Solver ainda não implementado |
| gov.br (`sso.acesso.gov.br`) | Login por CPF e senha tem captcha e segundo fator | **Não resolver captcha.** Entrar com **certificado digital e-CNPJ A1** da SPE (insumo da F5.5) ou usar API oficial (Integra Contador do Serpro, F5.5) | Depende dos insumos da F5.5. O tipo exato de captcha fica para o spike de Playwright no gov.br |
| CND federal (Receita/PGFN) | — | A API do Conecta gov.br é só para órgãos públicos. Pela empresa, o caminho é a emissão pelo e-CAC com certificado ou o Integra Contador | Fica na F5.5 |

### Detalhes da CNDT (inspeção de 09/10/2026)

- Fluxo: `https://cndt-certidao.tst.jus.br/inicio.faces`, botão "Emitir Certidão", que leva a `/gerarCertidao`.
- Campos: `#cpfCnpj`, `#captcha-resposta` (texto da imagem) e `#captcha-token` (oculto, amarra a resposta ao desafio). O envio é pelo botão `#botao-emitir`.
- A imagem vem embutida na página como `data:image/jpeg;base64,...`. Assim, o worker manda essa string direto ao serviço, sem baixar nada.
- Certidão vale 180 dias, então a emissão é rara (uma por CNPJ por semestre, mais reemissões). O custo do captcha é desprezível.

## Custo e taxa de acerto

Preços por 1.000 captchas resolvidos (falha não é cobrada). Os valores são de fontes de terceiros de 2026 e precisam ser conferidos na página de cada fornecedor antes de contratar.

| Fornecedor | Imagem | reCAPTCHA v2 | Observação |
|---|---|---|---|
| 2Captcha | ~US$ 0,50 | ~US$ 1 a 3 | Pré-pago, sem mensalidade ([Capterra](https://capterra.com/p/10039723/2Captcha/)) |
| Anti-Captcha | ~US$ 0,50 a 0,70 | ~US$ 0,95 a 2 | Benchmark 2026 da [HasData](https://hasdata.com/blog/captcha-solving) |
| CapMonster Cloud | ~US$ 0,30 | frações de centavo | Estimativa da análise no [DEV Community](https://dev.to/markus009/a-financial-deep-dive-what-it-costs-to-bypass-captcha-and-when-different-solvers-make-sense-44dp); o "US$ 0,04" que aparece em listagens é piso, não preço típico |
| CapSolver | — | — | **Descartado**: a chave testada em 07/10 dava `ERROR_KEY_DENIED_ACCESS` |

**Volume estimado do projeto:** cerca de 10 logins por dia no Bernhoeft (só quando a sessão cai) mais algumas dezenas de CNDT por mês. Isso dá menos de 1.000 captchas por mês. Mesmo pagando todos, o custo fica **abaixo de US$ 5 por mês**, então o preço não decide. O que decide é a taxa de acerto e a estabilidade.

**Taxa de acerto:**
- **Medida:** o áudio do reCAPTCHA no Bernhoeft acertou o login com até 4 tentativas no Windows. O Google limita desafios de áudio seguidos, por isso há pausa entre as tentativas.
- **A medir na VPS:** o mesmo áudio a partir do IP da Hostinger. IP de datacenter pode receber desafio mais difícil ou ser recusado. Se for recusado, a reserva paga entra.
- **A medir na CNDT:** taxa de acerto de imagem com 2Captcha em 20 emissões de teste. O critério de aceite é pelo menos 90% de acerto na primeira tentativa.

## Insumos (para a matriz da F5.5)

- Conta pré-paga no 2Captcha com crédito inicial pequeno (US$ 10 cobre meses). Chave no cofre como `TWOCAPTCHA_API_KEY`.
- Anti-Captcha opcional, como segunda reserva (`ANTICAPTCHA_API_KEY`).
- Certificado e-CNPJ A1 por SPE para o gov.br e o e-CAC.

## Implementação

- **Bernhoeft:** pronta em `services/pendencias` (`login_auto.py`). A reserva paga já está no código e é pulada quando não há chave.
- **CNDT:** o worker segue `docs/workers/padrao.md`. Ele lê a imagem base64, chama `ImageToTextTask` e preenche `#captcha-resposta` mantendo o `#captcha-token`. Se a certidão não sair, gera nova imagem e repete até 3 vezes. Depois disso, código 3.
- **Variáveis comuns:** `CAPTCHA_FALLBACK` (ordem), `TWOCAPTCHA_API_KEY`, `ANTICAPTCHA_API_KEY`, `CAPMONSTER_API_KEY`.
