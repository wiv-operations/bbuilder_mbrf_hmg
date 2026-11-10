# Instruções para o agente: instalar e usar a skill `blip-subflows`

Você é um agente de código trabalhando num **projeto bbuilder** (repo com `bbuilder.json`,
`package.json` dependendo de `bbuilder`, e `flows/<bot>/flow.json`). Siga os passos em ordem.
Não pule as verificações. Nenhum passo de instalação publica nada.

## 0. Pré-checagem (só leitura)

Na raiz do projeto do usuário:

1. Confirme que existem `bbuilder.json` e `package.json`, e que `package.json` depende de
   `bbuilder`. Se não existirem, **pare**: não é um projeto bbuilder.
2. Rode `node --version`. Precisa ser **22.18 ou mais novo** (exigência do bbuilder).
3. Se `node_modules/bbuilder` não existir, rode `npm install`.
4. Veja a versão do bbuilder em `package.json`. A skill foi validada com **0.0.13**. Se for
   outra, siga a instalação, mas o passo 4 (`check`) passa a ser obrigatório antes de qualquer
   publicação.

## 1. Instalar (automático)

Deste pacote (a pasta onde este arquivo está):

```bash
node install.mjs <caminho-do-projeto> --dry-run   # mostra o que faria
node install.mjs <caminho-do-projeto>             # aplica
```

O instalador é idempotente, e rodar de novo não duplica nada. Ele fica **dentro da skill**
(`skill/blip-subflows/scripts/install.mjs`; o `install.mjs` da raiz do pacote só chama esse). Se
alguém tiver copiado só a pasta da skill para o projeto, rode da raiz do projeto
`node .claude/skills/blip-subflows/scripts/install.mjs` para completar a instalação. O instalador
faz exatamente isto:

| O quê | Onde |
| --- | --- |
| Copia a skill | `.claude/skills/blip-subflows/` (SKILL.md, references/protocol.md, references/claude-md-section.md, scripts/install.mjs, scripts/subflows.mjs, scripts/portal-compiler.mjs, scripts/patch-blip-sdk.mjs, scripts/patch-bbuilder.mjs) |
| Scripts npm | `package.json`: `"pull": "bbuilder pull && npm run pull:subflows"`, `"pull:subflows": "node .claude/skills/blip-subflows/scripts/subflows.mjs pull --all"` e `"postinstall"` com os dois patches (encadeado com `&&` se já existir um) |
| Patch do SDK | aplica uma vez `scripts/patch-blip-sdk.mjs` em `node_modules/@whitewall/blip-sdk`. Daí em diante, o `postinstall` reaplica em todo `npm install` |
| Patch do bbuilder | aplica `scripts/patch-bbuilder.mjs` em `node_modules/bbuilder`: `push`/`publish` agem só nos flows passados (`bbuilder publish <id> [id...]`), e o comando sem argumento é recusado (`--all` para todos). Também entra no `postinstall` |
| Ignora snapshots locais | `.gitignore`: `subflows/**/.previous/` |
| Documentação para agentes | `CLAUDE.md`: seção entre `<!-- blip-subflows:start -->` e `<!-- blip-subflows:end -->` + linha `blip-subflows` na tabela de skills |

Se o instalador disser que **já existe um script `pull` diferente**, não use `--force` sem olhar:
mostre o script atual ao usuário e combine os dois (o novo precisa continuar começando com
`bbuilder pull &&`).

Se ele listar linhas de comando do `CLAUDE.md` que ainda rodam `bbuilder pull` sozinho, troque cada uma
por `npm run pull`. A única forma de baixar o bot passa a ser `npm run pull`.

### Instalação manual (se não puder rodar o instalador)

1. Copie `skill/blip-subflows/` para `<projeto>/.claude/skills/blip-subflows/`.
2. Adicione ao `package.json` os scripts `pull`, `pull:subflows` e `postinstall` da tabela acima.
3. Adicione `subflows/**/.previous/` ao `.gitignore`.
4. Cole o conteúdo de `skill/blip-subflows/references/claude-md-section.md` no fim do `CLAUDE.md`,
   entre `<!-- blip-subflows:start -->` e `<!-- blip-subflows:end -->`, e adicione a linha da
   skill na tabela de skills:
   `` | `blip-subflows` | Subflows (`subflow:` states, `subflows/<parent>/<shortName>/`): pull, edit, push draft, publish one or many, undo | ``
5. Troque menções a `bbuilder pull` por `npm run pull`.
6. Rode `npm install` para aplicar os patches pelo `postinstall`.

**A instalação só está completa com as quatro partes:** skill, `package.json`, `.gitignore` e
`CLAUDE.md`. Copiar só a pasta da skill deixa os agentes do repo sem as regras, porque o
`CLAUDE.md` não fica sabendo dela. O próprio `SKILL.md` tem uma checagem no topo que detecta isso.

## 2. Login

O script usa o mesmo login do bbuilder (e-mail do portal + chave de acesso). Se `bbuilder login`
ainda não foi feito nesta máquina, peça ao usuário para rodar. É interativo, e você não deve
pedir nem digitar a chave dele.

## 3. Primeiro download

`npm run pull` sobrescreve `flows/` com o que está no Blip. Antes:

```bash
git status            # se houver mudanças em flows/ não commitadas, pergunte ao usuário antes
bbuilder diff         # mostra edições locais que um pull descartaria
npm run pull          # flows/ + subflows/
```

Resultado esperado: `Successfully pulled N flows` e, em seguida, uma linha `⬇️  <pai>/<sub>: X states`
por subflow. A pasta `subflows/` é criada pelo comando; não a crie à mão. Se nenhum flow usa
subflow, a segunda parte apenas informa que não há subflows.

## 4. Verificação de qualidade (obrigatória, offline)

```bash
node .claude/skills/blip-subflows/scripts/patch-blip-sdk.mjs --check
node .claude/skills/blip-subflows/scripts/patch-bbuilder.mjs --check
node .claude/skills/blip-subflows/scripts/subflows.mjs list
node .claude/skills/blip-subflows/scripts/subflows.mjs check --all
```

- `patch-bbuilder.mjs --check` também precisa sair com código 0. Confirme com `npx bbuilder publish`
  sem argumentos: ele tem que ser **recusado** ("Say which flows to publish"). Se não for, o
  `publish` voltou a publicar todos os flows. **Não rode `bbuilder publish`** e avise o usuário.
- `patch-blip-sdk.mjs --check` precisa sair com código 0 (`already patched`). Se falhar com
  `unknown shape (SDK changed?)`, a versão do SDK mudou. **Ninguém deve rodar `bbuilder publish`
  em flows com bloco `subflow:`** até o patch ser atualizado. Avise o usuário.
- `✅ compiled draft is identical to the published document`: o compilador do script reproduz o
  do portal para aquele subflow. É o esperado.
- `🟡 N difference(s)`: normal **somente** se aquele subflow tem rascunho não publicado. Mostre as
  diferenças ao usuário e pergunte se o rascunho tem mesmo mudanças pendentes.
- Se um subflow que **não** tem mudanças pendentes der 🟡, o Blip mudou o compilador (ou a versão
  do bbuilder é outra). **Não publique nada.** Reporte as diferenças ao usuário.
- `⚠️ validation error(s)`: o rascunho tem erro. Não publique até corrigir.

## 5. Usar no dia a dia

Antes de editar qualquer coisa em `subflows/`, **leia `.claude/skills/blip-subflows/SKILL.md`**.
É a fonte de verdade. O ciclo é:

```bash
S=.claude/skills/blip-subflows/scripts/subflows.mjs
npm run pull                       # sempre partir do que está no Blip
# editar subflows/<pai>/<sub>/flow.json (e/ou configuration.json)
node $S check <alvos>              # validação + compilado vs publicado
node $S diff <alvos>               # confira que só aparece o que você quis mudar
node $S push <alvos>               # opcional: só rascunho, não vai ao ar
node $S publish <alvos> --yes      # VAI AO AR
node $S diff <alvos>               # deve terminar em "identical" / "nothing"
```

Regras que você precisa seguir:

1. **`publish` e `undo` mudam o que os usuários reais recebem.** Avise o usuário e espere a
   confirmação, a não ser que ele já tenha pedido a publicação explicitamente. O script exige `--yes`.
2. **Peça para o usuário fechar o canvas do subflow no navegador** antes de `push`/`publish`. Um
   canvas aberto salva o rascunho antigo por cima. Se o script disser
   `the Blip draft changed since the last pull`, **não use `--force`** por conta própria: rode
   `diff`, mostre ao usuário, e normalmente faça `pull` + reaplique a edição.
3. **Edite só `flow.json` e `configuration.json`.** Nunca edite `flow-published.json`,
   `subflow.json`, `.sync.json` nem `.previous/`.
4. **Os subflows estão no modelo do canvas** (`$title`, `$contentActions`, `$enteringCustomActions`,
   `$leavingCustomActions`, `$conditionOutputs`, `$defaultOutput`), não no formato minificado de
   `flows/`. Para a semântica de ações e condições, carregue a skill `blip-flows`.
5. **Restrições de subflow:** condições de saída só com `source` `input` ou `context`. Sem
   `ProcessContentAssistant`. `Redirect` só no estado `end`. Toda saída precisa apontar para
   um estado existente. O `check` aponta essas violações.
6. **`bbuilder publish` não publica subflows**, e `publish` desta skill não publica o flow pai.
   Se a mudança envolve os dois, publique cada um com a ferramenta dele, e diga ao usuário a ordem.
   Antes de qualquer `bbuilder publish`, rode `patch-blip-sdk.mjs --check`. Sem o patch, o Blip
   recusa todo flow com bloco de subflow e deixa uma entrada falsa no histórico de publicações.
   Lembre também que, com o patch do bbuilder, o `bbuilder publish` exige os flows: rode
   `bbuilder publish <id> [id...]` só com os flows que mudaram. Use `--all` apenas se o usuário
   pedir para publicar tudo.
7. **Desfazer:** `node $S undo <alvos> --yes` volta rascunho e publicação ao estado anterior ao
   último push/publish (guardado em `.previous/`). Só existe um nível de undo.
8. **Nunca** grave chaves de bot ou do portal em arquivos do repo. As receitas de `curl` em
   `references/protocol.md` usam variáveis de ambiente.

## 6. Relatar ao usuário

Ao terminar uma instalação, informe: arquivos alterados, resultado do `npm run pull` (quantos
flows e subflows) e o resultado do `check --all`, mostrando cada linha que não for ✅.
