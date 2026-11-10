# blip-subflows: pacote da skill

A skill dá a um projeto **bbuilder** suporte a subflows do Blip Builder: baixar, editar, salvar
rascunho e publicar um ou vários subflows sem publicar o flow pai. Com ela, `npm run pull` passa a
baixar flows + subflows num comando só.

## Para o agente

Leia e siga **[AGENT-INSTRUCTIONS.md](AGENT-INSTRUCTIONS.md)** do início ao fim. Em resumo:

```bash
node install.mjs <caminho-do-projeto-bbuilder> --dry-run
node install.mjs <caminho-do-projeto-bbuilder>
cd <caminho-do-projeto-bbuilder>
npm run pull
node .claude/skills/blip-subflows/scripts/subflows.mjs check --all
```

## Para pessoas

- **[TECHLEAD.md](TECHLEAD.md)**: contexto, como funciona, validação feita, riscos.
- **[skill/blip-subflows/SKILL.md](skill/blip-subflows/SKILL.md)**: o manual de uso.
- **[skill/blip-subflows/references/protocol.md](skill/blip-subflows/references/protocol.md)**:
  protocolo, `curl` e regras de compilação.

Requisitos: Node 22.18+, projeto bbuilder com `npm install` feito e `bbuilder login` feito.
Validado com bbuilder 0.0.13.
