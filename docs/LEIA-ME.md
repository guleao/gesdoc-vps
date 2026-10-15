# Pacote GesDoc / robôs / VPS

1. Copie esta pasta inteira (ou o .zip) para o outro PC por pendrive ou rede local sua.
2. Rode `restaurar.ps1` (copia os projetos para Documents, roda npm install e restaura a memória do Claude Code).
3. Reconfigure os segredos (HANDOFF.md, seção 8). Eles NÃO estão neste pacote.
4. No Claude Code do PC novo, peça para ler o `HANDOFF.md`. Ele conta tudo: o que é o projeto, o que funciona, o que falta e as regras.

Conteúdo: `projetos/` (código e dados dos robôs, sem sessões de login), `claude/memory` (memórias), `claude/sessoes` (transcrições antigas, só histórico), `referencias/` (guia do Evilásio, artefato, relatórios).
Atenção: `projetos/*/out` tem dados de pendências (CPFs, e-mail da conta). Guarde o pacote com cuidado.
