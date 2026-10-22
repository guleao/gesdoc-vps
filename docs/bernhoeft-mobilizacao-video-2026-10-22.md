# Bernhoeft: como a NIP/Igneo envia (reunião gravada de 22/10/2026)

Fonte: `Downloads/videoplayback.mp4` (42 min, reunião "Bernhoeft com Pablo", 11:20–12:01). A fala foi transcrita no PC (whisper.cpp) e os quadros tirados pelo ffmpeg, em `%TEMP%/igneo-video`. Sem nome ou CPF de colaborador aqui.

## Quem envia
- Segundo o usuário (22/10), o login da tela é **o mesmo usuário da NIP que o robô usa**. Então o diagnóstico de 19/10 ("outro login envia") estava errado. Pelo vídeo, esse login cria mobilização e sobe arquivo. Ou o perfil mudou depois de 19/10, ou o GetUserInfo/ListarCompetencias olhado não era o que vale para a Mobilização. Reconferir só leitura.

## Caminho no portal: Carregamento de Documentos → Mobilização
1. Na lista "Carregamento de Documentos – Mobilização", filtrar pelo número do contrato (ex.: 757/2025-PA, 4600029823/2024-MA). Cada linha mostra contratante, competência, contrato, contratada, área, CNPJ, status e "Doc. pendentes".
2. **Nova Mobilização**: escolher contrato e contratada, depois "Salvar".
   - **Trava:** se o contrato tiver documento **de empresa** pendente (etapa 6), o portal mostra "Aviso: este contrato possui objetos bloqueáveis com pendências. Não será possível criar novas mobilizações". No vídeo, os bloqueados eram Brigada de Incêndio e Plano de Emergência (os mesmos das nossas 10 pendências). Ele trocou de contrato até achar um sem pendência.
3. As **etapas de 1 a 8** são o cadastro da mobilização:
   - **2 · Relação dos trabalhadores:** grade com Nome completo, Matrícula, PIS, CPF, RG, Passaporte, Data de nascimento, Sexo, Salário, Função, Admissão, Local de serviço etc. Tem também "Escolher arquivo", para importar uma planilha modelo ("clique aqui"). Legenda: dados já existentes, dados inválidos, desmobilizados.
   - Se o CPF já estiver cadastrado, o portal avisa e mostra o "Histórico das competências do colaborador" ("já está em uma competência de mobilização").
   - **4 · Atualizar dados dos trabalhadores.**
   - **5 · Documentos dos trabalhadores:** um bloco por pessoa com a lista de itens pedidos. Em cada item: ações (nuvem = subir arquivo, lápis, balão = comentário), arquivo anexado, data e status. Tem os filtros "Selecionar todos" e "Mostrar apenas pendentes", "Local de serviço" e o aviso "os documentos anexados serão pré-analisados automaticamente". Logo depois de subir, o status ficou "Não conforme" (é a pré-análise automática).
   - **6 · Documentos da empresa** (é o que trava a mobilização).
   - **7 · Documentos dos veículos.**
   - **8 · Concluir carregamento.**
   - O "Resumo" mostra a movimentação de pessoal e tem o botão "Associar atividade aos colaboradores".
4. A faixa amarela do topo avisa: "FORNECEDOR EQUATORIAL – após o cadastro do colaborador, toda a documentação deverá ser carregada no prazo de até 15 dias. Caso contrário, o colaborador será automaticamente [desmobilizado]".

## Itens da etapa 5, com o código do portal
SQ1 ASO · SQ1 Comprovantes de treinamento de segurança (OS NR01 e demais NRs, com conteúdo programático) · SQ1 CTPS (identificação, qualificação, contrato, ou CTPS Digital) · Certificado de Direção Defensiva (para condutores) · Certificado de Qualificação Profissional (engenheiros, eletrotécnicos etc.) · Certificado de Treinamento de Integração · Certificado de Primeiros Socorros · CNH (para quem dirige veículo ou opera máquinas).

## Regras faladas
- Todos os dados do cadastro (nome completo, matrícula, PIS, CPF, RG, nascimento...) **vêm da Factorial**, copiados à mão. "É a parte demorada; depois, subir a documentação é simples."
- O colaborador é cadastrado **uma vez só** e fica para sempre. Quando é desligado da NIP, ele é **inativado**, não apagado.
- Para achar um colaborador já cadastrado: relatórios do menu da esquerda.
- Os comentários padrão (EPI, primeiros socorros, direção defensiva, eSocial/CNH em substituição, NRs) foram colados no chat dessa reunião. Já estão no painel (aba 7) e em `bernhoeft-robo/comentarios.json`.

## O que isso muda para o robô
- O documento de colaborador **não aparece como pendência sozinho**: primeiro é preciso criar a mobilização e cadastrar a pessoa (etapas 1–4). Só depois a etapa 5 lista os itens. A nossa leitura atual (Carregamento Mensal) não vê nada disso.
- A automação completa seria: Factorial (dados + arquivos) → cadastrar na etapa 2 (ou importar a planilha modelo) → etapa 5: subir arquivo ou pôr o comentário padrão em cada item → concluir.
- Pré-requisitos: perfil de **Carregamento Mobilização com criar/editar** e contrato vinculado ao nosso login, e os documentos de empresa do contrato em dia (senão a mobilização nem abre).
