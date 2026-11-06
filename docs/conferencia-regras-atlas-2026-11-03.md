# Conferência das regras do Atlas (03/11/2026)

Comparação, documento por documento, de três fontes:
- **Milena** = planilha de discovery v2 (`Discovery_Oficial_Milena_EQT_36_Documentos (1) (1) (2) (1) (1).xlsx`, abas "Doc NNN", partes A e B).
- **Painel** = array `DOCS36` da `pagina.html` (aba 8) e `docs/documentos-36.md`.
- **Código** = `neon.js` (nome no Atlas → doc_id), `factorial.js` (67/68/69), `sharepoint.js` (SharePoint), `conteudo.js` (conferência do PDF; local, não publicado). Os docs 8/9/10 são do código do Evilásio, que não está neste repositório.

Legenda: ✅ bate · ⚠️ bate em parte / risco · ❌ não bate · ❓ sem informação para conferir.

| Doc | Milena | Código | Resultado |
|---|---|---|---|
| 2 VA | relação → boleto → comprovante, o mesmo PDF em cada colaborador do mês | `partesBeneficio`, 1 PDF por mês para todas as pendências | ✅ (a conferência do conteúdo aceita "refeição" como VA) |
| 3 VT | relação → rel. compl. → boleto → bol. compl. → comprovante → comp. compl. | `ORDEM_BENEFICIO` igual | ✅ (VT com 2 fornecedores: sem regra) |
| 4 Seguro | relação → boleto → comprovante | igual | ✅ |
| 6 VR | declaração por colaborador | sem regra (manual) | ✅ |
| 7 Saúde | relação → boleto → comprovante, sem NF | igual, NF fica fora | ✅ |
| 8 Férias | aviso → recibo → comprovante, "nessa exata ordem" | Evilásio exige o aviso. **O `neon.js` também manda para o 8 o item "Recibo de férias + comprovante de pagamento", que não pede aviso** | ⚠️ parte dos 27 "sem aviso" pode ser trava indevida |
| 9 TRCT | "Busco **comprovante TRCT**, baixo **o documento** e lanço" (1 arquivo, pasta offboard) | Evilásio une TRCT + comprovante e exige assinatura. Três nomes do Atlas caem no 9, um deles é "Comprovante de pagamento do TRCT" | ❌ falta definir por nome do Atlas: só o comprovante ou TRCT + comprovante |
| 10 GFD resc. | guia FGTS + comprovante, pasta offboard | Evilásio une as duas | ✅ (não conferido no código dele) |
| 24 GFD | só "verificar observações; reprovou = alertar o responsável" | pasta FGTS, nome com "guia" | ⚠️ sem regra de busca da Milena; o alerta é a Missão 3 |
| 25 RE | pasta ano/mês/FGTS | FGTS, nome com "RE", por unidade | ✅ |
| 26 Comp. FGTS | "o título não traz a unidade" | qualquer "comprovante" da pasta FGTS, **não filtra unidade**: 1 só arquivo vai para todas as unidades | ⚠️ confirmar se o comprovante é um só para todas |
| 56 Comp. folha | baixa todos os comprovantes e une | une todos da pasta do tomador (ou o "01 - Salarios") | ✅ |
| 59 Comp. recolhimento | "**já está subindo automático**" | acha e, desde 26/10, grava (vai para a aba 6) | ⚠️ risco de envio em dobro ainda aberto |
| 60 Recibo DCTFWeb | pasta INSS, recibo | INSS, "recibo" + "dctfweb" | ✅ |
| 61 Relatório DCTFWeb | pasta INSS, "relatório completo". Na mesma aba: "Gabriela (**Folha de pagamento mensal analítica**)" | INSS, "declaração completa" | ⚠️ a nota da folha analítica está na aba do 61, mas o código manda esse nome para o 63 |
| 63 Extrato folha | pasta FOPAG, "extrato da folha mensal"; "**já está automatizado**" | FOPAG, por unidade. Único nome do Atlas ligado: "Folha de pagamento mensal analítica" | ⚠️ risco de envio em dobro; confirmar se analítica = 63 |
| 64 CRF | tirar **direto no site da Caixa** (consulta CRF); validade de 30 dias | pega da pasta de certidões do SharePoint, se a data no nome ainda vale | ⚠️ depende de alguém salvar lá. A certidão LOCALIZADO não é reconferida antes do envio (validade curta) |
| 65 DARF | "filtrar pelo DARF no AFM" (não diz de onde vem) | INSS, "darf" sem "comprovante" | ❓ origem não confirmada pela Milena |
| 66 Ocorrências | baixa o modelo no Atlas e preenche | sem regra (manual); origem no banco = SharePoint (errada) | ✅ / SQL de correção pendente |
| 67 ASO dem. | "conferir se está **ativo** e se **não recusou** o ASO"; pasta offboards | pastas BR ASO/offboarding, nome com "ASO" + "demissional". **Não confere ativo nem recusa** | ⚠️ falta essa conferência; LGPD só no `conteudo.js` (não publicado) |
| 68 Baixa CTPS | pasta offboarding, "baixa da carteira" | offboarding, nome com "eSocial"/"CTPS" | ✅ (trava do mesmo arquivo não publicada) |
| 69 Pedido demissão | "quando o colaborador **pede** demissão"; arquivo "pedido de desligamento" ou "pedido de demissão" | aceita também "**carta de desligamento**" (vem do nome do Atlas) | ⚠️ carta da empresa pode passar pelo nome; o `conteudo.js` barra pelo texto (não publicado) |
| 78 ASO adm./per. | une os PDFs; conferir se está ativo | só "ASO admissional" tem nome ligado; nenhuma regra de busca | ⚠️ "ASO periódico" pode estar sendo descartado pelo `neon.js` |
| 79 Ficha registro | onboarding; "desconsiderar último pedido em 2024" | **nenhum nome do Atlas ligado ao 79** | ❌ se o Atlas pedir, a pendência não entra no Neon |
| 80 Registro eSocial | onboarding; se faltar, site do eSocial | **nenhum nome ligado ao 80** | ❌ idem |
| 81 CND Federal | tirar no rfb/pgfn; validade de 6 meses | pasta de certidões, nome "certidão negativa … tributos federais" ou "CND federal" | ⚠️ **"Positiva com efeitos de negativa" não casa** |
| 82 CNDT | site do TST, com captcha; não fica guardada | sem regra; **nenhum nome ligado ao 82**; origem no banco = SharePoint (errada) | ❌ idem 79 |
| 83 Cartão de ponto | exporta do controle de frequência **um PDF com todos** os colaboradores | sem regra. Desde 29/10 sabe-se que existe 1 PDF por colaborador por mês ("BR-Folha do ponto") | ❌ conflito: 1 PDF com todos expõe dados de outros; confirmar se vai por colaborador |
| 84 Convenção | vazio | sem regra | ❓ |

## Fraquezas da conferência do conteúdo (`conteudo.js`)
Documentos com as MESMAS palavras-chave: a conferência não distingue um do outro se o arquivo for trocado.
- 10, 24 e 25 = "fgts" (o 25 aceita qualquer PDF com "fgts").
- 60 e 61 = "dctfweb".
- 59 e 65 = "darf"/"arrecadação".
- 2 aceita "refeição" (seria VR).
- 8 e 9 conferem só o tipo, não se as partes estão todas lá (aviso, comprovante).

## Perguntas para a Milena
1. Doc 9: para cada nome do Atlas ("TRCT", "TRCT com comprovante", "Comprovante de pagamento do TRCT"), vai só o comprovante ou TRCT + comprovante?
2. Doc 8: o item "Recibo de férias + comprovante" também leva o aviso?
3. Docs 59 e 63: quem sobe hoje, e como? O robô deve parar de enviá-los?
4. "Folha de pagamento mensal analítica" é o 63 (extrato) ou outro?
5. Doc 26: o comprovante do FGTS é um só para todas as unidades?
6. Doc 83: sobe um PDF por colaborador ou o PDF com todos?
7. Doc 67: onde se vê se o colaborador recusou o ASO?
8. Doc 81: a certidão positiva com efeitos de negativa serve?

## Falta conferir
- Na última coleta do Atlas, quais nomes caem em "sem regra" no `neon.js` (79, 80, 82, ASO periódico?). Precisa de acesso à VPS (o tailscale ssh pediu aprovação no navegador em 03/11).
- Código do Evilásio (8/9/10): conferir a ordem e as partes exigidas.
