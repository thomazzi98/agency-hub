# Requisitos do Sistema — Plataforma da Agência

## 1. Objetivo

Criar uma plataforma web **multiempresa**, mobile first e de baixo custo para centralizar a operação de uma agência de:

- Social media.
- Produção de conteúdo.
- Gestão de tráfego pago.
- Organização de arquivos.
- Comunicação com clientes e colaboradores.

A plataforma deve ser simples, rápida e preparada para atender vários clientes sem duplicar a aplicação.

---

## 2. Regras gerais

- Interface em **português do Brasil**.
- Código, variáveis, tabelas, funções e componentes em **inglês**.
- Mobile first, especialmente para uploads pelo celular.
- Priorizar simplicidade, clareza e performance.
- Evitar funcionalidades complexas no MVP.
- Não duplicar código por cliente.
- Validar todas as permissões no backend.
- Nunca permitir acesso entre empresas.
- Usar paginação, lazy loading e carregamento progressivo.
- Não carregar vídeos automaticamente.
- Não usar dados fictícios como se fossem reais.

---

## 3. Stack inicial

- Backend: Node.js + TypeScript.
- Banco: PostgreSQL na VPS.
- Arquivos: Cloudflare R2.
- Infraestrutura: Docker em uma VPS.
- Frontend: aplicação web responsiva.
- Uploads: navegador → R2 usando URLs pré-assinadas.
- Arquivos privados: acesso por URLs temporárias.
- Banco: armazenar metadados, nunca vídeos grandes.

A aplicação começará em um único ambiente, mas deverá estar preparada para crescer.

---

## 4. Multiempresa e permissões

Cada empresa terá seus próprios:

- Usuários.
- Projetos.
- Arquivos.
- Conteúdos.
- Calendários.
- Pendências.
- Comentários.
- Contas de anúncios.
- Campanhas.
- Notificações.

### Perfis

#### Administrador da agência

Acesso total a todas as empresas e configurações.

Pode:

- Criar e gerenciar empresas.
- Gerenciar usuários e permissões.
- Acessar todos os módulos.
- Visualizar dashboards gerais.
- Gerenciar campanhas e configurações.

#### Gestor da agência

Usuário interno com acesso às empresas atribuídas.

Pode:

- Gerenciar arquivos, conteúdos e calendários.
- Criar e resolver pendências.
- Adicionar comentários.
- Registrar publicações.
- Gerenciar campanhas autorizadas.

#### Cliente contratante

Acesso amplo somente à própria empresa.

Pode:

- Consultar dashboard.
- Visualizar calendário e produção.
- Visualizar e baixar arquivos autorizados.
- Enviar materiais.
- Responder pendências.
- Comentar.
- Visualizar campanhas permitidas.

#### Contribuidor

Usuário da empresa responsável por enviar materiais e colaborar.

Pode:

- Fazer upload.
- Visualizar arquivos autorizados da própria empresa.
- Baixar arquivos.
- Visualizar calendário permitido.
- Responder pendências.
- Comentar.
- Receber notificações.
- Excluir somente os arquivos que ele próprio enviou.

Nunca pode:

- Acessar outra empresa.
- Excluir arquivos de terceiros.
- Alterar configurações globais.
- Gerenciar campanhas sem permissão específica.

---

## 5. Empresas e usuários

### Empresa

Campos mínimos:

- Nome.
- Logo.
- Segmento.
- Responsável.
- E-mail.
- Telefone.
- Status: ativa ou arquivada.
- Observações.
- Data de criação.

### Usuário

Campos mínimos:

- Nome.
- E-mail.
- Perfil.
- Empresas vinculadas.
- Status.
- Último acesso.
- Preferências de notificação.
- Dispositivos autorizados para push.

---

## 6. Projetos e iniciativas

O sistema deve ser genérico. Um projeto pode representar:

- Imóvel.
- Produto.
- Serviço.
- Evento.
- Campanha.
- Projeto interno.
- Outra iniciativa.

Campos:

- Nome.
- Código ou referência.
- Empresa.
- Tipo.
- Descrição.
- Status.
- Datas opcionais.
- Observações.

Cada projeto terá:

- Arquivos.
- Conteúdos.
- Pendências.
- Comentários.
- Histórico.
- Publicações relacionadas.

---

## 7. Arquivos e uploads

Este é um dos módulos mais importantes.

### Funcionalidades

- Upload individual ou múltiplo.
- Suporte a vídeos, imagens, áudios e documentos.
- Upload direto para o Cloudflare R2.
- Barra de progresso.
- Validação de tipo e tamanho.
- Associação a empresa e projeto.
- Associação opcional a conteúdo ou pendência.
- Busca e filtros.
- Preview de imagens.
- Player de vídeo quando possível.
- Download por URL temporária.
- Arquivamento.
- Exclusão com controle de permissão.
- Registro de autor e data do upload.

### Metadados

- Nome original.
- Tipo MIME.
- Tamanho.
- Usuário responsável.
- Data e hora.
- Empresa.
- Projeto.
- Conteúdo ou pendência relacionada.
- Status.

### Status

- Recebido.
- Em análise.
- Em edição.
- Edição concluída.
- Aprovado.
- Arquivado.

### Regra de exclusão

- Contribuidor: pode excluir somente seus próprios arquivos.
- Gestor: conforme permissão configurada.
- Administrador: acesso completo.
- Toda exclusão deve ser validada no backend.

---

## 8. Calendário editorial

O calendário será o centro do planejamento.

### Visualizações

- Dia.
- Semana.
- Mês.
- Lista.
- Períodos futuros.
- Filtros por empresa, responsável e status.

Deve permitir planejar conteúdos para qualquer período futuro, inclusive vários meses.

### Campos do conteúdo

- Empresa.
- Projeto opcional.
- Título.
- Descrição.
- Tipo.
- Data e horário.
- Responsável.
- Arquivo relacionado.
- Status de produção.
- Prioridade.
- Observações.

### Tipos

- Vídeo.
- Imagem.
- Carrossel.
- Story.
- Reels.
- YouTube Short.
- Texto.
- Tipo personalizado.

### Status de produção

- Planejado.
- Aguardando material.
- Em produção.
- Em revisão.
- Aprovado.
- Concluído.
- Cancelado.
- Atrasado, quando aplicável.

### Recursos

- Criar e editar conteúdos.
- Alterar datas.
- Duplicar conteúdos.
- Duplicar cronogramas.
- Criar modelos.
- Identificar conteúdos de hoje.
- Identificar atrasados.
- Mostrar o que depende do cliente.

---

## 9. Controle de produção

Cada conteúdo deve permitir acompanhar:

1. Material recebido.
2. Edição iniciada.
3. Edição concluída.
4. Revisão solicitada.
5. Aprovação recebida.
6. Conteúdo preparado.
7. Publicação registrada.

A plataforma deve mostrar por empresa:

- Conteúdos planejados.
- Conteúdos em produção.
- Conteúdos concluídos.
- Conteúdos aguardando material.
- Conteúdos atrasados.
- Conteúdos aguardando aprovação.
- Publicações pendentes.

---

## 10. Publicações multirrede

Redes iniciais:

- Instagram.
- Facebook.
- TikTok.
- YouTube Shorts.

Um conteúdo poderá possuir uma publicação independente em cada rede.

### Dados por rede

- Rede social.
- Status.
- Data de publicação.
- Link.
- Responsável.
- Observações.
- Última atualização.

### Status

- Não planejado.
- Planejado.
- Agendado.
- Publicado.
- Não publicado.
- Falhou.
- Cancelado.

O sistema deve mostrar claramente quais redes já receberam o conteúdo e quais ainda estão pendentes.

No MVP, o registro será manual. Integrações e publicação automática ficam para uma fase posterior.

---

## 11. Pendências e solicitações

Permitir solicitar materiais, informações ou aprovações.

### Exemplos

- Enviar vídeo.
- Enviar fotos.
- Regravar áudio.
- Informar preço.
- Corrigir informação.
- Aprovar conteúdo.

### Campos

- Título.
- Descrição.
- Empresa.
- Projeto opcional.
- Responsável.
- Criador.
- Prazo.
- Prioridade.
- Status.
- Anexos.
- Histórico.

### Status

- Aberta.
- Aguardando cliente.
- Respondida.
- Em análise.
- Concluída.
- Cancelada.

O destinatário poderá responder, comentar e anexar arquivos. Arquivos enviados como resposta devem ficar vinculados à pendência.

---

## 12. Notas e comentários

Notas e comentários poderão existir em:

- Empresa.
- Projeto.
- Arquivo.
- Conteúdo.
- Pendência.

Funcionalidades:

- Criar comentário.
- Responder.
- Identificar autor e data.
- Anexar arquivo.
- Editar ou excluir conforme permissão.
- Transformar uma nota em pendência.
- Notificar usuários envolvidos.

### Diferença

- **Nota:** informação, observação ou comentário.
- **Pendência:** ação que precisa ser executada, com responsável e prazo opcional.

---

## 13. Notificações

Criar uma central interna com notificações lidas e não lidas.

### Eventos

- Novo upload.
- Novo comentário.
- Nova nota.
- Nova pendência.
- Resposta a pendência.
- Arquivo enviado.
- Alteração de status.
- Conteúdo atrasado.
- Aprovação solicitada.
- Alteração em projeto.
- Campanha com problema.
- Usuário mencionado.

### Destinatários

- Usuários específicos.
- Responsáveis por tarefas.
- Usuários envolvidos em um projeto.
- Usuários autorizados de uma empresa.
- Administradores da agência, quando necessário.

### Regras

- Nunca notificar usuários de outra empresa.
- Validar permissão de acesso ao recurso no backend.
- Evitar notificações duplicadas.
- Permitir marcar uma ou todas como lidas.
- Ao abrir uma notificação, direcionar ao recurso relacionado.
- Mostrar contador de não lidas.

### Dados

- Destinatário.
- Tipo.
- Título.
- Mensagem.
- Autor.
- Empresa.
- Projeto ou recurso.
- Data.
- Estado de leitura.

---

## 14. Push notifications

A arquitetura deve permitir push notifications sem reescrever a lógica de notificações.

Requisitos:

- Permissão explícita do usuário.
- Registro de dispositivos.
- Múltiplos dispositivos por usuário.
- Ativar ou desativar push.
- Preferências por tipo de evento.
- Envio para usuário, grupo ou projeto.
- Tratamento de tokens inválidos.
- Registro de falhas.
- Prevenção de duplicidade.
- Isolamento entre empresas.

A central interna deve ser implementada no MVP. Push poderá entrar na fase 2.

---

## 15. Dashboard da agência

Mostrar:

- Empresas ativas.
- Arquivos recentes.
- Conteúdos de hoje.
- Conteúdos atrasados.
- Conteúdos em produção.
- Pendências aguardando clientes.
- Pendências vencidas.
- Publicações pendentes.
- Campanhas com atenção.
- Últimas atividades.
- Notificações não lidas.

Filtros:

- Empresa.
- Responsável.
- Período.
- Prioridade.
- Status.

O dashboard deve responder: **“O que preciso fazer agora?”**

---

## 16. Dashboard da empresa

Mostrar somente dados da própria empresa:

- Conteúdos planejados.
- Produção atual.
- Próximos posts.
- Arquivos recentes.
- Pendências.
- Projetos ativos.
- Publicações.
- Campanhas autorizadas.
- Notificações.

A interface do cliente deve ser mais simples que a interface da agência.

---

## 17. Gestão de tráfego pago

No MVP, o módulo será manual e operacional.

### Contas de anúncios

- Plataforma.
- Nome.
- ID da conta.
- Empresa.
- Status.
- Observações.

Plataformas iniciais:

- Meta Ads.
- TikTok Ads.

### Campanhas

- Nome.
- Empresa.
- Conta.
- Plataforma.
- Objetivo.
- Status.
- Orçamento diário.
- Orçamento total.
- Gasto informado.
- Saldo informado.
- Última verificação.
- Última alteração.
- Responsável.
- Observações.

### Status

- Ativa.
- Pausada.
- Encerrada.
- Com problema.
- Aguardando aprovação.
- Precisa de atenção.

### Histórico

Registrar:

- Usuário.
- Data.
- Campo alterado.
- Valor anterior.
- Novo valor.
- Observação.

Valores de gasto e saldo devem ser identificados como manuais quando não houver integração oficial.

---

## 18. Busca e performance

Implementar:

- Busca por empresa, projeto, arquivo, conteúdo, pendência e campanha.
- Filtros por status, período, tipo, rede, responsável e prioridade.
- Paginação.
- Índices no PostgreSQL.
- Lazy loading.
- Carregamento progressivo.
- Upload sem armazenar arquivos grandes na memória.
- Estados de carregamento e estados vazios.
- Tratamento claro de erros.

---

## 19. Segurança e auditoria

Obrigatório:

- Isolamento por empresa.
- Autorização no backend.
- Controle de acesso por recurso.
- URLs temporárias para arquivos privados.
- Validação de uploads.
- Proteção de credenciais.
- Registro de auditoria.
- Validação de propriedade antes de excluir.
- Testes de permissões.
- Testes de acesso entre empresas.
- Nunca confiar no identificador de empresa enviado pelo frontend.

Registrar ações importantes:

- Login.
- Upload.
- Exclusão.
- Alteração de status.
- Criação de conteúdo.
- Alteração de calendário.
- Criação e conclusão de pendência.
- Comentários.
- Alterações de campanha.
- Alterações de permissão.
- Notificações.

---

## 20. Fases

### Fase 1 — MVP

- Autenticação.
- Empresas.
- Usuários e perfis.
- Multiempresa e isolamento.
- Projetos.
- Upload para R2.
- Arquivos e metadados.
- Regras de exclusão.
- Notas e comentários.
- Calendário.
- Conteúdos e produção.
- Publicações nas quatro redes.
- Pendências.
- Dashboard da agência.
- Dashboard da empresa.
- Notificações internas.

### Fase 2 — Evolução

- Push notifications.
- Preferências de notificações.
- Aprovação de conteúdos.
- Histórico avançado.
- Busca avançada.
- Modelos de calendário.
- Duplicação de cronogramas.
- E-mail.
- Relatórios.
- Melhorias de upload.
- Gestão operacional mais completa de campanhas.

### Fase 3 — Integrações

- Meta Ads.
- TikTok Ads.
- Métricas automáticas.
- Sincronização de campanhas.
- Agendamento e publicação automática.
- Relatórios automáticos.
- Alertas de desempenho.

---

## 21. Critérios de aceite do MVP

O MVP deverá permitir:

1. Criar empresas e usuários.
2. Definir perfis e permissões.
3. Impedir acesso entre empresas.
4. Enviar arquivos pelo celular.
5. Armazenar arquivos no R2.
6. Identificar autor e data de cada upload.
7. Organizar arquivos por projeto.
8. Impedir exclusão de arquivos de terceiros por contribuidores.
9. Criar comentários e pendências.
10. Notificar usuários autorizados.
11. Criar planejamentos futuros.
12. Visualizar o que está atrasado.
13. Acompanhar produção.
14. Registrar publicação por rede.
15. Visualizar a operação da agência e de cada cliente.

---

## 22. Processo de desenvolvimento

O desenvolvimento deve ser incremental.

Para cada etapa:

1. Explicar o objetivo.
2. Listar módulos e arquivos envolvidos.
3. Implementar somente o escopo definido.
4. Executar testes.
5. Executar lint e build.
6. Revisar segurança e isolamento.
7. Revisar experiência mobile.
8. Resumir o que foi feito.
9. Aguardar aprovação antes da próxima etapa.

Não implementar todo o sistema de uma só vez.


---


---

## 23. Tópicos, acompanhamentos e cobranças internas

A plataforma deve permitir que um administrador ou gestor registre um **tópico de acompanhamento** direcionado a um usuário específico, inclusive para cobrar uma explicação, solicitar uma ação ou registrar uma questão operacional.

Esse recurso não precisa ser chamado de “tarefa”. O objetivo é criar uma conversa organizada sobre algo que precisa de atenção.

### Exemplos

- “Por que o conteúdo de terça-feira ainda não foi publicado?”
- “Verificar o motivo de o vídeo do cliente Aurora estar atrasado.”
- “Precisamos entender o que falta para concluir esta campanha.”
- “Confirmar se o material enviado está pronto para edição.”

### Funcionamento

1. O administrador ou gestor cria um tópico.
2. Seleciona a empresa e, opcionalmente, o projeto, conteúdo, campanha ou pendência relacionada.
3. Define o usuário responsável por responder.
4. Escreve a pergunta, observação ou solicitação de explicação.
5. O usuário recebe uma notificação.
6. O usuário responde dentro do próprio tópico.
7. O criador pode continuar a conversa, pedir esclarecimentos ou marcar o tópico como resolvido.

### Campos

- Título.
- Mensagem inicial.
- Criador.
- Usuário responsável pela resposta.
- Empresa.
- Projeto ou recurso relacionado, quando aplicável.
- Prioridade.
- Prazo opcional.
- Status.
- Data de criação.
- Data da última atualização.
- Histórico de respostas.

### Status

- Aberto.
- Aguardando resposta.
- Em análise.
- Resolvido.
- Cancelado.

### Regras

- O tópico deve ser visível somente aos usuários autorizados da empresa relacionada.
- O destinatário deve conseguir responder pelo celular.
- O tópico deve aceitar respostas em sequência, formando uma conversa.
- O sistema deve registrar autor e data de cada resposta.
- O criador pode marcar o tópico como resolvido.
- Um tópico pode ser vinculado a um conteúdo, publicação, campanha, arquivo ou pendência.
- A criação e cada nova resposta podem gerar notificações para os participantes.
- Evitar notificações duplicadas para a mesma atualização.
- Esse recurso é diferente de uma pendência operacional:
  - **Tópico:** discussão, cobrança, explicação ou acompanhamento.
  - **Pendência:** ação concreta que precisa ser executada, normalmente com responsável e prazo.
- Um tópico pode gerar uma pendência quando ficar claro que existe uma ação a realizar.

### Visões necessárias

- Tópicos criados por mim.
- Tópicos aguardando minha resposta.
- Tópicos aguardando resposta de outra pessoa.
- Tópicos abertos.
- Tópicos resolvidos.
- Tópicos filtrados por empresa, usuário, prioridade e período.



---

## 24. Backup manual pelo painel administrativo

Além dos backups automáticos, o administrador deverá poder solicitar um backup manual do banco pelo próprio dashboard.

### Objetivo

Permitir que o administrador clique em um botão, gere uma cópia do PostgreSQL e baixe o arquivo diretamente para o próprio computador, sem precisar acessar a VPS por SSH.

### Funcionamento esperado

1. O administrador acessa a área administrativa.
2. Clica em **“Gerar backup do banco”**.
3. O sistema cria uma solicitação de backup em segundo plano.
4. O PostgreSQL gera um dump usando uma ferramenta apropriada, como `pg_dump`.
5. O arquivo é compactado e, preferencialmente, criptografado.
6. O sistema mostra o progresso ou o status:
   - Na fila.
   - Em processamento.
   - Concluído.
   - Falhou.
7. Quando estiver pronto, o administrador clica em **“Baixar backup”**.
8. O navegador baixa o arquivo diretamente para a máquina do administrador.
9. O link de download deve expirar depois de um período curto.
10. O sistema deve registrar quem solicitou o backup, quando e se a operação foi concluída.

### Requisitos técnicos

- O backup deve ser executado em segundo plano, sem manter uma requisição HTTP aberta por muito tempo.
- O sistema não deve carregar o dump inteiro na memória.
- O arquivo deve ser gerado em um local temporário e seguro.
- O download deve usar streaming ou uma URL temporária.
- O arquivo temporário deve ser removido automaticamente após o prazo de retenção.
- Somente administradores autorizados podem solicitar e baixar backups.
- O backend deve validar a permissão antes de gerar o arquivo e antes de liberar o download.
- O sistema deve limitar a quantidade de backups manuais simultâneos.
- O sistema deve informar claramente quando o backup estiver em processamento.
- Falhas devem gerar uma mensagem clara e um registro de erro.
- O nome do arquivo deve conter data e hora, por exemplo:
  `database-backup-2026-09-13-230000.dump`

### Segurança

- Não expor o backup por URL pública permanente.
- Usar links temporários e protegidos.
- Criptografar o arquivo quando ele contiver dados sensíveis.
- Não armazenar senhas ou chaves no arquivo de configuração do projeto.
- Não registrar dados do banco nos logs.
- Não permitir que usuários comuns solicitem ou baixem backups.
- Registrar todas as solicitações e downloads no histórico de auditoria.

### Impacto no sistema

Gerar um backup pode consumir CPU, memória, disco e I/O do PostgreSQL e da VPS.

Para reduzir o impacto:

- Executar backups fora dos horários de maior uso, quando possível.
- Limitar a quantidade de solicitações simultâneas.
- Usar compressão adequada.
- Não gerar vários backups iguais ao mesmo tempo.
- Monitorar espaço em disco.
- Mostrar o status ao administrador.
- Considerar uma fila de jobs para tarefas demoradas.
- Avaliar backup físico ou replicação no futuro, caso o volume de dados cresça.

### Limitação importante

O download manual pelo painel **não substitui os backups automáticos**.

O administrador pode esquecer de clicar no botão, perder o arquivo baixado ou ter o computador danificado. Portanto:

- Backups automáticos continuam obrigatórios.
- O download manual será uma camada adicional de proteção.
- O sistema deve manter pelo menos uma cópia independente da VPS.
- O administrador deve ser orientado a guardar os arquivos baixados em local seguro.
- O sistema pode oferecer um histórico dos backups manuais disponíveis.

### Opção recomendada para o MVP

Implementar:

- Botão “Gerar backup do banco”.
- Job em segundo plano.
- Status da operação.
- Download protegido e temporário.
- Expiração e remoção automática do arquivo.
- Auditoria.
- Limite de uma solicitação manual por vez.
- Backup automático diário como proteção principal.


## 25. Deploy automático e CI/CD

O projeto será hospedado em um repositório privado no **GitHub** e executado em uma **VPS**.

O objetivo é que, ao executar:

```bash
git push origin master
```

o sistema faça automaticamente o deploy da aplicação na VPS, sem exigir intervenção manual.

### Requisitos

- Configurar CI/CD usando GitHub Actions ou solução equivalente.
- Usar a branch `master` como branch de produção.
- Executar o pipeline automaticamente após cada `push` na `master`.
- Conectar à VPS por SSH usando secrets protegidos do GitHub.
- Nunca salvar senhas, chaves privadas ou tokens diretamente no código.
- Receber as informações da VPS por variáveis ou secrets:
  - Host ou IP.
  - Usuário SSH.
  - Chave privada SSH.
  - Porta SSH, se diferente da padrão.
  - Variáveis de ambiente da aplicação.
- Preparar a VPS para executar a aplicação com Docker e Docker Compose.
- Fazer build das imagens.
- Enviar ou atualizar a versão do projeto na VPS.
- Aplicar as migrações do banco de dados de forma segura.
- Reiniciar os serviços necessários.
- Garantir que a aplicação volte a funcionar após o deploy.
- Exibir logs claros de sucesso ou falha no pipeline.
- Não interromper o serviço desnecessariamente.
- Manter uma estratégia simples de rollback para a versão anterior.

### Fluxo esperado

1. Desenvolvedor altera o código localmente.
2. Desenvolvedor executa os testes, quando aplicável.
3. Desenvolvedor executa `git commit`.
4. Desenvolvedor executa `git push origin master`.
5. O GitHub Actions inicia o pipeline.
6. O pipeline instala dependências e executa validações.
7. O pipeline executa lint, testes e build.
8. Se tudo passar, o pipeline acessa a VPS por SSH.
9. A VPS atualiza o código ou recebe as novas imagens.
10. A aplicação é reconstruída e reiniciada com Docker Compose.
11. Migrações necessárias são executadas.
12. O pipeline realiza uma verificação básica de saúde.
13. O GitHub informa se o deploy foi concluído ou falhou.

### Comando manual de deploy

Além do deploy automático, criar um comando simples para executar o deploy manualmente quando necessário.

Exemplo:

```bash
npm run deploy
```

ou, caso seja mais adequado à arquitetura:

```bash
./scripts/deploy.sh
```

Esse comando deverá:

- Validar o estado básico do projeto.
- Executar o processo de build.
- Conectar à VPS.
- Atualizar os serviços.
- Exibir o resultado do deploy.
- Retornar código de erro quando houver falha.

O comando manual não deve substituir o CI/CD automático; ele será uma alternativa para manutenção, testes ou reprocessamento de um deploy.

### Regras de segurança do deploy

- Usar GitHub Secrets para credenciais.
- Preferir chave SSH exclusiva para deploy.
- Conceder à chave somente as permissões necessárias.
- Não expor secrets nos logs.
- Não executar comandos destrutivos automaticamente.
- Não apagar volumes ou dados do PostgreSQL durante deploy.
- Não executar `docker compose down -v` em produção.
- Fazer backup antes de migrações potencialmente destrutivas.
- Separar variáveis de ambiente de desenvolvimento e produção.
- Validar o ambiente de destino antes de executar comandos.
- Registrar logs do deploy.
- Documentar como reverter uma versão problemática.

### Arquivos esperados

A IA deverá criar e manter, conforme a arquitetura escolhida:

- `.github/workflows/deploy.yml`
- `Dockerfile`
- `docker-compose.yml`
- `.env.example`
- `scripts/deploy.sh`, se necessário.
- Documentação de configuração da VPS.
- Documentação dos secrets necessários no GitHub.
- Documentação de rollback.


## Princípio central

> A plataforma deve reduzir a desorganização da agência, não criar mais trabalho.


---

## 23. Banco de dados, Docker, backups e recuperação

### Recomendação

Usar **Docker e Docker Compose** para a aplicação e seus serviços.

O PostgreSQL também pode rodar em Docker, desde que os dados sejam armazenados fora do ciclo de vida do container, usando um volume persistente e uma estratégia de backup independente.

Docker facilita:

- Padronizar desenvolvimento e produção.
- Reproduzir o ambiente na VPS.
- Atualizar a aplicação com CI/CD.
- Isolar serviços.
- Fazer rollback da aplicação.
- Simplificar manutenção e reinstalação.

Docker, sozinho, **não é backup**. Remover um container não deve remover os dados, mas apagar o volume ou perder a VPS pode causar perda definitiva se não existirem cópias externas.

### Estrutura recomendada

- Aplicação e serviços executados com Docker Compose.
- PostgreSQL em um serviço separado.
- Volume persistente exclusivo para o PostgreSQL.
- Rede interna entre aplicação e banco.
- PostgreSQL não deve ficar exposto publicamente à internet.
- Banco acessível somente pela aplicação e, quando necessário, por acesso administrativo protegido.
- Nunca executar `docker compose down -v` em produção.
- Nunca apagar volumes do banco durante deploy.
- Separar os ambientes de desenvolvimento e produção.
- Manter as variáveis de ambiente fora do repositório.

### Estratégia mínima de proteção do banco

Implementar a regra **3-2-1**:

- Pelo menos 3 cópias dos dados.
- Em pelo menos 2 meios ou locais diferentes.
- Pelo menos 1 cópia fora da VPS.

Exemplo:

1. Banco PostgreSQL em execução na VPS.
2. Backup local temporário na VPS.
3. Backup externo em outro serviço ou servidor.

O backup externo não deve depender exclusivamente da mesma VPS. Se a VPS for perdida, comprometida ou apagada, a cópia externa deverá continuar disponível.

### Backups automáticos

Implementar um processo automático de backup do PostgreSQL.

#### Frequência recomendada para o MVP

- Backup lógico completo diário usando `pg_dump`.
- Backup mais frequente, se necessário, para dados críticos.
- Retenção de backups diários por pelo menos 14 dias.
- Retenção de backups semanais por pelo menos 8 semanas.
- Retenção de backups mensais por pelo menos 6 meses, conforme custo disponível.
- Compressão dos arquivos de backup.
- Criptografia dos backups.
- Upload automático para armazenamento externo.
- Registro de sucesso ou falha.
- Notificação ao administrador em caso de falha.
- Verificação periódica de espaço disponível.

O backup deve incluir, no mínimo:

- Dados das tabelas.
- Estrutura do banco.
- Índices.
- Constraints.
- Funções e configurações necessárias.
- Usuários e permissões necessárias para recuperação, quando aplicável.

### Armazenamento dos backups

O sistema deve permitir configurar um destino externo, por exemplo:

- Storage compatível com S3.
- Cloudflare R2, se adequado ao fluxo de backup.
- Outro servidor.
- Serviço de backup independente.

O destino deve usar:

- Credenciais separadas.
- Permissões mínimas.
- Criptografia.
- Retenção.
- Proteção contra exclusão acidental, quando disponível.
- Acesso restrito ao processo de backup.

Não guardar a única cópia do backup dentro da própria VPS.

### Teste de restauração

Um backup só deve ser considerado confiável depois de ser restaurado e validado.

Implementar um procedimento periódico para:

1. Criar um banco temporário.
2. Restaurar um backup.
3. Verificar se as tabelas existem.
4. Verificar se os dados principais estão acessíveis.
5. Executar testes básicos de integridade.
6. Registrar o resultado.
7. Apagar o ambiente temporário após a validação.

Executar esse teste pelo menos uma vez por mês e também após mudanças importantes na estratégia de backup.

### Recuperação e rollback

Documentar um procedimento para:

- Recuperar o banco em uma nova VPS.
- Restaurar o backup mais recente.
- Restaurar um backup específico.
- Recriar os containers.
- Reconfigurar variáveis de ambiente.
- Reconfigurar o domínio e o proxy.
- Validar a aplicação após a recuperação.

O rollback da aplicação não deve apagar ou recriar automaticamente o volume do PostgreSQL.

### Migrações do banco

- Usar ferramenta de migrations versionadas.
- Executar migrations no deploy de forma controlada.
- Fazer backup antes de migrations potencialmente destrutivas.
- Não executar comandos destrutivos automaticamente.
- Evitar remover colunas ou tabelas sem uma etapa explícita e revisada.
- Testar migrations em ambiente separado antes da produção.
- Registrar qual versão do schema está em produção.
- Ter plano de reversão para migrations arriscadas.

### Monitoramento

Monitorar automaticamente:

- Status do container do PostgreSQL.
- Espaço em disco da VPS.
- Espaço utilizado pelo volume do banco.
- Memória e CPU.
- Último backup concluído.
- Idade do backup mais recente.
- Resultado do último teste de restauração.
- Falhas de backup.
- Crescimento do banco.
- Erros de conexão.

Se o backup falhar ou ficar antigo além do limite configurado, o administrador deverá receber um alerta.

### Regra crítica para o CI/CD

O pipeline de deploy:

- Pode atualizar a aplicação.
- Pode atualizar imagens Docker.
- Pode reiniciar serviços.
- Pode executar migrations controladas.
- Não pode apagar volumes do banco.
- Não pode executar `docker compose down -v`.
- Não pode recriar o PostgreSQL com armazenamento vazio.
- Não pode apagar dados para “corrigir” uma falha de deploy.
- Deve interromper o deploy quando uma etapa crítica falhar.
- Deve executar uma verificação de saúde após a atualização.

### Resultado esperado

A infraestrutura deve ser projetada para que:

- A aplicação possa ser recriada sem perder o banco.
- Um container possa ser removido sem perder os dados.
- A VPS possa ser substituída usando backups externos.
- Um erro de deploy não apague dados.
- Um backup corrompido seja identificado por testes de restauração.
- O administrador seja avisado quando a proteção de dados falhar.

## Requisitos adicionais e decisões atualizadas

### Escopo por fase

- **Fase 1:** autenticação, empresas, usuários, roles, projetos/pastas, upload robusto, calendário, produção, publicações, pendências, notas/comentários, notificações internas, **push notifications**, dashboard, cadastro e acompanhamento manual de campanhas, backup manual pelo painel e personalização básica da identidade visual.
- **Fase 2:** e-mail, integrações com plataformas de anúncios, publicação automática, métricas avançadas, relatórios e demais integrações externas.

### Upload de arquivos — requisito crítico

- Suportar arquivos de até **30 GB por arquivo**.
- O limite máximo deve ser configurável pelo administrador.
- Permitir upload de vários arquivos simultaneamente.
- Exibir progresso individual e geral da fila.
- Funcionar bem em celulares e conexões instáveis.
- Usar upload direto para o Cloudflare R2, sem passar o arquivo inteiro pelo backend.
- Usar **multipart upload/chunks**, retomada, retentativas automáticas e controle de concorrência.
- Permitir pausar, retomar e cancelar uploads.
- Não carregar o arquivo inteiro na memória do navegador, backend ou VPS.
- Validar tamanho, tipo, extensão e permissões antes do upload.
- Registrar nome, tamanho, tipo, usuário, empresa, pasta/projeto, data/hora e status.
- Exibir estados claros: aguardando, enviando, processando, concluído, pausado, cancelado e falhou.
- Usar previews sob demanda e lazy loading; não carregar vídeos automaticamente.
- O backend deve emitir URLs temporárias e validar tenant, pasta e permissões em todas as operações.

### Pastas, arquivos e corretores/contribuidores

- Um corretor/contribuidor pode visualizar todas as pastas e arquivos da empresa da qual participa, conforme sua role.
- Pode adicionar conteúdo em qualquer pasta da própria empresa, mesmo que não tenha criado a pasta.
- Pode baixar e comentar arquivos aos quais tenha acesso.
- Não pode excluir diretamente arquivos de outros usuários.
- Pode solicitar a exclusão de um conteúdo/arquivo.
- A solicitação fica pendente para análise do administrador.
- O administrador pode aprovar ou rejeitar a solicitação.
- Solicitação, aprovação, rejeição e exclusão devem registrar autor, responsável, data, hora, motivo e histórico.
- Nenhum dado pode atravessar o limite da empresa/tenant.

### Campanhas — já na Fase 1

O módulo será apenas operacional/manual, sem integrações externas:

- Cadastro de campanha, plataforma, conta, empresa, objetivo, status, orçamento informado, período, responsável e observações.
- Registro de notas e atualizações manuais.
- Histórico de alterações com autor, data e hora.
- Status como ativa, pausada, encerrada ou com problema.
- Não buscar métricas, saldo, gastos ou status automaticamente na Fase 1.
- Integrações com Meta Ads, TikTok Ads e outras plataformas ficam para a Fase 2.

### Datas e histórico

Todas as entidades relevantes devem registrar, quando aplicável:

- criação e última atualização;
- upload e autor do upload;
- planejamento, produção, conclusão e aprovação;
- publicação;
- solicitação, resposta e alteração de status;
- autor, data e hora de cada alteração relevante.

A interface deve mostrar as datas de forma legível, com data/hora completa disponível no detalhe.

### Usuários, contas e roles

- O administrador deve criar contas pelo painel, definindo nome, usuário/e-mail, empresa(s), role, status e senha inicial.
- Deve poder alterar roles, vínculos, status e credenciais.
- Deve haver diferentes níveis de acesso configuráveis por role.
- O administrador deve poder gerar uma nova senha temporária para um usuário.
- **Senhas nunca devem ser armazenadas em texto puro nem ser recuperáveis.** O administrador deve redefinir ou gerar uma senha temporária, exibida somente no momento da geração, com troca obrigatória no primeiro acesso.
- O usuário deve poder alterar a própria senha.
- Recuperação segura por e-mail fica para a Fase 2; na Fase 1 deve existir redefinição administrativa segura.

### Sessão e login

- A sessão deve durar bastante para facilitar o uso.
- Configuração inicial sugerida: sessão renovável de até **7 dias**, com renovação por atividade.
- Permitir sair de todos os dispositivos e revogar sessões pelo painel administrativo.
- Aplicar proteção contra tentativas excessivas de login e roubo de sessão.
- Não manter sessão indefinidamente sem controles de segurança.

### Experiência, erros e carregamento

Todas as telas e operações devem ter:

- loading visível;
- estados vazios úteis;
- erros amigáveis e registrados;
- mensagens claras de sucesso e falha;
- prevenção de ações duplicadas;
- confirmação para ações destrutivas;
- opção de tentar novamente;
- preservação dos dados preenchidos quando possível.

A interface deve ser moderna, limpa, organizada, mobile-first, acessível, rápida e baseada em componentes reutilizáveis. Usar paginação, cache, lazy loading, consultas indexadas e carregamento sob demanda.

### Personalização pelo painel administrativo

O administrador deve poder configurar sem alterar código:

- logotipo;
- favicon;
- título/nome da aplicação;
- nome exibido no menu e na tela de login;
- cores principais;
- imagem ou texto de apresentação, se necessário.

Os arquivos de identidade visual devem ter limites de tamanho, formatos permitidos, otimização e cache.

### Backup no MVP

- O MVP terá somente **backup manual do banco pelo painel administrativo**.
- O administrador solicita o backup por um botão.
- A operação roda em segundo plano usando `pg_dump`, compactação e, se possível, criptografia.
- O painel mostra fila, processamento, concluído ou falhou.
- Quando pronto, o administrador baixa o arquivo por uma URL protegida e temporária.
- O download deve usar streaming e não bloquear a aplicação.
- Deve existir limite de uma solicitação simultânea, limpeza de arquivos temporários e auditoria.
- Backups automáticos ficam fora do escopo atual.

### Recomendação técnica para o upload

O upload deve ser projetado desde o início como **multipart/resumable upload direto no storage**. O backend cuida de autenticação, autorização, criação da sessão, URLs temporárias, confirmação e metadados; ele não recebe nem armazena o arquivo completo.

### Decisões técnicas obrigatórias para a implementação

#### 1. Senhas nunca devem ser armazenadas ou exibidas em texto puro

- O sistema não pode permitir que o administrador visualize a senha original de um usuário.
- As senhas devem ser armazenadas somente com hash seguro e salt.
- O administrador poderá gerar uma **senha temporária** ou redefinir a senha do usuário.
- A senha temporária deve ser exibida apenas uma vez após a geração.
- O usuário deverá ser obrigado a trocar a senha no primeiro acesso ou após uma redefinição administrativa.
- A redefinição de senha deve ser registrada na auditoria.
- A Fase 1 deve possuir redefinição administrativa segura mesmo sem envio de e-mail.

#### 2. Upload direto, resumível e multipart para arquivos grandes

- Arquivos de até **30 GB** devem ser enviados diretamente para o Cloudflare R2, sem passar integralmente pelo backend ou ficar armazenados na VPS.
- O fluxo deve utilizar **multipart upload, chunks e retomada**.
- O sistema deve permitir múltiplos uploads simultâneos, com limite configurável de concorrência.
- Deve haver barra de progresso individual e geral, pausa, retomada, cancelamento e retentativas automáticas.
- Uploads interrompidos devem poder continuar do ponto em que pararam, quando possível.
- O backend deve apenas autenticar, validar permissões, criar a sessão de upload, emitir URLs temporárias, confirmar a conclusão e registrar os metadados.
- O navegador, backend e VPS não podem carregar o arquivo completo em memória.
- O sistema deve tratar falhas de rede, partes inválidas, sessões expiradas, cancelamentos e uploads incompletos.
- Deve existir limpeza de uploads abandonados e partes temporárias.
- O limite de tamanho por arquivo deve ser configurável pelo administrador.
- A implementação deve priorizar estabilidade e recuperação de falhas, não apenas velocidade.

#### 3. Push notifications com controle de permissões e anti-spam

- Push notifications fazem parte da **Fase 1**.
- O sistema deve solicitar permissão de notificação de forma explícita e explicar ao usuário sua finalidade.
- Cada usuário deve poder ativar ou desativar notificações.
- O sistema deve registrar os dispositivos autorizados e permitir revogar um dispositivo.
- As notificações devem respeitar empresa, projeto, pasta, conteúdo, campanha e demais permissões do usuário.
- O usuário deve receber notificações somente de contextos aos quais tenha acesso.
- Eventos relevantes podem gerar push, como novo upload, nova pendência, resposta, comentário, aprovação solicitada ou alteração importante de status.
- O sistema deve evitar notificações repetidas para o mesmo evento.
- Deve haver deduplicação, agrupamento ou limitação de frequência quando necessário para evitar spam.
- Ao abrir a notificação, o sistema deve direcionar o usuário ao contexto correto e marcá-la como lida.
- O usuário deve poder configurar preferências básicas por tipo de evento.
- A arquitetura deve separar o serviço de notificações do restante da aplicação para permitir evolução futura.
- O push deve funcionar como complemento à central interna de notificações, não como substituto.

