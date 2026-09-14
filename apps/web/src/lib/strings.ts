/**
 * Every piece of user-facing copy lives here (docs/sdd/12-ui-ux-guidelines.md).
 * Phase 1 ships a single locale, but keeping the text out of components means a
 * second locale would be a lookup change rather than a codebase-wide extraction.
 */
export const strings = {
  app: {
    name: 'Agency Hub',
    loading: 'Carregando…',
    retry: 'Tentar novamente',
    genericError: 'Não foi possível concluir a ação. Tente novamente.',
    networkError: 'Não foi possível falar com o servidor. Verifique sua conexão.',
    logout: 'Sair',
  },
  login: {
    title: 'Entrar',
    subtitle: 'Acesse com as credenciais fornecidas pela agência.',
    email: 'E-mail',
    password: 'Senha',
    submit: 'Entrar',
    submitting: 'Entrando…',
    noAccountHelp: 'Esqueceu a senha? Peça uma nova ao administrador da agência.',
  },
  changePassword: {
    title: 'Defina uma nova senha',
    forcedSubtitle: 'Sua senha atual é temporária. Escolha uma nova senha para continuar.',
    currentPassword: 'Senha atual',
    newPassword: 'Nova senha',
    confirmPassword: 'Confirme a nova senha',
    submit: 'Salvar nova senha',
    submitting: 'Salvando…',
    mismatch: 'As senhas não conferem.',
    success: 'Senha alterada com sucesso.',
  },
  home: {
    title: 'Início',
    welcome: (name: string) => `Olá, ${name}.`,
    roleLabel: 'Perfil',
    companiesLabel: 'Empresas com acesso',
    noCompanies: 'Nenhuma empresa vinculada ainda.',
    underConstruction:
      'Os módulos de projetos, arquivos, calendário e campanhas chegam nos próximos estágios.',
  },
  sessions: {
    title: 'Sessões ativas',
    current: 'Esta sessão',
    revoke: 'Encerrar',
    revoking: 'Encerrando…',
    revokeAll: 'Encerrar as outras sessões',
    empty: 'Nenhuma outra sessão ativa.',
    lastActive: 'Última atividade',
    confirmRevoke: 'Encerrar esta sessão? O dispositivo precisará entrar novamente.',
    confirmRevokeAll:
      'Encerrar todas as outras sessões? Os demais dispositivos precisarão entrar novamente.',
  },
  roles: {
    agency_admin: 'Administrador da agência',
    agency_manager: 'Gestor da agência',
    client_manager: 'Gestor do cliente',
    contributor: 'Colaborador',
  },
  /** Maps the API's stable English error codes to pt-BR copy (15-api-conventions.md). */
  errors: {
    validation_error: 'Verifique os campos destacados.',
    invalid_credentials: 'E-mail ou senha inválidos.',
    account_locked:
      'Conta temporariamente bloqueada por excesso de tentativas. Aguarde e tente novamente.',
    rate_limited: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.',
    invalid_current_password: 'A senha atual está incorreta.',
    weak_password: 'A nova senha é muito curta.',
    password_unchanged: 'A nova senha deve ser diferente da senha atual.',
    password_change_required: 'Defina uma nova senha antes de continuar.',
    unauthenticated: 'Sua sessão expirou. Entre novamente.',
    account_inactive: 'Esta conta não está ativa. Fale com o administrador.',
    forbidden: 'Você não tem permissão para esta ação.',
    not_found: 'Registro não encontrado.',
    internal_error: 'Erro interno. Tente novamente.',
    network_error: 'Não foi possível falar com o servidor. Verifique sua conexão.',
  } as Record<string, string>,
} as const;

export function roleLabel(role: string): string {
  return (strings.roles as Record<string, string>)[role] ?? role;
}
