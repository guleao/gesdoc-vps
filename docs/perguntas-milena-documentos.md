# Perguntas para a Milena, documento por documento (28/10/2026)

Objetivo: que cada um dos 36 documentos tenha uma regra que o robô consiga seguir sozinho. Isso inclui onde está o arquivo, como reconhecer o certo, de que mês ele é, o que vai junto e o que não pode ir. Base: `documentos-36.md`, a aba 8 do painel (`DOCS36`) e os motivos de reprovação lidos no Atlas em 28/10. Ao receber uma resposta, anotar ao lado (**R:**) e atualizar a regra no código, no `DOCS36` e no `documentos-36.md`.

## Perguntas que valem para TODOS os documentos

Para cada documento, o robô precisa de 8 respostas. Onde a planilha dela já responde, a pergunta não aparece de novo na lista abaixo.

1. **Onde fica:** pasta exata (Factorial ou SharePoint) e se muda de mês para mês ou de unidade para unidade.
2. **Como reconhecer o arquivo certo:** palavra no nome do arquivo, tipo de documento na Factorial, ou o que está escrito dentro do PDF.
3. **De que mês ele é:** a competência vem do nome da pasta, do nome do arquivo, da data dentro do PDF ou da data em que foi anexado?
4. **Mais de um arquivo possível:** qual vale? O mais novo? Ou nenhum, e a equipe escolhe?
5. **Partes e ordem:** vai um arquivo só ou vários unidos? Em que ordem? O que fica de fora (nota fiscal, ficha clínica…)?
6. **Validade:** o Atlas pede "data de validade" no envio? Qual data informar?
7. **Quando não existe:** deixar pendente, avisar alguém (quem?) ou pôr um comentário padrão (qual texto)?
8. **Outro caminho:** alguém da NIP ou outro sistema já envia esse documento? Se sim, o robô deve ficar fora dele, para não enviar em dobro.

## Benefícios (2, 3, 4, 5, 7)

**2 Vale alimentação**
- O mesmo PDF da empresa inteira vai para cada colaborador e cada unidade. A Equatorial aceita a relação com beneficiários de **outros contratos**, ou é preciso filtrar por unidade/contrato (LGPD)? Se for filtrar, quem faz?
- O mês do item no Atlas é o mês da **compra** do benefício ou o mês de **uso**? (Ex.: o item de 09/2026 recebe a pasta 09 ou a 08?)

**3 Vale transporte**
- VT de 03 com **2 fornecedores**: os dois vão no mesmo PDF? Em que ordem (fornecedor 1 inteiro e depois o 2, ou todas as relações primeiro)?
- A relação vem do CAJU ou da GVBus? Isso depende do estado?
- Quando há recarga complementar **depois** do envio, é preciso reenviar o item com a complementar, ou ela vai só no mês seguinte?
- **Reprovação de 28/10 (Piauí, pedido 00007):** "colaboradores não encontrados cadastrados e ativos no efetivo". Quem atualiza o efetivo no Atlas? Depois disso, o mesmo PDF pode ser reenviado?

**4 Seguro de vida**
- Aditamento da Prudential: ele entra no pacote de 06 e 08/2026? Em que posição (depois do boleto? no fim?)
- A pasta de 07/2026 está vazia: o documento existe? Quem salva?
- **Reprovação de 28/10:** pediram para "atualizar as datas de início e fim das atividades no efetivo". Quem faz, e isso vale para todos os contratos?

**7 Plano de saúde**
- 01 e 02/2025: o PDF já unido pela NIP tem a nota fiscal e não tem a relação. A relação desses meses existe? Onde?
- A "listagem de beneficiários deveria ser padronizada": o que muda de um mês para outro (nome do arquivo, formato)? Qual é o padrão certo?

**6 Vale refeição**
- "Uma declaração para cada colaborador": existe um modelo? Quem assina? Que dados vão nela (nome, CPF, valor, mês)?
- O robô pode gerar a declaração a partir de um modelo, ou ela tem que ser assinada à mão?

## Rescisão e desligamento (8, 9, 10, 67, 68, 69)

**8 Aviso e recibo de férias**
- Nenhuma das 27 pendências tem o "Aviso de férias" na Factorial (o recibo e o comprovante existem em 9 casos). Onde fica o aviso: em outra pasta, dentro do recibo, ou assinado em outro sistema?
- Se o aviso não existir, vale enviar só recibo + comprovante?
- O item é por **período de férias** ou por **mês**? Se as férias pegam dois meses, vai nos dois?

**9 TRCT**
- Cada rescisão gera 2 itens no Atlas: "TRCT" e "TCRT com comprovante". O que vai em cada um? Hoje os dois recebem o mesmo PDF (TRCT + comprovante).
- O TRCT tem 2 ou 3 partes (termo de rescisão, termo de quitação, homologação)? Todas vão?
- Termo **assinado à mão e escaneado** vale? Hoje 22 estão travados porque o nome do arquivo não diz "assinado" e a Factorial não mostra assinatura digital.
- O comprovante de pagamento: como reconhecer (nome do arquivo, banco)? Pode ser qualquer comprovante da pasta offboarding?
- **Reprovação (EDP-ES):** o colaborador aparece como inativo, mas a NIP diz que quem saiu foi outra pessoa. Isso foi resolvido? O item deve ser excluído?

**10 GFD rescisória**
- A guia é a do FGTS Digital da rescisão (com multa de 40%)? Como diferenciar da GFD mensal (doc 24) se as duas estiverem na pasta?

**67 ASO demissional**
- No Atlas vai **só a página do ASO**? Os #284 e #297 subiram com ficha clínica e anamnese e foram reprovados. Quando o PDF da Factorial vier com tudo junto, o robô deve cortar a página do ASO ou travar e avisar?
- Qual é a janela de data aceita? (Ex.: ASO feito até X dias antes ou depois do desligamento.) Hoje o robô pode pegar o ASO de outro contrato da mesma pessoa.
- "Conferir se não recusou o ASO": onde isso aparece? Existe um documento de recusa que substitui o ASO?
- Validade: qual data informar no envio?

**68 Baixa na CTPS e e-Social**
- Qual evento do e-Social vai: o **S-2299 (desligamento)**? A regra de hoje aceita qualquer arquivo com "esocial" ou "ctps" e mistura com o S-2200 (admissão).
- CTPS digital, recibo do e-Social ou os dois?
- Os #270, #273 e #275 receberam o arquivo do #269 (outra pessoa). Posso voltá-los para "pendente"?

**69 Pedido de demissão**
- Quando a **empresa** demite (12 casos com "aviso prévio do empregador indenizado"), o que vai no item "Pedido de demissão ou carta de desligamento"? O aviso prévio, outro documento, ou o item deveria ser contestado?
- Fim de contrato de experiência (#329): o que vai?
- Acordo entre as partes (art. 484-A): o que vai?

## Admissão e registro (78, 79, 80)

**78 ASO admissional e periódico**
- Hoje há 8 pendências e nenhuma regra. Em que pasta da Factorial ficam (a mesma "BR ASO")? Como diferenciar admissional de periódico de demissional pelo nome?
- "A equipe une os PDFs num só": une o quê? Admissional + todos os periódicos? Só o último periódico?
- Vai para o Atlas **e** para o Bernhoeft (a planilha diz os dois; o banco diz só Atlas)?
- Mesma pergunta do 67: só a página do ASO, sem ficha clínica?

**79 Ficha de registro**
- "Sempre colocar o e-Social": no Atlas também vai o e-Social no lugar da ficha, ou a ficha de registro existe na Factorial (pasta onboarding)?
- "Desconsiderar último pedido em 2024": o que quer dizer? Pedidos anteriores a 2024 ficam fora?
- Vai para o Atlas e para o Bernhoeft?

**80 Comprovante de registro e-Social**
- Hoje há 8 pendências e nenhuma regra. É o recibo do **S-2200 (admissão)**? Em que pasta e com que nome?
- "Se faltar, procura no site do e-Social": quem tem acesso? Dá para pedir à NIP que sempre anexe na Factorial?

## Documentos de empresa: FGTS, INSS, folha (24, 25, 26, 56, 59, 60, 61, 63, 65)

**24 GFD (FGTS Digital)**
- Uma GFD só vale para todas as unidades, ou cada unidade tem a sua?
- "Se reprovar, avisar o responsável": quem é?

**25 RE (relação de empregados)**
- Amapá 08 e 09/2026 sem RE: existe? Onde?
- Como saber a unidade de cada RE pelo nome do arquivo?

**26 Comprovante de pagamento do FGTS**
- O nome do arquivo não traz a unidade. É um comprovante por unidade ou um para todas? Se for um para todas, vai igual em cada unidade?

**56 Comprovante de pagamento da folha**
- "Une todos os comprovantes": todos os da pasta do tomador, ou só os dos colaboradores daquele contrato?
- Quando existe o "01 - Salarios" pronto, ele substitui os individuais?
- Adiantamento, férias e 13º entram no mesmo PDF?
- Amapá 08 e 09/2026 sem salário: onde estão?

**59 Comprovante de recolhimento** e **63 Extrato mensal da folha**
- "Já sobe automático": **quem ou que sistema** sobe? Se for verdade, o robô deve ficar fora desses dois.

**60 Recibo da DCTFWeb**, **61 Relatório da DCTFWeb** e **65 DARF**
- O recibo e o relatório são arquivos diferentes na pasta INSS? Como diferenciar pelo nome?
- DARF: vai só a guia (sem o comprovante)? E se houver DARF complementar no mês?

**63 Extrato mensal da folha** (além do item acima)
- Amapá 08 e 09/2026 sem FOPAG: onde está?

## Certidões (64, 81, 82)

- **64 CRF**, **81 CND Federal**, **82 CNDT:** o Atlas aceita uma certidão válida de **qualquer** mês, ou tem que ser emitida no mês do item?
- Qual data informar como validade no envio: a validade impressa na certidão?
- **82 CNDT:** não fica guardada em nenhuma pasta. Pode passar a ser salva em `0 - CERTIDÕES DE REGULARIDADE`, para o robô achar?
- **81:** quem (Gabriela?) salva na pasta, e com que frequência?

## Outros (66, 83, 84)

**66 Relatório mensal de ocorrências**
- É o modelo baixado do Atlas e preenchido à mão. De onde vêm os dados (afastamentos, admissões, demissões do mês)? Se vierem da Factorial, o robô pode preencher. Quais colunas o modelo tem?

**83 Cartão de ponto**
- Hoje há 16 pendências e nenhum robô busca. A exportação do controle de frequência (equipe "equatorial", apoios à fiscalização) é **um PDF com todos** ou um por colaborador? Vai igual em cada item?
- Em que dia do mês o ponto fecha (ou seja, a partir de quando dá para exportar)?

**84 Convenção coletiva (AC, CC ou AIT)**
- Qual convenção vale para cada contrato ou estado? Como reconhecer o arquivo certo em `06 Convenções Coletivas` (sindicato, estado, ano no nome)?
- "Anual, ou 30 dias após vencer": se a nova ainda não saiu, vai a vencida?

## Bernhoeft (95, 112–116)

- O robô precisa saber **sozinho** quando usar cada comentário padrão. Onde está a informação de que o colaborador é **administrativo**, **não dirige** ou **não faz atividade de NR**: cargo na Factorial, campo da ficha, lista à parte?
- **113 Certificado de qualificação:** que certificados são (NR-10, NR-35, curso técnico)? Todos juntos num PDF?
- **114 Integração:** quem emite? Em que pasta fica?
- **116 Treinamentos internos:** quais entram?

## Situação no Atlas (vale para todos)

- **"Aguardando predecessor":** 19 dos 24 envios do robô ficaram assim. O Atlas só analisa um mês depois que o mês anterior for aprovado? Então o certo é corrigir primeiro o mês mais antigo reprovado?
- **Documento atrasado:** a Equatorial ainda aceita o envio fora do prazo, ou o atraso já virou glosa e não adianta?
- **Item reprovado:** quem exclui o arquivo reprovado no Atlas, para o robô poder reenviar? O robô pode fazer isso sozinho, depois de mostrar o motivo no painel?
