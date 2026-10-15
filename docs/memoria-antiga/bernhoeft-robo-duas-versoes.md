---
name: bernhoeft-robo-duas-versoes
description: "Regra do robô Bernhoeft: manter a versão local (Windows, para testes) e a da VPS Ubuntu sempre atualizadas juntas, com fonte única."
metadata:
  node_type: memory
  type: feedback
  originSessionId: 67579c41-e7dc-4e78-878f-8ba7fb141ff6
  modified: 2026-10-06T19:29:47.547Z
---

O robô Bernhoeft roda em dois lugares: local (Windows, `Documents\bernhoeft-robo`, onde o usuário testa) e VPS Ubuntu (`/opt/bernhoeft-robo`, instalada por `deploy/setup-ubuntu.sh`). Toda mudança deve valer nos dois, feita uma vez só na pasta local.

**Why:** o usuário pediu para deixar a versão local para testar e sempre atualizar os dois juntos; anotou isso também no `CLAUDE.md` do projeto.

**How to apply:** não criar código exclusivo da VPS; diferenças de sistema (caminho do Chrome, headless) vão em variáveis de ambiente. Arquivo novo necessário ao robô entra também no `cp` do `setup-ubuntu.sh`. Avisar quando a VPS precisar ser reatualizada. Ver [[bernhoeft-robo-projeto]].
