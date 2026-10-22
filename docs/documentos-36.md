# Os 36 documentos — como cada um é tratado (20/10/2026)

Fonte: planilha de discovery da Milena (`Downloads\Discovery_Oficial_Milena_EQT_36_Documentos (1) (1) (2) (1) (1).xlsx`, versão de 19/10 15:40; a "(1) (1) (1)" tem também a aba Doc 005) + o que o código faz HOJE. A tabela viva é o array `DOCS36` em `bernhoeft-robo/deploy/gesdoc/services/painel/pagina.html` (aba 8 do painel): ao mudar o tratamento de um documento, atualizar lá e aqui.

Totais: 30 vão para o Atlas, 6 para o Bernhoeft. Na planilha, 16 ficam na Factorial e 20 no SharePoint.

| como hoje | docs | quem |
|---|---|---|
| Robô busca e grava no Neon (6) | 8 férias, 9 TRCT, 10 GFD rescisória | sincronização Factorial do Evilásio (VPS, cron a cada 2 h) |
| | 67 ASO demissional, 68 baixa CTPS/eSocial, 69 pedido de demissão | robô Atlas (`factorial.js`) |
| Robô acha, só no painel (15) | 2 VA, 3 VT, 4 seguro, 7 saúde, 24 GFD, 25 RE, 26 comprov. FGTS, 56 comprov. folha, 59 comprov. recolhimento, 60 recibo DCTFWeb, 61 relatório DCTFWeb, 63 extrato folha, 64 CRF, 65 DARF, 81 CND Federal | `sharepoint.js --baixar` (não grava no Neon) |
| Só quando pedem (6) | 95 EPI, 112–116 certificados/treinamentos | `pacote.js` do painel, por funcionário (Bernhoeft) |
| Nenhum robô, a equipe faz (9) | 5 odonto (sem pasta mapeada), 6 VR (declaração), 66 ocorrências (modelo do Atlas), 78 ASO adm./periódico, 79 ficha de registro, 80 registro eSocial, 82 CNDT (site do TST, captcha), 83 cartão de ponto (exportação do controle de frequência), 84 convenção coletiva (SharePoint `06 Convenções Coletivas`) | — |

## Da planilha (regras de montagem)
- Benefícios 2/3/4/7: relação → (complementar) → boleto → comprovante; nota fiscal fica fora; o mesmo PDF vai em cada colaborador listado no mês. VT: Joana Novais tira as relações do CAJU.
- 8: aviso + recibo + comprovante. 9: TRCT + comprovante de pagamento. 10: guia FGTS + comprovante.
- Responsáveis citados: Gabriela Mathias (61, 63, 81), Tatiana Almeida (68), Joana Novais (VT).

## Divergências e dúvidas abertas
- 78 e 79: a planilha diz Atlas **e** Bernhoeft; `documento_regras` só tem Atlas.
- 5 odonto: sem regra no robô e sem informação na planilha.
- 83: vem da Factorial, mas nenhum robô busca (16 pendências em 20/10, grupo `sem_busca` no painel).
- Ver também as pendências do CLAUDE.md (69 aviso prévio, aditamento Prudential, seguro 07/2026 vazio).

## Comentários padrão do Bernhoeft (recebidos em 22/10)
Texto exato a colocar no item quando o documento não sobe ou é substituído:
- Sem ficha de EPI (95) ou sem primeiros socorros (115), colaborador administrativo: `NÃO APLICÁVEL - O COLABORADOR DESENVOLVERÁ ATIVIDADES ADMINISTRATIVAS.`
- Sem direção defensiva (112) e sem CNH: `NÃO APLICÁVEL - O COLABORADOR NÃO CONDUZIRÁ VEÍCULOS.`
- Primeiros socorros (115) quando já há direção defensiva: `CONTEÚDO PROGRAMÁTICO ABORDADO NO CERTIFICADO DE DIREÇÃO DEFENSIVA JÁ ANEXADO A ESSA MOBILIZAÇÃO.`
- CTPS substituída: `Anexado eSocial em substituição a CTPS.`
- RG e CPF substituídos: `Anexado CNH em substituição a RG e CPF.`
- Ficha de registro (79) substituída: `Anexado eSocial em substituição a FICHA DE REGISTRO.`
- Sem treinamentos de NR: `NÃO APLICÁVEL - O COLABORADOR NÃO DESENVOLVERÁ ATIVIDADES RELACIONADAS AS NRS 10, 10 SEP, 11, 12, 33 e 35.`

Falta saber de onde o robô tira "administrativo", "não conduz veículo" e "não faz NR" (cargo na Factorial?).
Configurado em 22/10: lista em `bernhoeft-robo/comentarios.json` (para a rotina de envio) e cópia `COMENTARIOS_BERN` na `pagina.html` (aba 7: "Se não houver documento", botão copiar; aba 8 com a nota). Publicado 22/10 14:11, só pagina.html, backup `painel-bak-202610221411`.
