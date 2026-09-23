# Improvement Review — Agency Hub

Revisão geral, melhorias e validação do sistema — 2026-09-23.

Escopo: todo o monorepo (`apps/api`, `apps/web`, `e2e`, infraestrutura de deploy), lido
por completo antes de qualquer alteração, com a especificação em `docs/sdd/` como
contrato. Toda mudança abaixo foi feita para corrigir um defeito comprovado ou remover
um atrito evidente, sem criar áreas novas de produto e **sem nenhuma migração de banco**.

---

## Resumo executivo

### Estado encontrado

Um MVP maduro, já em produção (`https://2-25-72-199.sslip.io`), com arquitetura sólida:
RLS no PostgreSQL como segunda linha de defesa, escopo de tenant obrigatório em todas as
rotas, upload direto para o storage, 385 testes de integração e 115 E2E verdes na linha de
base. Lint, typecheck, formatação e build passavam.

### Principais problemas

Os defeitos que restavam não apareciam nos testes porque dependiam de **volume**, de
**fuso horário**, de **concorrência** ou de **tempo passando**:

- **Dashboard mentindo:** os contadores "Hoje", "Atrasados", "Pendências vencidas" e
  "Pendências com você" nunca passavam de **5** (liam o tamanho do painel, não o total).
- **"Hoje" em UTC:** para quem está no Brasil, o dia virava às 21h — posts do horário
  nobre sumiam do painel "Hoje" e prazos venciam 3 horas antes; o frontend ainda exibia
  todo prazo **um dia antes** (22/09 para um prazo de 23/09).
- **Push parava para todos** quando se acumulavam 200 notificações não lidas de pessoas
  sem dispositivo cadastrado (o caso comum) — o lote era sempre preenchido pelas mesmas.
- **Conteúdo atrasado notificava de hora em hora**, por até 30 dias, inclusive por push.
- **Campanhas ocultas vazavam** para o cliente (e qualquer campanha para colaboradores)
  pelas notificações; colaboradores viam campanhas, contra a matriz de permissões.
- **Segurança:** o bloqueio de login e o limite por IP eram contornáveis com tentativas
  simultâneas; reautenticação e troca de senha aceitavam tentativas ilimitadas; o limite
  de tamanho de upload era verificado só no tamanho *declarado*.
- **Arquivos anexados a respostas** de pendências eram gravados e **nunca exibidos**;
  comentários e respostas não diziam **quem** escreveu; a fila de exclusões não dizia
  **o que** seria excluído.
- **Excluir pasta com arquivos** caía em "Erro interno"; pastas cujos arquivos já tinham
  sido excluídos **nunca mais podiam ser apagadas**.
- **Telas rolando de lado:** no celular, qualquer título longo fazia o início e as listas
  de pendências e campanhas rolarem para o lado; um link colado ou um nome sem espaços
  passava da borda até no desktop; o menu do admin saía da tela em 1280 px.
- **Empresas sumindo dos seletores:** acima de 100 empresas (arquivadas contam), algumas
  não apareciam em nenhum seletor do sistema.

### Principais melhorias

41 defeitos corrigidos (backend e frontend), com testes novos para cada correção de
backend; carregamento inicial do app **~39% menor** (477 KB → 290 KB; 135 → 92 KB gzip);
nomes de pessoas em todas as telas colaborativas; busca de arquivos; diálogo de
duplicação com seletor de data; troca de senha acessível; tratamento de erros de
renderização; cabeçalho de cache correto após deploys.

### Resultado final

Tudo validado localmente — lint, typecheck, formatação, build, **417** testes de
integração/unitários, **118** E2E em desktop e celular (117 na execução completa; o que
falhou por lentidão no arranque passou ao ser repetido) e validação manual no navegador
(detalhes em [Testes executados](#testes-executados)). Commit no branch
`improvement-review`, com pull request para o CI; o merge em `main` publica em produção
automaticamente e ficou para a sua confirmação (ver [Git](#git)).

---

## Bugs encontrados

Todos com status **Corrigido**, salvo indicação. "Teste" aponta onde a correção é provada.

### Backend

| # | Problema | Impacto | Causa | Solução | Teste |
|---|---|---|---|---|---|
| 1 | Contadores do dashboard presos em 5 | Agência com 12 conteúdos atrasados via "5"; decisões sobre dados errados na tela principal | `counts.today = todayContent.length`, e a lista era `take: 5` | Contagens próprias no banco (`count`) para hoje, atrasados, pendências vencidas e "pendências com você" | `dashboard.test.ts` |
| 2 | "Hoje" e "atrasado" medidos em UTC | Posts entre 21h e 0h fora de "Hoje"; prazos vencidos às 21h da véspera; flag `isToday` do calendário errada | `Date.UTC(...)` como início do dia em 3 módulos | Módulo `shared/business-day.ts` com fuso configurável (`APP_TIMEZONE`, padrão `America/Sao_Paulo`), inclusive horário de verão | `business-day.test.ts`, `dashboard.test.ts` |
| 3 | Mensagens de notificação com códigos em inglês ("agora está como in_review", "instagram: published") | Texto incompreensível para o cliente | O status bruto era interpolado na mensagem | `notifications/labels.ts` com os mesmos rótulos pt-BR das telas | `campaigns.test.ts` |
| 4 | Notificação de campanha para toda a empresa | Cliente recebia nome/situação de campanha marcada como **interna**; colaborador recebia de qualquer campanha | Audiência `companyAudience` sem filtro de papel/visibilidade | Audiência por papel: agência sempre, cliente só se `visibleToClient`, colaborador nunca | `campaigns.test.ts` |
| 5 | Colaborador via campanhas | Orçamento e gasto do cliente expostos a freelancers; a matriz (06) diz ❌ | `visibilityScope` tratava colaborador como cliente | Regra única `campaignVisibilityScope` usada por lista, detalhe, dashboard e contas de anúncio | `campaigns.test.ts`, `dashboard.test.ts` |
| 6 | Limite de tamanho do upload só no tamanho declarado | Quem declarasse 1 KB podia armazenar até 5 GiB por parte (URL pré-assinada não limita o corpo) | Nenhuma verificação na conclusão | Soma das partes (lista do próprio storage) comparada ao limite antes de montar; excedeu → aborta no storage, marca a sessão e responde `file_too_large` | `uploads.test.ts` |
| 7 | Contador de falhas de login com leitura-escrita não atômica | Rajada de senhas simultâneas nunca atingia o bloqueio | `failedLoginAttempts + 1` calculado em memória | `increment` atômico no banco, compartilhado por login, reautenticação e troca de senha | `auth.test.ts` (rajada de 8) |
| 8 | Limite de 20 tentativas/hora por IP contornável por concorrência | 26 tentativas simultâneas passavam todas | Contava antes de registrar | Registra a tentativa e só então conta | `auth.test.ts` (rajada de 26) |
| 9 | Reautenticação e troca de senha sem limite de tentativas | Um cookie roubado servia de oráculo ilimitado para a senha | Falha não contava para o bloqueio | Mesmo contador e bloqueio do login | `auth.test.ts` |
| 10 | Revisão de exclusão com corrida | Dois admins decidindo ao mesmo tempo: a segunda decisão sobrescrevia a primeira e o solicitante era notificado duas vezes | Checagem lida antes, `update` sem condição | `updateMany` com `status: 'pending'` no `WHERE` (o lock de linha serializa) | `files.test.ts` |
| 11 | Filtro `companyId` da lista de exclusões não validado | Violava o contrato anti-IDOR (o RLS impedia o vazamento, mas a regra da aplicação faltava) | `requireCompanyAccess` ausente | Validação igual às demais listas; empresa alheia = 404 idêntico a inexistente | `files.test.ts` |
| 12 | Reatribuir acompanhamento sem validar o responsável | Tópico parado na fila de quem não enxerga a empresa; id inexistente virava erro 500 | `PATCH /topics` não chamava `assertResponsibleHasAccess` | Mesma regra da criação | `comments-topics.test.ts` |
| 13 | Job de conteúdo atrasado notificava de hora em hora | Após ler, uma nova notificação por hora; enquanto não lida, o `created_at` renovado reenviava o push a cada hora — por até 30 dias | Upsert "renovava" a linha a cada execução | Avisa cada pessoa **uma vez por atraso** (reagendado e perdido de novo = novo aviso); consulta em lote | `notifications.test.ts` |
| 14 | Push parava para todos | Com ≥ 200 não lidas de quem não tem dispositivo, nenhum push novo saía | Lote "mais antigas primeiro" nunca avançava sobre linhas que o job não marca | Só linhas da última hora, só de quem tem dispositivo, mais novas primeiro | `push-dispatch.test.ts` (novo) |
| 15 | Excluir pasta com arquivos | "Erro interno" em vez de "esvazie a pasta" | Só subpastas eram contadas; a FK barrava o `DELETE` | Conta arquivos vivos e envios em andamento → 409 claro | `projects-folders.test.ts` |
| 16 | Pasta cujos arquivos foram excluídos nunca podia ser apagada | Pasta "vazia" na tela e impossível de remover | Arquivos com exclusão lógica ainda referenciavam a pasta | Desvincula arquivos já excluídos e envios encerrados antes de apagar (registros preservados) | `projects-folders.test.ts` |
| 17 | Paginação sem desempate | Itens repetidos ou sumindo entre páginas quando o valor ordenado empata (ex.: vários posts às 19h) | `ORDER BY` só por colunas não únicas | `id` como último critério em todas as 12 listas paginadas | suíte completa |
| 18 | `?needsAttention=false` filtrava como `true` | Contrato da API quebrado | `z.coerce.boolean()` lê "false" como verdadeiro | `booleanQuery`, a convenção já existente no projeto | `campaigns.test.ts` |
| 19 | Link de publicação aceitava `javascript:` | XSS armazenado disparado ao clicar em "Abrir publicação" (em produção a CSP bloquearia; em outros ambientes não) | `z.string().url()` aceita qualquer esquema | Somente `http(s)` | `publications.test.ts` |
| 20 | Imagem de marca acima de 4 MB → "Requisição inválida" | Mensagem inútil | O 413 do parser multipart caía no genérico | 413 → `file_too_large` | `branding.test.ts` |
| 21 | SVG de marca servido na origem do app sem política própria | Um SVG malicioso aberto diretamente rodaria script junto da sessão | Sem CSP/`nosniff` na resposta do asset | `Content-Security-Policy: default-src 'none'; …; sandbox` + `nosniff` | `branding.test.ts` |
| 22 | Conceder acesso derrubava todas as sessões do usuário | Colaborador vinculado a um novo cliente era deslogado — e perdia um upload em andamento | Toda alteração de vínculo revogava sessões, embora o acesso seja recalculado a cada requisição | Só revoga quando o acesso **diminui** (revogação ou permissão desligada) | `tenant-isolation.test.ts` |

### Frontend

| # | Problema | Impacto | Causa | Solução |
|---|---|---|---|---|
| 23 | Prazos exibidos um dia antes | "Prazo 22/09" para pendência de 23/09 (listas, detalhe, dashboard, acompanhamentos) | Data sem hora (meia-noite UTC) formatada no fuso do navegador | `formatDateOnly` em UTC; E2E verifica o dia exibido |
| 24 | Filtros de data do dashboard em UTC | "De 23/09" começava às 21h de 22/09 | `T00:00:00.000Z` fixo | Limites do dia local |
| 25 | Cliente/colaborador com várias empresas via só a primeira | Sem como ver as outras empresas no início (a especificação suporta N empresas para qualquer papel) | `memberships[0]` fixo | Seletor de empresa quando há mais de uma |
| 26 | Lista do calendário sem data | Na visão "Lista" só aparecia a hora | `ContentRow` mostrava `formatTime` | Data e hora na lista |
| 27 | Duplicar conteúdo com `window.prompt` "AAAA-MM-DD" | Digitação de data no teclado do celular; sugestão um dia depois para posts noturnos; "Data inválida" em alerta verde de sucesso | Prompt nativo + `toISOString()` | Diálogo com seletor de data nativo, mesmo horário do original |
| 28 | Arquivo anexado à resposta de pendência invisível | Quem pediu o material não conseguia abri-lo pela conversa | `CommentThread` não renderizava anexos | Anexo com nome, tamanho e botão "Baixar" (ou "Arquivo excluído") |
| 29 | Download falhava em silêncio; `window.open` após `await` | Botão "Baixar" sem efeito no iPhone em rede lenta (bloqueador de pop-up) e sem mensagem de erro | Janela aberta fora do gesto; rejeição não tratada | Navegação para a URL assinada (`attachment`), estado "Preparando…" e erro visível |
| 30 | Gerente com permissão de excluir era mandado pedir exclusão | Precisava de aprovação de um admin para o que já podia fazer | Botão considerava só "próprio upload ou admin" | Espelha a regra do servidor (inclui `can_delete_company_files`) |
| 31 | Erro ao solicitar exclusão escondido atrás do modal | Solicitação falhava sem aviso visível | Alerta renderizado na página, atrás da sobreposição | Erro dentro do modal; formulário envia com Enter; dica de mínimo de 5 caracteres |
| 32 | Fila de exclusões sem paginação e sem contexto | Histórico acima de 20 itens inacessível; admin aprovava sem saber qual arquivo, de qual empresa, pedido por quem | Página fixa e resposta sem esses dados | Paginação; nome do item, empresa, solicitante, revisor; "Baixar para conferir" |
| 33 | Mensagens em inglês no envio de arquivos | "You can only upload: image/*…", "Storage rejected the part…" | Mensagens do Uppy e do XHR exibidas como vieram | Mensagens pt-BR próprias |
| 34 | Modal cortado no celular e sem teclado | Formulário alto (campanha) com topo e botões inalcançáveis; Esc não fechava; foco fugia | Sobreposição `fixed` sem rolagem; sem gestão de foco | Sobreposição rolável, Esc, foco preso e devolvido, página de fundo travada |
| 35 | Nenhum error boundary | Qualquer erro de renderização deixava a tela em branco | Ausente | Boundary global e dentro do shell (cabeçalho continua utilizável) |
| 36 | Seletor de projeto limitado a 20 | Projetos além do 20º impossíveis de escolher numa nova pendência | Primeira página da lista | `pageSize` máximo (100), como já feito para empresas |
| 37 | Menu do admin passava da borda no desktop | Com 14 seções numa linha, "Identidade visual" e "Backup do banco" ficavam fora da tela de 1280 px, atrás de uma rolagem lateral da página inteira | Menu numa linha só, ao lado do logo | A partir do tablet o menu tem linha própria e quebra; no celular continua a faixa com rolagem própria. O E2E "nenhuma tela rola de lado" passou a rodar também no desktop |
| 38 | Títulos longos faziam a página rolar de lado no celular | Início, lista de pendências e lista de campanhas rolavam para o lado com qualquer título maior que o cartão (ex.: "Post Instagram — Lançamento coleção verão 2027 carrossel") | `truncate` num `<Link>` inline (que não corta) e grade do início com trilha `auto` (que cresce com o texto) | `block` nos links truncados e `grid-cols-1` (trilha que encolhe) nas grades de painéis: o título termina em "…" |
| 39 | Links e nomes sem espaço vazavam da tela | Link colado numa descrição ou comentário, `nome_de_arquivo_assim`, título sem espaços: o detalhe de pendência e o de campanha passavam **até da tela do desktop** (+433 px e +582 px); no celular também acompanhamentos, notificações e o objetivo da campanha | Palavra sem ponto de quebra não quebra por padrão | `overflow-wrap: break-word` global (só age quando a palavra não cabe na linha; o resto do texto quebra como antes) + `min-w-0` nos títulos das telas de detalhe |
| 40 | Seletores de empresa limitados às 100 primeiras | Acima de 100 empresas (as arquivadas contam), algumas não apareciam em nenhum seletor: início, calendário, arquivos, pendências, campanhas, publicações, projeto | Uma única página de 100, o máximo da API | Todas as páginas buscadas (as seguintes em paralelo), sem mudar a API. O E2E exige que a empresa criada por último esteja no seletor; numa execução completa o banco passa de 100 empresas |
| 41 | Resposta de sucesso fora do envelope quebrava a tela | Um proxy ou um servidor reiniciando que devolvesse HTML com status 200 virava "Query data cannot be undefined": tela quebrada, sem "Tentar novamente" | `apiEnvelope` aceitava uma resposta sem `data` | Resposta sem envelope vira um erro comum (`internal_error`), com a mensagem e o retry de sempre |

Também corrigido: `index.html` sem `Cache-Control` — navegadores guardavam a versão
anterior do app por horas após um deploy (Caddy agora envia `no-cache` para o shell, com
revalidação por ETag; verificado com o Caddy real em container).

---

## Melhorias de performance

| Problema identificado | Alteração | Impacto | Status |
|---|---|---|---|
| Um único bundle de 477 KB (135 KB gzip) com todas as telas e o Uppy, baixado antes da tela de login | Divisão por rota (`lazyPage`), mantendo login, troca de senha e início no pacote inicial; recarga única e automática se um deploy trocar os arquivos com a aba aberta | Carregamento inicial **290 KB (92 KB gzip)**, ~39% menor; Uppy (79 KB) só nas telas de envio | Feito |
| Notificação gravada com um `INSERT` por destinatário dentro da transação da requisição | Um único `INSERT … SELECT unnest(...)` por evento | Evento para N pessoas: 1 ida ao banco em vez de N | Feito |
| Job de atrasados: uma consulta de audiência por conteúdo | Leitura em lote das notificações anteriores + cache de audiência por empresa | Menos consultas por execução | Feito |
| Job de push reconsiderando indefinidamente as mesmas linhas a cada minuto | Horizonte de 1 hora e filtro por quem tem dispositivo | Trabalho por minuto limitado ao que pode de fato ser enviado | Feito |
| Deploy servia versão antiga por horas (cache heurístico) | `Cache-Control: no-cache` no shell | Uma revalidação 304 por carregamento; versões novas chegam na hora | Feito |
| Efeito colateral da divisão por rota: a primeira visita a cada seção esperava o download do código dela, com a tela anterior parada e sem sinal de que o toque funcionou | Pré-carregamento das demais telas quando o navegador fica ocioso, depois do login (`requestIdleCallback`, com alternativa para o Safari) | Navegação sem espera, como antes da divisão, mantendo o carregamento inicial menor | Feito |
| Seletores de empresa com mais de 100 empresas | Páginas seguintes buscadas em paralelo, uma vez, em cache compartilhado por todas as telas | Uma requisição a mais por centena de empresas, só quando existem | Feito |

Sem micro-otimizações e sem índice novo (que exigiria migração): as consultas novas filtram
pelas colunas de índices que já existiam — o índice único parcial
`notifications_unread_dedup_idx` na gravação em lote de notificações,
`(recipient_id, type, related_type, related_id)` no job de atrasados, `(company_id,
scheduled_at)` e `(company_id, production_status)` em conteúdo, `(company_id, due_date)` e
`(responsible_user_id, status)` em pendências.

---

## Melhorias de UX/UI

| Problema | Alteração | Motivo | Status |
|---|---|---|---|
| Comentários e respostas sem autor | Nome de quem escreveu (ou "Você") em comentários e respostas de acompanhamento | Numa conversa agência–cliente, "quem disse" é metade da informação | Feito |
| Pendência sem responsável visível | "Responsável" e "Aberta por" no detalhe; responsável na lista | Saber com quem está a bola | Feito |
| Acompanhamento sem as partes | "Aberto por", "Responsável", prazo e abertura no detalhe | Idem | Feito |
| Histórico de campanha sem autor | Quem alterou, em cada linha | O histórico existe para responsabilização (spec 09) | Feito |
| Sessões com a string crua do navegador | "Chrome · Windows" + IP (também nos dispositivos de push) | Identificar qual sessão encerrar | Feito |
| Empresas arquivadas misturadas no seletor | Ativas primeiro; arquivadas no fim com "(arquivada)" | Evitar operar por engano num cliente encerrado | Feito |
| Troca de senha sem ponto de entrada | Cartão "Senha" em Sessões; tela voluntária com título próprio, confirmação e "Voltar" | A especificação garante troca a qualquer momento | Feito |
| Permissões extras oferecidas a quem não pode usá-las | Só para gestores da agência, com nota explicativa aos demais perfis | Interruptores que não faziam nada confundiam o admin | Feito |
| Colaborador via "Campanhas" sempre vazio | Item de menu e contador ocultos para colaborador | Coerente com a permissão | Feito |
| Erros de carregamento sem "Tentar novamente" nas notificações | Erro de carga separado do de ação, com retry | Padrão já usado nas demais telas | Feito |
| "sessão(ões) encerrada(s)" fora da camada de textos | Plural correto em `strings.ts` | Convenção do projeto (texto só em `strings.ts`) | Feito |

---

## Melhorias de código/arquitetura

| Problema | Alteração | Benefício | Status |
|---|---|---|---|
| Três implementações de "início do dia" em UTC | `shared/business-day.ts`, único e testado | Uma definição de "hoje" para dashboard, calendário e pendências | Feito |
| Regra de visibilidade de campanha duplicada e divergente | `campaignVisibilityScope` + `campaignAudienceRoles` | Lista, detalhe, dashboard e notificações leem a mesma regra | Feito |
| Validação de responsável duplicada em `POST /topics` | Reuso de `assertResponsibleHasAccess` | Mesma regra e mesma mensagem em todos os módulos | Feito |
| Cópias locais de `formatDate`/`formatDateTime` em 5 telas | Helpers de `lib/dates.ts` | Um lugar para regras de data | Feito |
| `FilesPage` com o cartão de arquivo inline e erro duplicado (`createFolder.error ?? createFolder.error`) | `FileCard` extraído; busca e pastas reaproveitam o mesmo cartão | Menos repetição, menos chance de divergir | Feito |
| Import dinâmico ineficaz (aviso do build) no upload de marca | Import estático + tratamento de erro igual ao de `lib/api.ts` | Build sem avisos; erros de rede em pt-BR | Feito |
| Download implementado em uma tela só | `startDownload` compartilhado (arquivos, anexos, fila de exclusões) | Mesmo comportamento e mesma mensagem de erro | Feito |

---

## Pequenas melhorias de produto

| O que foi feito | Por quê | Impacto esperado |
|---|---|---|
| **Busca de arquivos por nome** em todas as pastas da empresa | A API já buscava e o texto do campo existia, mas a tela não oferecia | Achar "aquele arquivo" sem abrir pasta por pasta |
| **"Baixar para conferir"** na fila de exclusões | Aprovar exclusão sem ver o arquivo era decisão às cegas | Menos exclusões por engano |
| **Seletor de data** para duplicar conteúdo, com a mesma hora do original | O prompt de texto era hostil no celular | Replanejar posts recorrentes em dois toques |
| **Seletor de empresa no início** para quem tem várias | Freelancer ou grupo com várias marcas via só a primeira | Painel útil para todos os perfis |
| **Aviso ao sair com envio em andamento** (fechar/recarregar aba) | Um upload grande no 4G se perdia com um toque errado | Menos envios perdidos |
| **Troca de senha acessível** pela tela de sessões | Estava só por URL | Autonomia do usuário, menos pedidos ao admin |
| **Nomes em todo lugar** (comentários, respostas, pendências, histórico, exclusões) | Ids não dizem nada a ninguém | Conversas legíveis |
| **Dispositivos reconhecíveis** em sessões e push | Encerrar a sessão certa | Segurança na mão do usuário |

---

## Testes executados

Todos executados nesta máquina, no estado final do código, salvo indicação.

| Verificação | Comando | Resultado | Observação |
|---|---|---|---|
| Lint (api, web, e2e) | `npm run lint` | **PASS** | |
| Typecheck (api, web, e2e) | `npm run typecheck` | **PASS** | |
| Formatação | `npm run format:check` | **PASS** | `IMPROVEMENT_REVIEW.md` segue a convenção de `docs/` (prosa fora do Prettier) |
| Build (api, web) | `npm run build` | **PASS** | Pacote inicial 290 KB (92 KB gzip) |
| Unitários + integração (API, PostgreSQL e MinIO reais) | `npm run test --workspace=@agency-hub/api` | **PASS — 26 arquivos, 417 testes** | Linha de base: 24 arquivos, 385 testes. 32 testes novos, 2 arquivos novos |
| E2E completo, desktop (Chromium 1280 px) e celular (Pixel 5) | `npm run test:e2e` (banco descartável recriado, servidores próprios) | **117 PASS, 1 FAIL** | A falha foi o primeiro teste da execução estourando 30 s antes de digitar o e-mail: o trace mostra 10 s só para abrir a aba e 16 s na primeira compilação do Vite (máquina lenta no arranque). Nenhuma asserção falhou. Linha de base: 115 + 1 ignorado; 2 testes novos |
| E2E — reexecução do teste que falhou | `npm run test:e2e -- -g "an admin creates, edits, and archives a company"` | **PASS (2/2)** | 4,4 s no desktop, também como primeiro teste depois da subida dos servidores |
| E2E — rolagem lateral com nomes longos (teste reforçado) | `npm run test:e2e -- -g "no screen scrolls sideways"` | **PASS (2/2)** | Também passou dentro da execução completa |
| Revisão visual (desktop 1280 px e Pixel 5) | Roteiro Playwright local que fotografa 15 telas alteradas, revisadas uma a uma | **PASS** | Revelou os defeitos 37 e 38, corrigidos e fotografados de novo |
| Rolagem lateral em todas as telas | Detector local: todo elemento (ou texto) que passa da borda, em 19 rotas × 2 tamanhos, com os dados do E2E e com nomes/links sem ponto de quebra | **PASS** (0 ocorrências) | Revelou o defeito 39; antes da correção vazavam o início, as listas de pendências e campanhas, os detalhes, acompanhamentos e notificações |
| `Caddyfile` (cache do shell) combinado com a mudança de `main` feita durante a revisão (sites de outros projetos no mesmo Caddy) | `caddy validate` e `caddy adapt` na imagem `caddy:2-alpine`, a mesma do container web | **PASS** | As duas regras presentes na configuração final |
| E2E contra o site publicado | `npm run test:e2e:online` | **NOT RUN** | Precisa de um admin descartável no VPS; não rodado para não criar dados em produção. Rodar depois do deploy (runbook em `docs/deployment.md`) |
| Celular físico (push recebido, upload grande interrompido no 4G) | — | **NOT AVAILABLE** | Exige um aparelho; pendência já registrada desde o go-live |
| CI (GitHub Actions) | pull request | {{CI}} | |

### Fluxos principais cobertos

| Fluxo | Onde está provado |
|---|---|
| Login, logout, sessão expirada, troca de senha obrigatória e voluntária | `auth.spec.ts`, `auth.test.ts`, revisão visual (tela 11) |
| Permissões e isolamento entre empresas | `tenant-isolation.spec.ts` e `.test.ts`, `campaigns.test.ts` (colaborador sem campanhas), `administration.spec.ts` |
| Dashboard (contagens reais, filtros, "Hoje" no fuso certo) | `dashboard.spec.ts`, `dashboard.test.ts`, `business-day.test.ts` |
| CRUD (empresas, usuários, projetos, pastas, conteúdo, publicações, pendências, campanhas, acompanhamentos) | specs E2E de cada módulo + testes de integração |
| Uploads (simples, multipartes, pausa, retomada, cancelamento, recusa, limite de tamanho real) | `uploads.spec.ts`, `uploads.test.ts` |
| Navegação, filtros, busca (inclusive busca de arquivos nova) | `uploads.spec.ts` ("finds a file by name"), `ux-states.spec.ts` (paginação), specs de módulo |
| Notificações (in-app, deep-link, push, atrasados sem repetição) | `notifications.spec.ts`, `notifications.test.ts`, `push-dispatch.test.ts` |
| Estados vazios, de erro com "Tentar novamente", duplo envio, confirmação destrutiva | `ux-states.spec.ts` |
| Responsivo, desktop e celular | todo o E2E roda nos dois; `ux-states.spec.ts` verifica rolagem lateral nos dois, agora com nomes longos |

---

## Git

| Item | Valor |
|---|---|
| Branch | `improvement-review`, sobre `origin/main` (`9412fd0` — a mudança de deploy feita em `main` durante a revisão, integrada sem conflito) |
| Commit das mudanças | {{COMMIT}} — "Improvement review: fix what volume, time zones, races and phones exposed" |
| Arquivos | 88 alterados e 9 novos (8 de código e testes, mais este relatório); nenhuma migração |
| Deixados de fora de propósito | `.claude/` (configuração local dos servidores de validação), `e2e/.cache/` (roteiro de capturas e detector de rolagem lateral), `test-results/` — todos fora do git |
| Segredos | Diff e arquivos novos varridos (chaves privadas, tokens, URLs com senha, variáveis sensíveis): só dados sintéticos de teste; nenhum `.env`, log, dump ou build |
| Push | {{PUSH}} |
| Pull request | {{PR}} |
| CI | {{CI}} |
| Working tree | {{TREE}} |
| Merge em `main` | **Não feito**: publica em produção automaticamente e aguarda a sua confirmação |

---

## Pendências para produção

Esta revisão **não exige** migração, variável de ambiente nova nem ajuste manual no
servidor: o `Caddyfile` vai dentro da imagem web e o workflow de deploy já copia o
`docker-compose.prod.yml` atualizado. O que resta:

| O que | Por quê | Onde | Obrigatório? | Impacto se não for feito |
|---|---|---|---|---|
| Revisar o pull request e fazer o merge em `main` | O merge dispara o deploy automático em produção (`deploy.yml`); publicar ficou como decisão sua | GitHub, no PR desta revisão | **Obrigatório** para as correções chegarem ao site | Produção continua com os defeitos listados acima |
| Depois do deploy, conferir no site: contadores do início, o painel "Hoje" depois das 21h, um envio de arquivo, uma tela no celular | Primeira vez destas mudanças no ambiente real | Site publicado | Recomendado | Um problema específico do ambiente passaria despercebido |
| Rodar o E2E contra o site publicado (`npm run test:e2e:online`) com um admin descartável | Mesma verificação feita no go-live, agora com esta versão | VPS + máquina local, passo a passo em `docs/deployment.md` ("Running the online check again") | Opcional | Menos evidência automatizada do ambiente real |
| Definir `APP_TIMEZONE` | Só se a agência operar fora do horário de Brasília; o padrão já é `America/Sao_Paulo` | `.env` do VPS | Opcional | Nenhum para quem está no Brasil |
| Domínio real (registros DNS → `APP_DOMAIN` → novo deploy → `storage:configure --origin`) | Pendência anterior a esta revisão | DNS e VPS | Obrigatório para sair do endereço provisório | O site segue só em `2-25-72-199.sslip.io` |
| Um push recebido num celular real | Pendência anterior a esta revisão | Celular | Recomendado | Push não verificado de ponta a ponta |
| Um upload grande interrompido num celular real (tela bloqueada, troca de rede) | Pendência anterior a esta revisão | Celular com dados móveis | Recomendado | Comportamento em rede móvel real não verificado |

---

## Problemas não implementados

Deixados de fora de propósito — documentados para decisão futura.

| Item | Por que não agora | Impacto | Complexidade | Considerar? |
|---|---|---|---|---|
| Bloquear navegação **dentro do app** durante um upload | Exige trocar `BrowserRouter` por data router (`createBrowserRouter`) para usar `useBlocker`; hoje só fechar/recarregar a aba é avisado | Trocar de tela durante um envio ainda o cancela | Média (refatoração do roteamento) | Sim, se uploads grandes pelo celular forem frequentes |
| Índice único parcial para "uma solicitação de exclusão pendente por item" | Requer migração; a corrida só ocorre com dois pedidos simultâneos do mesmo item (o botão já impede duplo clique) | Pode existir uma segunda solicitação pendente idêntica | Baixa (migração aditiva) | Sim, numa próxima janela com migrações |
| Exclusão lógica de pastas | Mudança de schema; a correção atual já resolve os dois defeitos reais | Pasta excluída não é recuperável (os arquivos são) | Média | Opcional |
| Cliente/colaborador ver a descrição de um conteúdo no calendário | Decisão de produto (hoje veem título, data, tipo e situação) | Menos contexto para o cliente | Baixa | Perguntar ao produto |
| Admins como "responsáveis" nos seletores | A lista de membros exclui admins (não têm vínculo); o servidor aceitaria | Não dá para atribuir pendência a outro admin pela tela | Baixa | Perguntar ao produto |
| Senha do banco no argumento do `pg_dump` | Visível só dentro do container do worker; trocar por `PGPASSWORD` é simples mas toca o fluxo de backup já validado em produção | Baixo | Baixa | Sim, junto de outra mudança no backup |
| Vincular sessão ao dispositivo (user-agent) | Opcional na spec 10; risco de deslogar em atualização de navegador | Baixo | Média | Opcional |
| Serviço de relatório de erros no cliente | Fora do escopo da Fase 1 (hoje o erro vai ao console) | Erros de tela só aparecem se alguém relatar | Média | Sim, na Fase 2 |
| Campo "Observações" do conteúdo editável | Existe na API e é preservado, mas o diálogo não o expõe | Baixo | Baixa | Opcional |
| Erros de validação do servidor destacados campo a campo | A API devolve `details[]`; as telas mostram a mensagem geral | Médio em formulários longos | Média | Sim |
| Dica de tamanho mínimo da senha vinculada à configuração | Hoje "Pelo menos 10 caracteres" é fixo (o padrão de `PASSWORD_MIN_LENGTH`) | Só diverge se alguém mudar a configuração | Baixa | Opcional |
| Seletor de empresas com busca | O limite de 100 foi corrigido (todas as páginas são buscadas); com centenas de clientes, um campo com busca seria mais confortável que uma lista nativa longa | Baixo hoje | Média | Quando a carteira crescer |

---

## Estado final

- [x] Sistema analisado de ponta a ponta: API, web, banco e RLS, jobs, deploy, testes, documentação
- [x] 41 defeitos corrigidos (22 no backend, 19 no frontend), mais o cache do `index.html`
- [x] Performance: divisão por rota com pré-carregamento, notificações em lote, jobs sem trabalho repetido — sem índice novo e sem migração
- [x] UX/UI: clareza e consistência, sem redesign
- [x] 8 pequenas melhorias de produto, todas sobre funções que já existiam
- [x] Contratos da API preservados: as respostas só ganharam campos; o que mudou de comportamento são as correções da tabela (validação mais estrita, 409/422 no lugar de 500, colaborador sem campanhas)
- [x] Modelo de dados intacto: nenhuma migração
- [x] Nenhuma ação destrutiva: nada foi executado em produção; o único banco recriado foi o descartável do E2E (`agencyhub_e2e`), pelo script do próprio projeto
- [x] Testes: lint, typecheck, formatação, build, 417 unitários/integração, E2E 117/118 na execução completa e o restante aprovado na reexecução
- [x] Revisão visual e verificação de rolagem lateral em desktop e celular
- [x] Documentação atualizada: `docs/PROGRESS.md`, `docs/deployment.md` (`APP_TIMEZONE`), `.env.example`
- [x] Commit sem segredos, `.env`, logs, dumps ou builds
- [x] Branch enviado e pull request aberto; CI: {{CI}}
- [ ] Merge em `main`, que publica em produção — aguardando sua confirmação
