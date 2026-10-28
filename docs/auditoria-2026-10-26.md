# Auditoria 26/10: falhas, tratamento de cada documento e PDFs

Fontes: Neon (só leitura, transação read-only com o `robo_atlas`; scripts em `%TEMP%/gesdoc-teste/audit2/`), código deste repo, código do Evilásio (`%TEMP%/gesdoc-teste/evilasio/repo`, commit `cafc56d`), auditoria de 19/10.
**A VPS não respondeu** (Tailscale: `srv2007033` offline, "last seen 1d ago"; ping sem resposta). Então não deu para ler logs, `out/envios.log`, `resultados.json`, nem reabrir os PDFs.

## A. Urgente

1. **VPS fora do ar desde ~25/10.** Sem ela não há coleta, Factorial, SharePoint, sincronização (cron) nem painel. Evidência no Neon: nenhuma pendência nova desde 20/10, nenhuma mudança desde 22/10, e 29 pendências com prazo em 25/10 ainda dizem "A enviar".
2. **#284 (67 ASO demissional) está ENVIADO desde 20/10, por volta de 11h13 (Brasília).** O envio está proibido desde 15/10. Pela auditoria de 19/10, esse PDF tem 5 páginas: pedido de exames, ASO e **ficha clínica** (LGPD). O rastro (`enviado_em` = `atualizado_em`, tamanho 2.818.874 e hash regravados) é o do `enviar.js`. Nenhuma sessão do Claude rodou esse envio, então ele saiu pela VPS: botão "Enviar" da aba 6 ou modo automático. Conferir na VPS:
   - `out/envios.log`
   - `out/envio/resultados.json`
   - `modo.json`
   - o status do schedule no Atlas

   Se foi mesmo para o Atlas, avisar o Augusto: é dado de saúde exposto e houve envio durante a proibição.
3. **A proibição de envio não tem trava no código.** O painel não tem login (só Tailscale). A aba 6 tem o botão "Enviar" ativo e o `robo.js` atende qualquer pedido `enviar`. Proposta: o `enviar.js` só envia se houver a variável `ENVIO_LIBERADO=1` no cofre, e o botão sai do painel até o Augusto liberar.
4. **A CRF (doc 64) vence em 27/10.** As 4 pendências do 64 precisam de certidão nova.

## B. Documento por documento (Neon, 429 linhas)

| doc | situação | problema |
|---|---|---|
| 8 férias | 27 de 27 em NAO_ENCONTRADO | 100% falha: a regra do Evilásio exige um arquivo com "aviso" na pasta Férias, e nenhuma pessoa tem. Em 9 casos, recibo e comprovante foram achados. Perguntar à Milena onde fica o aviso (outra pasta, assinatura, ou junto do recibo) |
| 9 TRCT | 32 COMPOSTO, 22 AGUARDANDO_ASSINATURA, 3 divergentes, 2 não achados | (a) Cada rescisão tem 2 pendências no Atlas ("TRCT" e "TCRT com comprovante") e as duas recebem o **mesmo PDF** (16 pares). Confirmar se o "TRCT" sozinho aceita o pacote com comprovante. (b) 22 travadas por assinatura: a regra só aceita "assinad" no nome ou `signature_status=completed`, e um termo escaneado assinado à mão cai aqui. Amostrar. (c) Na regra, o "comprovante" é qualquer arquivo de Offboarding que começa com o nome da pessoa: pode pegar carta, atestado etc. |
| 10 GFD | 17 COMPOSTO | ok (19/10) |
| 67 ASO | 8 LOCALIZADO, 7 REJEITADO, 1 ENVIADO (#284), 3 pendentes | O `factorial.js` não confere páginas: o #297 (anamnese) continua "pronto" e o próximo ASO com ficha clínica entra igual. Não tem janela de datas: pode pegar ASO de outro contrato da mesma pessoa. 7 já reprovados no Atlas sem motivo registrado |
| 68 eSocial | 27 LOCALIZADO, 1 ENVIADO (#117, teste) | #269, #270, #273 e #275 continuam com o mesmo arquivo (a trava não foi publicada). A regra `esocial\|ctps` não separa o S-2200 (admissão) do S-2299 (desligamento) e não tem janela de datas |
| 69 pedido de demissão | 18 LOCALIZADO, 10 pendentes | 13 dos LOCALIZADO são aviso prévio do empregador ou fim de experiência (regra antiga), e continuam LOCALIZADO, ou seja, enviáveis |
| 2, 3, 4, 7 benefícios | 84 PENDENTE (25 "Reprovado (atrasado)") | O PDF do mês é da empresa inteira e vai igual para cada unidade (8 unidades). A relação lista os beneficiários de todos os tomadores: confirmar se o Atlas/Equatorial aceita ou se tem que filtrar por unidade (LGPD) |
| 5 odonto, 6 VR | 21 pendentes | sem regra (já sabido) |
| 24, 25, 26 FGTS | 49 pendentes, marcadas `critico` | 7 PendingRejected (25, 26): reprovadas ainda no prazo |
| 59, 63 | 13 | "já sobe automático" (Milena): risco de envio em dobro se ligar o `--gravar` |
| 64, 81 certidões | 7 | O robô trata a data do nome como **validade**, mas há nomes com data de emissão ("... FGTS - 01.06.2026"). Também não confere o CNPJ: a CRF é por estabelecimento. #205 e #206 (81) são a mesma pendência com 2 prazos (26/10 e 30/10), em 2 linhas |
| 66, 82, 83, 84 | 54 | ninguém busca. O 84 está "Reprovado (atrasado)" desde 12/2024 (6 linhas) |
| EDP (filial ...0100) | 36 linhas, 32 pendentes | nenhuma rota: o `sharepoint.js` pula tudo que não é da filial 20102080 |

## C. Falhas de desenho (código)

1. **Reprovação não é tratada.** 34 PENDENTE_ENVIO estão "Reprovado (atrasado)" e 9 estão `PendingRejected`. O trigger `documentos_rejeicao` e a função `estado_por_situacao` só reconhecem "Reprovado%", e o `neon.js` não traduz `PendingRejected` (aparece cru no painel). Nada guarda o hash do arquivo reprovado: o robô pode reenviar o **mesmo** arquivo que o Atlas recusou. Nada busca o motivo da reprovação.
2. **Pendência entregue pela equipe nunca sai do Neon.** A coleta não lê "Entregues", e linha que some do Atlas fica PENDENTE para sempre. Só o painel filtra isso (`foraDoAtlas`). Os números do Neon/`v_documentos_status` estão inflados.
3. **`app.py` do Evilásio:** `UPDATE ... SET estado='ENVIADO' WHERE doc_id AND cliente AND competencia` marca **todos os CPFs do mês** de uma vez. Não roda na VPS hoje, mas não pode ser ligado assim.
4. **`enviar.js` não lê o conteúdo:** não confere CPF nem competência dentro do PDF, nem páginas a mais (LGPD), e manda sempre `validity_date: null` (ASO e certidões). Não tem lista de tipos liberados: 59/63 ("já sobe automático") e os 69 de aviso prévio passam.
5. **11 linhas LOCALIZADO/REJEITADO sem `hash_arquivo`** (121, 122, 124, 125, 127, 139, 141, 146, 150, 152, 154). A trava de "mesmo arquivo em duas pessoas" não as enxerga.
6. A data de `atualizado_em` só muda quando a linha muda (trigger `documentos_atualizado_em`): não serve para saber se a coleta rodou. Falta um "última coleta OK" gravado (ex.: tabela/linha de saúde), com alerta se passar de 2 h.
7. Pendências locais não publicadas (CLAUDE.md): a trava do `enviar.js`/`factorial.js` para o mesmo arquivo, as certidões do `sharepoint.js` e a montagem do `/srv/gesdoc/downloads` no compose do atlas.

## D. PDFs
Não foi possível reabrir nenhum PDF hoje (VPS fora, nenhum PDF real neste PC, chave da Factorial só no cofre). Quando a VPS voltar, rodar de novo `%TEMP%/gesdoc-teste/audit/rodar-audit.sh` e `rodar-ocr.sh`, incluindo:
- os 49 COMPOSTO do Evilásio (9 e 10);
- os 16 pares do 9;
- os 22 AGUARDANDO_ASSINATURA;
- o 8 (por que falta o aviso);
- o #284 enviado.
