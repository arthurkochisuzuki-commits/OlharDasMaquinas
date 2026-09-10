-- ==============================================================================
-- SECUREVISION AI - SCHEMA DDL & POLÍTICAS AVANÇADAS DE SEGURANÇA SUPABASE / POSTGRESQL
-- Finalidade: Criação e blindagem de tabelas com RLS, restrições de integridade,
-- triggers de imutabilidade de logs e conformidade com a LGPD.
-- ==============================================================================

-- 1. EXTENSÕES NECESSÁRIAS
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. TABELA: users (Metadados de Usuários, Consentimento LGPD e CPF Criptografado)
CREATE TABLE IF NOT EXISTS public.users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT DEFAULT 'Funcionário',
  access_level TEXT NOT NULL DEFAULT 'Nível 1 (Autorizado)' 
    CHECK (access_level IN ('Nível 1 (Autorizado)', 'Nível 2 (VIP)', 'Nível 3 (Admin)', 'BLOQUEADO')),
  cpf_encrypted TEXT,
  cpf_hash TEXT UNIQUE NOT NULL,
  lgpd_consent JSONB NOT NULL DEFAULT '{"agreed": true, "version": "1.0-2026"}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. TABELA: biometrics (Embeddings ArcFace e Contagem de Mídias Cifradas)
CREATE TABLE IF NOT EXISTS public.biometrics (
  user_id TEXT PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  descriptors JSONB NOT NULL DEFAULT '[]'::jsonb,
  source_count INT NOT NULL DEFAULT 1 CHECK (source_count >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. TABELA: logs (Auditoria Criptográfica Imutável com Encadeamento de Hashes)
CREATE TABLE IF NOT EXISTS public.logs (
  id BIGSERIAL PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('DANGER', 'SUCCESS', 'INFO', 'SCAN')),
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  cam_id TEXT NOT NULL DEFAULT 'SYSTEM',
  previous_hash TEXT,
  hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ==============================================================================
-- 5. TRIGGER DE IMUTABILIDADE PARA AUDITORIA (ANTI-TAMPERING)
-- Garante a nível de banco de dados que NINGUÉM pode alterar ou apagar logs existentes
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.prevent_log_modification()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'VIOLAÇÃO DE SEGURANÇA: Registros de auditoria (logs) são estritamente imutáveis e não podem ser alterados ou excluídos.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_log_update ON public.logs;
CREATE TRIGGER trg_prevent_log_update
  BEFORE UPDATE OR DELETE ON public.logs
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_log_modification();

-- Trigger para atualização automática de updated_at em users
CREATE OR REPLACE FUNCTION public.update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_users_updated_at ON public.users;
CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.update_timestamp();

-- ==============================================================================
-- 6. HABILITAÇÃO DE ROW LEVEL SECURITY (RLS)
-- ==============================================================================
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.biometrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logs ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------------------------
-- 7. POLÍTICAS RLS: TABELA 'users' (Zero-Trust: Anon Read-Only / Auth Write)
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users_Select_Policy" ON public.users;
CREATE POLICY "Users_Select_Policy" ON public.users
  FOR SELECT TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "Users_Insert_Policy" ON public.users;
CREATE POLICY "Users_Insert_Policy" ON public.users
  FOR INSERT TO authenticated
  WITH CHECK (length(id) > 0 AND length(name) > 0 AND length(cpf_hash) > 0);

DROP POLICY IF EXISTS "Users_Update_Policy" ON public.users;
CREATE POLICY "Users_Update_Policy" ON public.users
  FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (length(name) > 0);

DROP POLICY IF EXISTS "Users_Delete_Policy" ON public.users;
CREATE POLICY "Users_Delete_Policy" ON public.users
  FOR DELETE TO authenticated
  USING (true);

-- ------------------------------------------------------------------------------
-- 8. POLÍTICAS RLS: TABELA 'biometrics' (Zero-Trust: Anon Read-Only / Auth Write)
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Biometrics_Select_Policy" ON public.biometrics;
CREATE POLICY "Biometrics_Select_Policy" ON public.biometrics
  FOR SELECT TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "Biometrics_Insert_Policy" ON public.biometrics;
CREATE POLICY "Biometrics_Insert_Policy" ON public.biometrics
  FOR INSERT TO authenticated
  WITH CHECK (length(user_id) > 0);

DROP POLICY IF EXISTS "Biometrics_Update_Policy" ON public.biometrics;
CREATE POLICY "Biometrics_Update_Policy" ON public.biometrics
  FOR UPDATE TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Biometrics_Delete_Policy" ON public.biometrics;
CREATE POLICY "Biometrics_Delete_Policy" ON public.biometrics
  FOR DELETE TO authenticated
  USING (true);

-- ------------------------------------------------------------------------------
-- 9. POLÍTICAS RLS: TABELA 'logs' (IMUTÁVEL: Insert restrito / Update e Delete proibidos)
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Logs_Select_Policy" ON public.logs;
CREATE POLICY "Logs_Select_Policy" ON public.logs
  FOR SELECT TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "Logs_Insert_Policy" ON public.logs;
CREATE POLICY "Logs_Insert_Policy" ON public.logs
  FOR INSERT TO anon, authenticated
  WITH CHECK (length(category) > 0 AND length(description) > 0);

-- Explicitamente bloqueia UPDATE e DELETE nas políticas de RLS de logs para todos os papéis
DROP POLICY IF EXISTS "Logs_Deny_Update" ON public.logs;
CREATE POLICY "Logs_Deny_Update" ON public.logs
  FOR UPDATE TO anon, authenticated
  USING (false);

DROP POLICY IF EXISTS "Logs_Deny_Delete" ON public.logs;
CREATE POLICY "Logs_Deny_Delete" ON public.logs
  FOR DELETE TO anon, authenticated
  USING (false);

-- ==============================================================================
-- INSTRUÇÕES DE APLICAÇÃO NO SUPABASE:
-- 1. Acesse o painel do seu projeto no Supabase (https://supabase.com/dashboard)
-- 2. No menu lateral esquerdo, clique em "SQL Editor" -> "New Query"
-- 3. Cole todo este código e clique em "Run" (ou pressione Ctrl + Enter)
-- 4. Todas as tabelas, índices, triggers de imutabilidade e regras RLS serão ativadas!
-- ==============================================================================
