# Missão 1: revisão e correção do matching documental (03/11)

Origem: relatório de 30/10 (`ficha-documentos-atrasados-atlas-2026-10-30.xlsx`, aba Detalhes), motivo "O arquivo existe, mas o nome do documento não está na nossa lista de busca": **12 casos**, todos de 09/2026, "quem resolve: nós".

## Matriz dos 12 casos

| # | Pedido no Atlas | Unid. | Arquivo real (Factorial) | Causa | Classificação | Correção | Resultado no teste |
|---|---|---|---|---|---|---|---|
| 1, 2, 4 | ASO admissional/Periódico (78) | GO, MA, PA | `BR-ASO > ASO ADMISSIONAL - <nome>.pdf` | nome do Atlas fora da lista (`neon.js` só tinha "aso admissional") | regra de busca + alias | `classificar.js` (palavras) + regra 78 no `factorial.js` | achado |
| 3 | ASO admissional/Periódico (78) | PA | `BR-ASO > ASO <NOME>.pdf` (sem o tipo no nome) | nome do Atlas fora da lista + arquivo sem tipo no nome | regra + verificação estruturada | "sem tipo": só entra se não houver ASO com tipo, se for o único no período e se o **texto do PDF** disser admissional/periódico | achado só com texto que confirma; PDF imagem, demissional ou mudança de função = bloqueado |
| 5 | ASO admissional/Periódico (78) | MA | 2 ASO: `ASO ADMISSIONAL - <nome>.pdf` e `ASO Admissional - Alteração - Fiscal de Obras de Subestação.pdf` | nome fora da lista + 2 arquivos possíveis | **ambíguo: validação humana** | nenhuma escolha automática (diretriz) | bloqueado "alguém escolhe" |
| 6–11 | Comprovante de Registro E-Social (80) | GO, MA ×3, PA ×2 | `Anexos Contratos > eSocial.pdf` | nome fora da lista + a regra 80 só olhava onboarding/admissão | regra de busca + alias | `classificar.js`; regra 80 aceita a pasta "Anexos Contratos"; `conteudo.js` barra texto de desligamento/S-2299 (é a baixa, 68) | achado; baixa/offboarding/dois eSocial = não |
| 12 | Recibo de férias + comprovante de pagamento (8) | ES/CE | recibo em `BR-Ferias` | nome fora da lista + a regra de férias exigia o aviso, que o portal não pede | regra de busca (**código do Evilásio**) | `regras-factorial.js` monta só recibo + comprovante quando o Atlas não pede aviso | monta no teste; sem o comprovante não monta |

Resumo: **10 corrigíveis e corrigidos no nosso código**, 1 bloqueado para validação humana por regra (caso 5), 1 depende do dono da etapa (caso 12, doc 8 = sincronização do Evilásio; o nosso código já trata, mas fica desligado: `factorial.js --docs 8` só se o Evilásio desligar o dele).

## Verificações além do nome
- CPF: o colaborador é achado pelo CPF na Factorial; `conteudo.js` bloqueia PDF com CPF de outra pessoa.
- Mesmo arquivo em duas pessoas: trava de hash no `factorial.js` e no `enviar.js` (caso real de 19/10: o mesmo `eSocial.pdf` em 4 pessoas).
- Competência: 78 exige arquivo do período (janela); 83 exige o mês no nome.
- Situação do colaborador: 78/79/80 não valem para quem já saiu; 67/68/69 só para quem tem desligamento.
- Conteúdo: ASO com anamnese/ficha clínica não vai (LGPD); 80 com texto de desligamento não vai.
- Validade: certidões (64/81/82) pela data no texto.
- Contrato/UF: no Atlas a pendência já vem da unidade; no Bernhoeft o `auto.js` confere o contrato no texto.

## Revisão do catálogo (situações parecidas que ainda não tinham falhado)
Feita hoje antes desta etapa: `docs/conferencia-regras-atlas-2026-11-03.md`. O reconhecimento por palavras cobre todos os nomes do Atlas (`classificar.js`, 88 casos de teste), as pastas/arquivos do SharePoint (`sharepoint.js`, 120 casos) e a Factorial (67/68/69/78/79/80/83 e 8/9/10). Nome ambíguo (ex.: Alimentação/Refeição) não classifica e vai para o log.

## Evidências (testes, 03/11)
`node teste/t-missao1-12-casos.js` = **40 ok, 0 falhou** (os 12 casos com os nomes reais de pasta/arquivo, pessoa trocada por nome fictício; variações novas; casos em que nada pode ser escolhido). Regressão: `t-achar-arquivo` 120, `t-classificar-nome` 88, `t-conteudo-pdf` 32, `t-conteudo-validade-pdf` 10, `t-regras-factorial` 70, `t-reprovado-nao-sai` 14, `t-trava-mesmo-arquivo` 8, `t-validade-trava` 44: todos ok. Nenhum arquivo errado foi escolhido em nenhum teste.

## Falta (impedimentos e encaminhamento)
1. **Prova com os dados reais**: rodar `factorial.js --simular --docs 78,80` na VPS (container descartável, só leitura, nada gravado) e conferir os 11 casos de 78/80. Depois publicar (`classificar.js`, `neon.js`, `regras-factorial.js`, `factorial.js`, `conteudo.js`, `ler-pdf.js` + `vendor/`, `sharepoint.js`, `enviar.js`).
2. Caso 12 (férias): **Evilásio** ajusta a regra dele (não exigir aviso quando o Atlas pede só recibo + comprovante) ou desliga o 8 dele e liga o nosso.
3. Caso 5: **RH/Milena** diz qual ASO vai (o "Alteração" substitui o admissional?).
4. Origem: pedir ao RH que o ASO tenha o tipo no nome do arquivo (não é obrigatório para funcionar, só reduz o "alguém confere").
