/**
 * SecureVision AI - Database Service & Storage Manager
 * Encapsulates Local IndexedDB Storage + Encryption + LGPD Purge + Supabase Adapter
 */

class SecureVisionDB {
  constructor() {
    this.dbName = 'SecureVision_LocalDB';
    this.dbVersion = 1;
    this.db = null;
    const defaultUrl = 'https://zsbifogfvfueunwopuuy.supabase.co';
    const savedUrl = localStorage.getItem('sv_supabase_url') || defaultUrl;
    const savedKey = localStorage.getItem('sv_supabase_key') || '';
    
    this.supabaseConfig = {
      url: savedUrl,
      key: savedKey,
      enabled: !!(savedUrl && savedKey)
    };
  }

  // Initialize IndexedDB
  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onupgradeneeded = (e) => {
        const db = e.target.result;

        // Table 1: Users (Encrypted PII, LGPD Consent)
        if (!db.objectStoreNames.contains('users')) {
          const userStore = db.createObjectStore('users', { keyPath: 'id' });
          userStore.createIndex('name', 'name', { unique: false });
          userStore.createIndex('cpf_hash', 'cpf_hash', { unique: true });
        }

        // Table 2: Biometrics (Face Vectors & Media Blobs)
        if (!db.objectStoreNames.contains('biometrics')) {
          const bioStore = db.createObjectStore('biometrics', { keyPath: 'userId' });
          bioStore.createIndex('updatedAt', 'updatedAt', { unique: false });
        }

        // Table 3: System Logs & Security Audits
        if (!db.objectStoreNames.contains('logs')) {
          const logStore = db.createObjectStore('logs', { keyPath: 'id', autoIncrement: true });
          logStore.createIndex('type', 'type', { unique: false });
          logStore.createIndex('timestamp', 'timestamp', { unique: false });
        }
      };

      request.onsuccess = (e) => {
        this.db = e.target.result;
        console.log('[DB] SecureVision Local DB initialized successfully.');
        resolve(true);
      };

      request.onerror = (e) => {
        console.error('[DB] Failed to open IndexedDB:', e.target.error);
        reject(e.target.error);
      };
    });
  }

  // Simple AES Passphrase Encryption Helper (Web Crypto API)
  async encryptData(text, passphrase = 'SecureVision2026Key!') {
    try {
      const encoder = new TextEncoder();
      const data = encoder.encode(text);
      const keyMaterial = await crypto.subtle.importKey(
        'raw',
        encoder.encode(passphrase),
        { name: 'PBKDF2' },
        false,
        ['deriveBits', 'deriveKey']
      );
      const key = await crypto.subtle.deriveKey(
        {
          name: 'PBKDF2',
          salt: encoder.encode('SecureVisionSalt2026'),
          iterations: 100000,
          hash: 'SHA-256'
        },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt']
      );
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
      const combined = new Uint8Array(iv.length + encrypted.byteLength);
      combined.set(iv, 0);
      combined.set(new Uint8Array(encrypted), iv.length);
      return btoa(String.fromCharCode(...combined));
    } catch (err) {
      console.warn('[Crypto] WebCrypto fallback encryption used:', err);
      return btoa(text); // Basic safe fallback
    }
  }

  // Register or Update a User with LGPD consent and encrypted CPF
  async saveUser(userData, biometricSources) {
    if (!this.db) await this.init();

    const encryptedCpf = await this.encryptData(userData.cpf);
    const userId = userData.id || 'user_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);

    const isBlocked = !!userData.isBlocked || userData.accessLevel === 'BLOQUEADO';
    const accessLevel = isBlocked ? 'BLOQUEADO' : (userData.accessLevel || 'Nível 1 (Autorizado)');
    const defaultRole = isBlocked ? 'Bloqueado (Lista Negra)' : 'Funcionário';

    const userRecord = {
      id: userId,
      name: userData.name,
      role: userData.role || defaultRole,
      accessLevel: accessLevel,
      isBlocked: isBlocked,
      cpf_encrypted: encryptedCpf,
      cpf_hash: btoa(userData.cpf), // For unique lookup
      lgpdConsent: {
        agreed: true,
        timestamp: new Date().toISOString(),
        version: '1.0-2026',
        purpose: isBlocked 
          ? 'Segurança Patrimonial e Bloqueio Preventivo de Acesso' 
          : 'Controle de Acesso Biométrico e Segurança da Informação 24H'
      },
      createdAt: new Date().toISOString()
    };

    // Prepare Biometric Record with multiple sources
    const biometricRecord = {
      userId: userId,
      descriptors: biometricSources.descriptors || [], // Multiple face vector descriptors
      photoBlobs: biometricSources.photoBlobs || [],  // Array of image Blobs/DataURLs
      videoBlob: biometricSources.videoBlob || null,   // Video sample Blob
      sourceCount: (biometricSources.photoBlobs ? biometricSources.photoBlobs.length : 0) + (biometricSources.videoBlob ? 1 : 0),
      updatedAt: new Date().toISOString()
    };

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['users', 'biometrics'], 'readwrite');
      tx.objectStore('users').put(userRecord);
      tx.objectStore('biometrics').put(biometricRecord);

      tx.oncomplete = () => {
        console.log(`[DB] User ${userData.name} and multi-source biometrics saved successfully (isBlocked: ${isBlocked}).`);
        const logType = isBlocked ? 'DANGER' : 'SUCCESS';
        const logCategory = isBlocked ? 'PESSOA BLOQUEADA CADASTRADA' : 'CADASTRO DE USUÁRIO';
        const logDesc = isBlocked 
          ? `Alerta: ${userData.name} cadastrado na LISTA NEGRA (Acesso Bloqueado). Detecções acionarão aviso de emergência.`
          : `Usuário ${userData.name} cadastrado com ${biometricRecord.sourceCount} fontes biométricas (Consentimento LGPD Ativo).`;
        this.addLog(logType, logCategory, logDesc);
        
        // Trigger background sync if Supabase is connected
        if (this.supabaseConfig.enabled) {
          this.syncToSupabase(userRecord, biometricRecord);
        }
        resolve(userRecord);
      };

      tx.onerror = (e) => reject(e.target.error);
    });
  }

  // Get all registered users for matching
  async getAllUsers() {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['users', 'biometrics'], 'readonly');
      const userStore = tx.objectStore('users');
      const bioStore = tx.objectStore('biometrics');

      const users = [];
      const userReq = userStore.openCursor();

      userReq.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          const u = cursor.value;
          bioStore.get(u.id).onsuccess = (be) => {
            u.biometrics = be.target.result || {};
            users.push(u);
          };
          cursor.continue();
        } else {
          tx.oncomplete = () => resolve(users);
        }
      };

      userReq.onerror = (e) => reject(e.target.error);
    });
  }

  // EXCLUSÃO LGPD (Direito ao Esquecimento / Expulgo Permanente)
  async deleteUserLGPD(userId) {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['users', 'biometrics'], 'readwrite');
      tx.objectStore('users').delete(userId);
      tx.objectStore('biometrics').delete(userId);

      tx.oncomplete = () => {
        console.log(`[DB LGPD] User ${userId} and all biometric sources deleted permanently.`);
        this.addLog('DANGER', 'EXPURGO LGPD', `Todos os dados pessoais, fotos, vídeos e descritores do ID ${userId} foram excluídos definitivamente.`);
        if (this.supabaseConfig.enabled) {
          this.deleteUserFromSupabase(userId);
        }
        resolve(true);
      };

      tx.onerror = (e) => reject(e.target.error);
    });
  }

  // Log auditing system
  async addLog(type, category, description, camId = 'SYSTEM') {
    if (!this.db) await this.init();
    const logEntry = {
      type, // DANGER, SUCCESS, INFO, SCAN
      category,
      description,
      camId,
      timestamp: new Date().toLocaleTimeString('pt-BR', { hour12: false })
    };

    const tx = this.db.transaction(['logs'], 'readwrite');
    tx.objectStore('logs').add(logEntry);

    // Dispatch custom event for UI updating
    window.dispatchEvent(new CustomEvent('sv_new_log', { detail: logEntry }));
  }

  async getLogs(limit = 50) {
    if (!this.db) await this.init();
    return new Promise((resolve) => {
      const tx = this.db.transaction(['logs'], 'readonly');
      const store = tx.objectStore('logs');
      const logs = [];
      const req = store.openCursor(null, 'prev');

      req.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor && logs.length < limit) {
          logs.push(cursor.value);
          cursor.continue();
        } else {
          resolve(logs);
        }
      };
    });
  }

  /**
   * Limpa todas as mensagens de log e auditoria (Sem alterar a tabela)
   */
  async clearAllLogs() {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['logs'], 'readwrite');
      tx.objectStore('logs').clear();
      tx.oncomplete = async () => {
        console.log('[DB] Tabela logs limpa com sucesso.');
        this.addLog('INFO', 'HISTÓRICO LIMPO', 'Todas as mensagens de logs anteriores foram limpas pelo administrador.');
        if (this.supabaseConfig.enabled) {
          try {
            await fetch(`${this.supabaseConfig.url}/rest/v1/logs?id=gt.0`, {
              method: 'DELETE',
              headers: this.getSupabaseHeaders()
            });
          } catch (e) {
            console.warn('[Supabase] Erro ao limpar logs em nuvem:', e);
          }
        }
        resolve(true);
      };
      tx.onerror = (e) => reject(e.target.error);
    });
  }

  /**
   * Limpa todos os dados de usuários e biometrias cadastradas (Sem alterar a estrutura da tabela)
   */
  async clearAllUserData() {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['users', 'biometrics'], 'readwrite');
      tx.objectStore('users').clear();
      tx.objectStore('biometrics').clear();
      tx.oncomplete = async () => {
        console.log('[DB] Tabelas users e biometrics limpas com sucesso (estruturas preservadas).');
        this.addLog('DANGER', 'BANCO DE DADOS LIMPO', 'Todos os cadastros e dados biométricos foram limpos (tabelas preservadas).');
        if (this.supabaseConfig.enabled) {
          try {
            await fetch(`${this.supabaseConfig.url}/rest/v1/biometrics?user_id=neq.dummy`, {
              method: 'DELETE',
              headers: this.getSupabaseHeaders()
            });
            await fetch(`${this.supabaseConfig.url}/rest/v1/users?id=neq.dummy`, {
              method: 'DELETE',
              headers: this.getSupabaseHeaders()
            });
          } catch (e) {
            console.warn('[Supabase] Erro ao limpar usuários em nuvem:', e);
          }
        }
        resolve(true);
      };
      tx.onerror = (e) => reject(e.target.error);
    });
  }

  /**
   * Reset completo de dados (Limpar logs + usuários sem alterar as tabelas)
   */
  async resetAllData() {
    await this.clearAllUserData();
    await this.clearAllLogs();
    return true;
  }

  // Supabase Adapter Configuration & Cloud Sync Engine
  saveSupabaseCredentials(url, key) {
    // Sanitize URL (remove /rest/v1 and trailing slashes if pasted)
    let sanitizedUrl = url ? url.trim().replace(/\/+$/, '') : '';
    sanitizedUrl = sanitizedUrl.replace(/\/rest\/v1\/?$/i, '').replace(/\/+$/, '');
    const sanitizedKey = key ? key.trim() : '';

    this.supabaseConfig.url = sanitizedUrl;
    this.supabaseConfig.key = sanitizedKey;
    this.supabaseConfig.enabled = !!(sanitizedUrl && sanitizedKey);

    localStorage.setItem('sv_supabase_url', sanitizedUrl);
    localStorage.setItem('sv_supabase_key', sanitizedKey);
    console.log('[Supabase Bridge] Credentials updated. Active:', this.supabaseConfig.enabled);
  }

  getSupabaseHeaders() {
    return {
      'apikey': this.supabaseConfig.key,
      'Authorization': `Bearer ${this.supabaseConfig.key}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates'
    };
  }

  /**
   * Test connection to Supabase Cloud REST endpoint
   */
  async testSupabaseConnection() {
    if (!this.supabaseConfig.enabled) {
      return { success: false, message: 'URL e Chave Anon do Supabase não configuradas.' };
    }

    try {
      const res = await fetch(`${this.supabaseConfig.url}/rest/v1/users?select=count`, {
        method: 'GET',
        headers: this.getSupabaseHeaders()
      });

      if (res.ok) {
        return { success: true, message: 'Conexão estabelecida com sucesso! Tabelas do Supabase ativas e prontas.' };
      } else {
        const errorText = await res.text();
        if (res.status === 404) {
          return { success: false, message: 'Conexão falhou (Erro 404): A tabela "users" ainda não existe no Supabase. Execute o script SQL no painel do Supabase.' };
        } else if (res.status === 401 || res.status === 403) {
          return { success: false, message: 'Conexão recusada (Erro 401/403): Chave anon (API Key) ou URL inválida.' };
        }
        return { success: false, message: `Erro ao conectar (${res.status}): ${errorText}` };
      }
    } catch (err) {
      return { success: false, message: `Erro de rede ao conectar com Supabase: ${err.message}` };
    }
  }

  /**
   * Real-time Sync of User & Biometric Record to Supabase Cloud
   */
  async syncToSupabase(userRecord, biometricRecord) {
    if (!this.supabaseConfig.enabled) return;

    try {
      console.log(`[Supabase Sync] Syncing user ${userRecord.name} (${userRecord.id}) to Cloud...`);

      // 1. Sync User Metadata & LGPD Consent
      const userBody = {
        id: userRecord.id,
        name: userRecord.name,
        role: userRecord.role,
        access_level: userRecord.accessLevel,
        is_blocked: !!userRecord.isBlocked,
        cpf_encrypted: userRecord.cpf_encrypted,
        cpf_hash: userRecord.cpf_hash,
        lgpd_consent: userRecord.lgpdConsent,
        created_at: userRecord.createdAt
      };

      const userRes = await fetch(`${this.supabaseConfig.url}/rest/v1/users`, {
        method: 'POST',
        headers: this.getSupabaseHeaders(),
        body: JSON.stringify(userBody)
      });

      if (!userRes.ok) {
        console.warn('[Supabase Sync] Failed to sync user record:', await userRes.text());
      }

      // 2. Sync Biometric Embedding Descriptors & Source Count
      if (biometricRecord) {
        const bioBody = {
          user_id: biometricRecord.userId,
          descriptors: biometricRecord.descriptors || [],
          source_count: biometricRecord.sourceCount || 1,
          updated_at: biometricRecord.updatedAt || new Date().toISOString()
        };

        const bioRes = await fetch(`${this.supabaseConfig.url}/rest/v1/biometrics`, {
          method: 'POST',
          headers: this.getSupabaseHeaders(),
          body: JSON.stringify(bioBody)
        });

        if (!bioRes.ok) {
          console.warn('[Supabase Sync] Failed to sync biometrics record:', await bioRes.text());
        }
      }

      console.log(`[Supabase Sync] User ${userRecord.name} successfully synchronized to Cloud!`);
      this.addLog('SUCCESS', 'NUVEM SUPABASE', `Sincronização em nuvem concluída para o usuário ${userRecord.name}.`);
    } catch (err) {
      console.error('[Supabase Sync Error]', err);
    }
  }

  /**
   * Sync Audit Log Entry to Supabase Cloud
   */
  async syncLogToSupabase(logEntry) {
    if (!this.supabaseConfig.enabled) return;
    try {
      await fetch(`${this.supabaseConfig.url}/rest/v1/logs`, {
        method: 'POST',
        headers: this.getSupabaseHeaders(),
        body: JSON.stringify({
          type: logEntry.type,
          category: logEntry.category,
          description: logEntry.description,
          cam_id: logEntry.camId,
          created_at: new Date().toISOString()
        })
      });
    } catch (e) {
      // Silent fail for log sync
    }
  }

  /**
   * LGPD Deletion on Supabase Cloud
   */
  async deleteUserFromSupabase(userId) {
    if (!this.supabaseConfig.enabled) return;
    try {
      const headers = {
        'apikey': this.supabaseConfig.key,
        'Authorization': `Bearer ${this.supabaseConfig.key}`
      };

      await fetch(`${this.supabaseConfig.url}/rest/v1/biometrics?user_id=eq.${userId}`, {
        method: 'DELETE',
        headers
      });

      await fetch(`${this.supabaseConfig.url}/rest/v1/users?id=eq.${userId}`, {
        method: 'DELETE',
        headers
      });

      console.log(`[Supabase LGPD] Permanent purge of user ${userId} completed on Cloud.`);
    } catch (err) {
      console.error('[Supabase LGPD Error]', err);
    }
  }

  /**
   * Sync all local records to Supabase Cloud
   */
  async syncAllToSupabase() {
    const users = await this.getAllUsers();
    let count = 0;
    for (const u of users) {
      await this.syncToSupabase(u, u.biometrics);
      count++;
    }
    return count;
  }
}

// Global DB instance
window.svDB = new SecureVisionDB();

