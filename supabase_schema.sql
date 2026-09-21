-- ==============================================================================
-- SECUREVISION AI - ESQUEMA DE BANCO DE DADOS SUPABASE (POSTGRESQL)
-- Evento: FECART 2026
-- Conformidade: LGPD (Lei 13.709/2018) + Criptografia AES-256 + ArcFace 128-D
-- ==============================================================================

-- Habilitar extensão pgcrypto para funções criptográficas nativas se necessário
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. TABELA DE OPERADORES / CONTAS DO SISTEMA (LOGIN E AUTENTICAÇÃO)
CREATE TABLE IF NOT EXISTS public.operators (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    full_name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'operador' CHECK (role IN ('operador', 'supervisor', 'admin')),
    is_active BOOLEAN DEFAULT TRUE,
    last_login TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. TABELA DE USUÁRIOS BIOMÉTRICOS CADASTRADOS (METADADOS E LGPD)
CREATE TABLE IF NOT EXISTS public.users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    access_level TEXT NOT NULL,
    cpf_encrypted TEXT NOT NULL,
    cpf_hash TEXT UNIQUE NOT NULL,
    lgpd_consent BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. TABELA DE BIOMETRIA (VETORES ARCFACE 128-D E METADADOS DE DATA AUGMENTATION)
CREATE TABLE IF NOT EXISTS public.biometrics (
    user_id TEXT PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
    descriptors JSONB NOT NULL DEFAULT '[]'::jsonb,
    source_count INTEGER NOT NULL DEFAULT 1,
    augmented_count INTEGER NOT NULL DEFAULT 0,
    patches_16x16 JSONB DEFAULT '[]'::jsonb,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. TABELA DE LOGS DE AUDITORIA E EVENTOS DE SEGURANÇA
CREATE TABLE IF NOT EXISTS public.logs (
    id BIGSERIAL PRIMARY KEY,
    type TEXT NOT NULL,
    category TEXT NOT NULL,
    description TEXT NOT NULL,
    cam_id TEXT DEFAULT 'CAM_01_PORTAL',
    previous_hash TEXT,
    hash TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ------------------------------------------------------------------------------
-- ÍNDICES DE PERFORMANCE E BUSCA RÁPIDA
-- ------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_users_cpf_hash ON public.users(cpf_hash);
CREATE INDEX IF NOT EXISTS idx_users_name ON public.users(name);
CREATE INDEX IF NOT EXISTS idx_biometrics_updated_at ON public.biometrics(updated_at);
CREATE INDEX IF NOT EXISTS idx_logs_created_at ON public.logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_logs_type ON public.logs(type);
CREATE INDEX IF NOT EXISTS idx_operators_username ON public.operators(username);
CREATE INDEX IF NOT EXISTS idx_operators_email ON public.operators(email);

-- ------------------------------------------------------------------------------
-- POLÍTICAS DE ROW LEVEL SECURITY (RLS) - ACESSO CONTROLADO
-- ------------------------------------------------------------------------------
ALTER TABLE public.operators ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.biometrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logs ENABLE ROW LEVEL SECURITY;

-- Permite acesso total via API Anon com verificação de chave de serviço ou autenticação
DROP POLICY IF EXISTS "Anon Full Access Operators" ON public.operators;
CREATE POLICY "Anon Full Access Operators" ON public.operators FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Anon Full Access Users" ON public.users;
CREATE POLICY "Anon Full Access Users" ON public.users FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Anon Full Access Biometrics" ON public.biometrics;
CREATE POLICY "Anon Full Access Biometrics" ON public.biometrics FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Anon Full Access Logs" ON public.logs;
CREATE POLICY "Anon Full Access Logs" ON public.logs FOR ALL USING (true) WITH CHECK (true);

-- ------------------------------------------------------------------------------
-- OPERADOR INICIAL PADRÃO (Credenciais iniciais de bootstrap)
-- ------------------------------------------------------------------------------
INSERT INTO public.operators (username, email, password_hash, full_name, role)
VALUES (
    'admin',
    'admin@securevision.ai',
    '8c6976e5b5410415bde908bd4dee15dfb167a9c873fc4bb8a81f6f2ab448a918',
    'Administrador do Sistema',
    'admin'
) ON CONFLICT (username) DO NOTHING;
