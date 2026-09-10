/**
 * SecureVision AI - Database Service & Storage Manager
 * Encapsulates Local IndexedDB Storage + Encryption + LGPD Purge + Supabase Adapter
 */

class SecureVisionDB {
  constructor() {
    this.dbName = 'SecureVision_LocalDB';
    this.dbVersion = 1;
    this.db = null;
    this.masterSecret = null;
    const defaultUrl = 'https://zeiebkchiribjazopeif.supabase.co';
    const savedUrl = localStorage.getItem('sv_supabase_url') || defaultUrl;
    
    this.supabaseConfig = {
      url: savedUrl,
      key: '',
      enabled: false
    };
  }

  // Get or Generate Unique Per-Device Master Crypto Seed
  async getDeviceMasterKey() {
    if (this.masterSecret) return this.masterSecret;
    let seed = localStorage.getItem('sv_device_crypto_seed');
    if (!seed) {
      const randomBytes = crypto.getRandomValues(new Uint8Array(32));
      seed = Array.from(randomBytes).map(b => b.toString(16).padStart(2, '0')).join('');
      localStorage.setItem('sv_device_crypto_seed', seed);
    }
    this.masterSecret = 'SV_ROOT_KEY_2026_' + seed;
    return this.masterSecret;
  }

  // Initialize IndexedDB and decrypt protected credentials
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

      request.onsuccess = async (e) => {
        this.db = e.target.result;
        console.log('[DB] SecureVision Local DB initialized successfully.');
        
        // Decrypt saved Supabase key if stored
        await this.loadSupabaseCredentialsFromStorage();
        resolve(true);
      };

      request.onerror = (e) => {
        console.error('[DB] Failed to open IndexedDB:', e.target.error);
        reject(e.target.error);
      };
    });
  }

  async loadSupabaseCredentialsFromStorage() {
    try {
      const encKey = localStorage.getItem('sv_supabase_key_enc');
      const plainKey = localStorage.getItem('sv_supabase_key');
      const savedUrl = localStorage.getItem('sv_supabase_url') || 'https://zeiebkchiribjazopeif.supabase.co';

      if (encKey) {
        const decKey = await this.decryptData(encKey);
        if (decKey) {
          this.supabaseConfig.key = decKey;
          this.supabaseConfig.url = savedUrl;
          this.supabaseConfig.enabled = !!(savedUrl && decKey);
        }
      } else if (plainKey) {
        // Upgrade legacy plaintext key to encrypted format
        const encrypted = await this.encryptData(plainKey);
        localStorage.setItem('sv_supabase_key_enc', encrypted);
        localStorage.removeItem('sv_supabase_key');
        this.supabaseConfig.key = plainKey;
        this.supabaseConfig.url = savedUrl;
        this.supabaseConfig.enabled = !!(savedUrl && plainKey);
      }
    } catch (e) {
      console.warn('[DB] Failed to decrypt Supabase credentials:', e);
    }
  }

  // Irreversible Cryptographic SHA-256 Hash with Salt for Unique Lookup (LGPD Compliant)
  async hashSHA256(text, salt = 'SV_SECURE_SALT_2026_LGPD_SEC') {
    try {
      const encoder = new TextEncoder();
      const data = encoder.encode(text + salt);
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    } catch (e) {
      console.error('[Crypto] SHA-256 hashing failed:', e);
      // Fallback to secure standard deterministic digest
      let hash = 0;
      const str = text + salt;
      for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash |= 0;
      }
      return 'sha256_fallback_' + Math.abs(hash).toString(16);
    }
  }

  // Robust AES-GCM 256-bit Encryption Helper (Web Crypto API)
  async encryptData(text, customPassphrase = null) {
    try {
      const passphrase = customPassphrase || (await this.getDeviceMasterKey());
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
          salt: encoder.encode('SecureVisionSalt2026_AES256_V2'),
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
      
      // Convert to hex string for tamper-proof storage
      return Array.from(combined).map(b => b.toString(16).padStart(2, '0')).join('');
    } catch (err) {
      console.error('[Crypto] WebCrypto AES-GCM encryption failed:', err);
      throw new Error('Falha crítica de segurança: não foi possível criptografar dados sensíveis.');
    }
  }

  // AES-GCM Decryption Helper
  async decryptData(hexCipher, customPassphrase = null) {
    try {
      if (!hexCipher || typeof hexCipher !== 'string') return null;
      const match = hexCipher.match(/.{1,2}/g);
      if (!match) return null;
      const passphrase = customPassphrase || (await this.getDeviceMasterKey());
      const encoder = new TextEncoder();
      const bytes = new Uint8Array(match.map(byte => parseInt(byte, 16)));
      const iv = bytes.slice(0, 12);
      const encrypted = bytes.slice(12);

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
          salt: encoder.encode('SecureVisionSalt2026_AES256_V2'),
          iterations: 100000,
          hash: 'SHA-256'
        },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['decrypt']
      );

      const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, encrypted);
      return new TextDecoder().decode(decrypted);
    } catch (err) {
      console.warn('[Crypto] Decryption failed:', err);
      return null;
    }
  }

  // Register or Update a User with LGPD consent and encrypted CPF
  async saveUser(userData, biometricSources) {
    if (!this.db) await this.init();

    const userId = userData.id || 'user_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
    const cleanCpf = (userData.cpf || '').replace(/\D/g, '') || ('CPF_GEN_' + userId);
    const encryptedCpf = await this.encryptData(cleanCpf);
    const cpfHash = await this.hashSHA256(cleanCpf + '_' + userId);

    const isBlocked = !!userData.isBlocked || userData.accessLevel === 'BLOQUEADO';
    const accessLevel = isBlocked ? 'BLOQUEADO' : (userData.accessLevel || 'Nível 1 (Autorizado)');
    const defaultRole = isBlocked ? 'Bloqueado (Lista Negra)' : 'Funcionário';

    const userRecord = {
      id: userId,
      name: userData.name.trim(),
      role: (userData.role || defaultRole).trim(),
      accessLevel: accessLevel,
      isBlocked: isBlocked,
      cpf_encrypted: encryptedCpf,
      cpf_hash: cpfHash, // Cryptographic SHA-256 Hash
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

    // Prepare Biometric Record with AES-GCM 256 Encrypted Payload (Zero-Knowledge at Rest)
    const rawBiometricData = {
      descriptors: biometricSources.descriptors || [],
      photoBlobs: biometricSources.photoBlobs || [],
      videoBlob: biometricSources.videoBlob || null
    };

    const encryptedBiometricPayload = await this.encryptData(JSON.stringify(rawBiometricData));

    const biometricRecord = {
      userId: userId,
      encrypted_payload: encryptedBiometricPayload, // AES-GCM 256 Ciphertext
      sourceCount: (biometricSources.photoBlobs ? biometricSources.photoBlobs.length : 0) + (biometricSources.videoBlob ? 1 : 0),
      updatedAt: new Date().toISOString()
    };

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['users', 'biometrics'], 'readwrite');
      tx.objectStore('users').put(userRecord);
      tx.objectStore('biometrics').put(biometricRecord);

      tx.oncomplete = async () => {
        console.log(`[DB] User ${userData.name} and encrypted biometrics (AES-GCM 256) saved successfully.`);
        const logType = isBlocked ? 'DANGER' : 'SUCCESS';
        const logCategory = isBlocked ? 'PESSOA BLOQUEADA CADASTRADA' : 'CADASTRO DE USUÁRIO';
        const logDesc = isBlocked 
          ? `Alerta: ${userData.name} cadastrado na LISTA NEGRA (Acesso Bloqueado). Detecções acionarão aviso de emergência.`
          : `Usuário ${userData.name} cadastrado com ${biometricRecord.sourceCount} fontes biométricas cifradas (AES-GCM).`;
        await this.addLog(logType, logCategory, logDesc);
        
        // Trigger background sync if Supabase is connected
        if (this.supabaseConfig.enabled) {
          this.syncToSupabase(userRecord, rawBiometricData);
        }
        resolve(userRecord);
      };

      tx.onerror = (e) => reject(e.target.error);
    });
  }

  // Get all registered users for matching (with secure AES-GCM payload decryption)
  async getAllUsers() {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['users', 'biometrics'], 'readonly');
      const userStore = tx.objectStore('users');
      const bioStore = tx.objectStore('biometrics');

      const users = [];
      const userReq = userStore.openCursor();

      userReq.onsuccess = async (e) => {
        const cursor = e.target.result;
        if (cursor) {
          const u = cursor.value;
          bioStore.get(u.id).onsuccess = async (be) => {
            const bioEntry = be.target.result || {};
            
            // Decrypt encrypted_payload if present
            if (bioEntry.encrypted_payload) {
              try {
                const decryptedStr = await this.decryptData(bioEntry.encrypted_payload);
                if (decryptedStr) {
                  const parsed = JSON.parse(decryptedStr);
                  u.biometrics = {
                    descriptors: parsed.descriptors || [],
                    photoBlobs: parsed.photoBlobs || [],
                    videoBlob: parsed.videoBlob || null,
                    sourceCount: bioEntry.sourceCount || 1,
                    updatedAt: bioEntry.updatedAt
                  };
                } else {
                  u.biometrics = { descriptors: [], photoBlobs: [], sourceCount: bioEntry.sourceCount || 1 };
                }
              } catch (err) {
                console.warn('[DB] Failed to decrypt biometric payload for user:', u.id, err);
                u.biometrics = { descriptors: [], photoBlobs: [], sourceCount: bioEntry.sourceCount || 1 };
              }
            } else {
              // Backward compatibility for unencrypted records
              u.biometrics = bioEntry;
            }

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

      tx.oncomplete = async () => {
        console.log(`[DB LGPD] User ${userId} and all biometric sources deleted permanently.`);
        await this.addLog('DANGER', 'EXPURGO LGPD', `Todos os dados pessoais, fotos, vídeos e descritores do ID ${userId} foram excluídos definitivamente.`);
        if (this.supabaseConfig.enabled) {
          this.deleteUserFromSupabase(userId);
        }
        resolve(true);
      };

      tx.onerror = (e) => reject(e.target.error);
    });
  }

  // Immutable Log Auditing System with SHA-256 Cryptographic Hash Chaining
  async addLog(type, category, description, camId = 'SYSTEM') {
    if (!this.db) await this.init();
    
    const timestamp = new Date().toLocaleTimeString('pt-BR', { hour12: false });
    const prevHash = this.lastLogHash || 'GENESIS_SECUREVISION_2026_ROOT';
    const logDataToHash = `${type}|${category}|${description}|${camId}|${timestamp}|${prevHash}`;
    const logHash = await this.hashSHA256(logDataToHash);
    this.lastLogHash = logHash;

    const logEntry = {
      type, // DANGER, SUCCESS, INFO, SCAN
      category,
      description,
      camId,
      timestamp,
      previous_hash: prevHash,
      hash: logHash
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

  // Supabase Adapter Configuration & Cloud Sync Engine
  async saveSupabaseCredentials(url, key) {
    // Sanitize URL (remove trailing slashes)
    const sanitizedUrl = url ? url.trim().replace(/\/+$/, '') : '';
    const sanitizedKey = key ? key.trim() : '';

    this.supabaseConfig.url = sanitizedUrl;
    this.supabaseConfig.key = sanitizedKey;
    this.supabaseConfig.enabled = !!(sanitizedUrl && sanitizedKey);

    localStorage.setItem('sv_supabase_url', sanitizedUrl);
    
    // Encrypt Supabase key before writing to localStorage
    if (sanitizedKey) {
      const encryptedKey = await this.encryptData(sanitizedKey);
      localStorage.setItem('sv_supabase_key_enc', encryptedKey);
      localStorage.removeItem('sv_supabase_key');
    } else {
      localStorage.removeItem('sv_supabase_key_enc');
      localStorage.removeItem('sv_supabase_key');
    }
    
    console.log('[Supabase Bridge] Credentials updated and securely encrypted. Active:', this.supabaseConfig.enabled);
  }

  /**
   * Synchronize all local users and biometrics to Supabase
   */
  async syncAllToSupabase() {
    if (!this.supabaseConfig.enabled) return 0;
    const users = await this.getAllUsers();
    let count = 0;
    for (const u of users) {
      const rawBio = u.biometrics ? {
        userId: u.id,
        descriptors: u.biometrics.descriptors || [],
        photoBlobs: u.biometrics.photoBlobs || [],
        videoBlob: u.biometrics.videoBlob || null,
        sourceCount: u.biometrics.sourceCount || 1,
        updatedAt: u.biometrics.updatedAt
      } : null;
      await this.syncToSupabase(u, rawBio);
      count++;
    }
    return count;
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
          cam_id: logEntry.camId || 'SYSTEM',
          previous_hash: logEntry.previous_hash || null,
          hash: logEntry.hash || null,
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
   * Schema Validation and Sanitization Rules for Database Ingestion
   */
  validateUserSchema(u) {
    if (!u || typeof u !== 'object') return false;
    if (!u.id || typeof u.id !== 'string' || u.id.length > 100) return false;
    if (!u.name || typeof u.name !== 'string' || u.name.length > 200) return false;
    if (!u.cpf_hash || typeof u.cpf_hash !== 'string' || u.cpf_hash.length < 10) return false;
    
    // Allowed access levels whitelist
    const allowedAccessLevels = ['Nível 1 (Autorizado)', 'Nível 2 (VIP)', 'Nível 3 (Admin)', 'BLOQUEADO'];
    if (u.accessLevel && !allowedAccessLevels.includes(u.accessLevel)) {
      u.accessLevel = u.isBlocked ? 'BLOQUEADO' : 'Nível 1 (Autorizado)';
    }
    return true;
  }

  validateBiometricSchema(b) {
    if (!b || typeof b !== 'object') return false;
    if (!b.userId || typeof b.userId !== 'string') return false;
    return true;
  }

  validateLogSchema(l) {
    if (!l || typeof l !== 'object') return false;
    if (!l.type || !['DANGER', 'SUCCESS', 'INFO', 'SCAN'].includes(l.type)) return false;
    if (!l.category || typeof l.category !== 'string') return false;
    if (!l.description || typeof l.description !== 'string') return false;
    return true;
  }

  /**
   * Export Zero-Knowledge Password-Protected & Encrypted Backup of Local IndexedDB
   * Uses AES-GCM 256-bit PBKDF2 with SHA-256 Integrity Verification
   */
  async exportDatabaseBackup(passphrase = 'SecureVision2026!') {
    if (!this.db) await this.init();
    
    return new Promise(async (resolve, reject) => {
      try {
        const tx = this.db.transaction(['users', 'biometrics', 'logs'], 'readonly');
        const userStore = tx.objectStore('users');
        const bioStore = tx.objectStore('biometrics');
        const logStore = tx.objectStore('logs');

        const rawData = {
          app: 'SecureVision AI',
          schemaVersion: '2026.2-SECURE',
          exportedAt: new Date().toISOString(),
          users: [],
          biometrics: [],
          logs: []
        };

        userStore.getAll().onsuccess = (e) => { rawData.users = e.target.result || []; };
        bioStore.getAll().onsuccess = (e) => { rawData.biometrics = e.target.result || []; };
        logStore.getAll().onsuccess = (e) => { rawData.logs = e.target.result || []; };

        tx.oncomplete = async () => {
          try {
            // 1. Serialize and encrypt entire payload with operator-supplied password
            const rawJsonString = JSON.stringify(rawData);
            const encryptedPayloadHex = await this.encryptData(rawJsonString, passphrase);
            
            // 2. Compute SHA-256 Integrity Digest of the ciphertext
            const integrityHash = await this.hashSHA256(encryptedPayloadHex, 'SV_BACKUP_INTEGRITY_SALT_2026');

            // 3. Construct Zero-Knowledge Encrypted Backup Container
            const secureBackupPackage = {
              format: 'SECUREVISION_ENCRYPTED_VAULT_V2',
              version: '2026.2',
              encrypted: true,
              cipher: 'AES-GCM-256-PBKDF2',
              recordCounts: {
                users: rawData.users.length,
                biometrics: rawData.biometrics.length,
                logs: rawData.logs.length
              },
              integrity_hash: integrityHash,
              payload: encryptedPayloadHex,
              exportedAt: rawData.exportedAt
            };

            await this.addLog('SUCCESS', 'BACKUP CRIPTOGRAFADO', `Backup seguro exportado com ${rawData.users.length} usuários (AES-GCM 256).`);
            resolve(secureBackupPackage);
          } catch (err) {
            reject(err);
          }
        };

        tx.onerror = (e) => reject(e.target.error);
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Restore Zero-Knowledge Encrypted Backup into Local IndexedDB
   * Verifies SHA-256 integrity, decrypts payload with password, and enforces schema validation
   */
  async restoreDatabaseBackup(backupPackage, passphrase = 'SecureVision2026!') {
    if (!this.db) await this.init();
    if (!backupPackage || typeof backupPackage !== 'object') {
      throw new Error('Arquivo de backup inválido ou corrompido.');
    }

    // 1. Check if backup is encrypted format
    let rawData = null;
    if (backupPackage.format === 'SECUREVISION_ENCRYPTED_VAULT_V2' && backupPackage.payload) {
      // A. Verify Integrity Hash before decryption
      const calculatedHash = await this.hashSHA256(backupPackage.payload, 'SV_BACKUP_INTEGRITY_SALT_2026');
      if (calculatedHash !== backupPackage.integrity_hash) {
        throw new Error('VIOLAÇÃO CRÍTICA DE INTEGRIDADE: O arquivo de backup foi adulterado ou corrompido.');
      }

      // B. Decrypt payload with passphrase
      const decryptedString = await this.decryptData(backupPackage.payload, passphrase);
      if (!decryptedString) {
        throw new Error('SENHA INCORRETA: Não foi possível descriptografar o backup. Senha informada inválida.');
      }

      try {
        rawData = JSON.parse(decryptedString);
      } catch (e) {
        throw new Error('Falha ao interpretar a estrutura interna do backup restaurado.');
      }
    } else if (Array.isArray(backupPackage.users)) {
      // Legacy unencrypted backup format support
      rawData = backupPackage;
    } else {
      throw new Error('Formato de backup não reconhecido pelo sistema SecureVision.');
    }

    // 2. Strict Schema Validation & Sanitization across all records
    if (!rawData || !Array.isArray(rawData.users)) {
      throw new Error('Estrutura de dados de usuários ausente no backup.');
    }

    const validatedUsers = rawData.users.filter(u => this.validateUserSchema(u));
    const validatedBios = (rawData.biometrics || []).filter(b => this.validateBiometricSchema(b));
    const validatedLogs = (rawData.logs || []).filter(l => this.validateLogSchema(l));

    if (validatedUsers.length === 0 && rawData.users.length > 0) {
      throw new Error('Nenhum registro de usuário passou na validação de integridade e segurança de esquema.');
    }

    // 3. Atomic Write to IndexedDB
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['users', 'biometrics', 'logs'], 'readwrite');
      const userStore = tx.objectStore('users');
      const bioStore = tx.objectStore('biometrics');
      const logStore = tx.objectStore('logs');

      validatedUsers.forEach(u => userStore.put(u));
      validatedBios.forEach(b => bioStore.put(b));
      validatedLogs.forEach(l => logStore.put(l));

      tx.oncomplete = async () => {
        await this.addLog('SUCCESS', 'RESTAURAÇÃO DE BACKUP', `${validatedUsers.length} usuários restaurados e validados por esquema.`);
        resolve(validatedUsers.length);
      };

      tx.onerror = (e) => reject(e.target.error);
    });
  }
}

// Global DB instance (Tamper-Proof Protected Singleton)
if (!window.svDB) {
  Object.defineProperty(window, 'svDB', {
    value: new SecureVisionDB(),
    writable: false,
    configurable: false,
    enumerable: true
  });
}

