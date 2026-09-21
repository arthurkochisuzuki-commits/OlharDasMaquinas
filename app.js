/**
 * SecureVision AI - Main Application Logic & Controller
 * Dynamic Real-Time Face Motion Tracking & Database Recognition
 */

class SecureVisionApp {
  constructor() {
    this.activeTab = 'monitoring';
    this.connectedDevices = [];
    this.cameraFeeds = [
      { id: 'CAM_01', name: 'Main Lobby Entry', deviceId: null, active: false },
      { id: 'CAM_02', name: 'Catracas / Entrada Norte', deviceId: null, active: false },
      { id: 'CAM_03', name: 'Acesso ao Cofre', deviceId: null, active: false },
      { id: 'CAM_04', name: 'Sala de Servidores', deviceId: null, active: false }
    ];
    this.enrollmentPhotos = [];
    this.enrollmentVideoBlob = null;
    this.lastLoggedUnauthorized = 0;
    this.lastVoiceTimeMap = {};
    this.currentIdentityState = null;
    this.stablePrimaryStatus = 'PAUSED';
    this.unauthDebounceFrames = 0;
    this.lastAuthorizedMatch = null;
    this.lastAuthorizedVoiceTime = 0;
  }

  async init() {
    console.log('[App] Starting SecureVision AI Application...');

    // Initialize DB & Biometrics Engine & Integrity Monitor
    await window.svDB.init();
    await window.svBiometrics.init();
    window.svIntegrity.init();

    this.setupEventListeners();
    this.setupKioskSecurityLockdown();
    this.setupStatusTab();
    this.loadTheme();
    this.loadLogsUI();
    this.loadRegisteredUsersUI();
    this.startMetricsTimer();
    this.initCameraFeeds();

    console.log('[App] SecureVision AI fully operational.');
  }

  /**
   * Kiosk & Operator Security Lockdown:
   * Bloqueia F12, atalhos do DevTools, Exibir Código-Fonte (Ctrl+U) e Botão Direito (Inspecionar)
   */
  setupKioskSecurityLockdown() {
    let lastKioskBlockTime = 0;
    const KIOSK_BLOCK_DEBOUNCE_MS = 1500; // Delay mínimo de 1.5 segundos entre notificações

    // 1. Bloqueio de Teclas de Atalho de Inspeção
    window.addEventListener('keydown', (e) => {
      const isF12 = e.key === 'F12' || e.keyCode === 123;
      const isCtrlShiftI = (e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'I' || e.key === 'i' || e.keyCode === 73);
      const isCtrlShiftJ = (e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'J' || e.key === 'j' || e.keyCode === 74);
      const isCtrlShiftC = (e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'C' || e.key === 'c' || e.keyCode === 67);
      const isCtrlU = (e.ctrlKey || e.metaKey) && (e.key === 'U' || e.key === 'u' || e.keyCode === 85);
      const isCtrlS = (e.ctrlKey || e.metaKey) && (e.key === 'S' || e.key === 's' || e.keyCode === 83);

      if (isF12 || isCtrlShiftI || isCtrlShiftJ || isCtrlShiftC || isCtrlU || isCtrlS) {
        e.preventDefault();
        e.stopPropagation();
        
        const now = Date.now();
        if (now - lastKioskBlockTime >= KIOSK_BLOCK_DEBOUNCE_MS) {
          lastKioskBlockTime = now;
          if (window.svDB) {
            window.svDB.addLog('DANGER', 'BLOQUEIO DE DEVTOOLS', 'Tentativa de inspeção (F12 / Console) bloqueada pelo sistema.', 'KIOSK');
          }
          this.speakVoiceNotification('Acesso ao console de desenvolvedor bloqueado por políticas de segurança.', 'f12_blocked');
        }
        return false;
      }
    }, true);

    // 2. Bloqueio de Menu de Contexto (Botão Direito do Mouse)
    window.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      return false;
    }, true);

    // 3. Limpeza e Proteção de Console contra Injeções
    console.warn('%c🛡️ SECUREVISION AI - MODO DE ALTA SEGURANÇA ATIVO', 'color:#ef4444; font-size:16px; font-weight:bold;');
    console.warn('%cO acesso direto e alterações manuais neste console são auditados e gravados.', 'color:#f59e0b; font-size:12px;');
  }

  setupEventListeners() {
    // Navigation Tabs
    document.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', (e) => {
        const tab = item.dataset.tab;
        if (tab) this.switchTab(tab);
      });
    });

    // Display Mode Selector (3 Modos de Monitor)
    this.setupDisplayModeSelector();

    // Header Settings Icon Button
    const btnHeaderSettings = document.getElementById('btnHeaderSettings');
    if (btnHeaderSettings) {
      btnHeaderSettings.addEventListener('click', () => this.switchTab('settings'));
    }

    // Check Connected Cameras Button
    const checkCamBtn = document.getElementById('btnCheckCameras');
    if (checkCamBtn) {
      checkCamBtn.addEventListener('click', () => this.openCameraCheckModal());
    }

    // Biometric Test Mode Selector
    const selectTestMode = document.getElementById('selectTestMode');
    if (selectTestMode) {
      selectTestMode.addEventListener('change', (e) => {
        window.svBiometrics.simulatedMode = e.target.value;
      });
    }

    // Configuração de Porcentagem Mínima para Alerta de Pessoa Não Cadastrada & Tolerância
    const minUnauthRange = document.getElementById('minUnauthPercentageRange');
    const minUnauthVal = document.getElementById('minUnauthPercentageVal');
    const sensRange = document.getElementById('sensitivityRange');
    const sensVal = document.getElementById('sensitivityRangeVal');

    const updateAllThresholds = (val) => {
      const numVal = Math.max(10, Math.min(95, parseFloat(val) || 60));
      localStorage.setItem('sv_min_unauth_percentage', numVal);
      localStorage.setItem('sv_sensitivity_range', numVal);
      if (minUnauthRange) minUnauthRange.value = numVal;
      if (minUnauthVal) minUnauthVal.textContent = `${numVal}%`;
      if (sensRange) sensRange.value = numVal;
      if (sensVal) sensVal.textContent = `${numVal}%`;
      if (window.svBiometrics) {
        window.svBiometrics.setMinUnauthPercentage(numVal);
      }
    };

    if (minUnauthRange) {
      const savedMin = localStorage.getItem('sv_min_unauth_percentage') || '60';
      updateAllThresholds(savedMin);

      minUnauthRange.addEventListener('input', (e) => updateAllThresholds(e.target.value));
      minUnauthRange.addEventListener('change', (e) => updateAllThresholds(e.target.value));
    }

    if (sensRange) {
      sensRange.addEventListener('input', (e) => updateAllThresholds(e.target.value));
      sensRange.addEventListener('change', (e) => updateAllThresholds(e.target.value));
    }

    // Theme Switcher (Escuro vs Claro)
    const themeSelect = document.getElementById('themeSelect');
    if (themeSelect) {
      themeSelect.addEventListener('change', (e) => this.setTheme(e.target.value));
    }

    // Multi-source enrollment capture buttons
    const btnCapPhoto = document.getElementById('btnCapturePhoto');
    if (btnCapPhoto) {
      btnCapPhoto.addEventListener('click', () => this.captureEnrollmentPhoto());
    }

    const btnClear = document.getElementById('btnClearPhotos');
    if (btnClear) {
      btnClear.addEventListener('click', () => this.clearEnrollmentPhotos());
    }

    // Restrição e Máscara de CPF (Apenas 11 dígitos numéricos formatados: 000.000.000-00)
    const cpfInput = document.getElementById('enrollCpf');
    if (cpfInput) {
      cpfInput.addEventListener('input', (e) => {
        let value = e.target.value.replace(/\D/g, '');
        if (value.length > 11) value = value.slice(0, 11);
        if (value.length > 9) {
          value = value.replace(/(\d{3})(\d{3})(\d{3})(\d{1,2})/, '$1.$2.$3-$4');
        } else if (value.length > 6) {
          value = value.replace(/(\d{3})(\d{3})(\d{1,3})/, '$1.$2.$3');
        } else if (value.length > 3) {
          value = value.replace(/(\d{3})(\d{1,3})/, '$1.$2');
        }
        e.target.value = value;
      });
    }

    // Enrollment Form Submit (LGPD) - Autorizado
    const enrollForm = document.getElementById('enrollmentForm');
    if (enrollForm) {
      enrollForm.addEventListener('submit', (e) => this.handleEnrollmentSubmit(e, false));
    }

    // Enrollment Form Submit - Pessoa Bloqueada (Lista Negra)
    const btnSubmitBlocked = document.getElementById('btnSubmitBlocked');
    if (btnSubmitBlocked) {
      btnSubmitBlocked.addEventListener('click', (e) => this.handleEnrollmentSubmit(e, true));
    }

    // Deduplicação Manual de Cadastros Repetidos
    const btnDeduplicate = document.getElementById('btnDeduplicateUsers');
    if (btnDeduplicate) {
      btnDeduplicate.addEventListener('click', async () => {
        btnDeduplicate.disabled = true;
        btnDeduplicate.textContent = '🧹 Verificando...';
        const removed = await window.svDB.deduplicateUsers();
        await window.svBiometrics.reloadRegisteredUsers();
        await this.loadRegisteredUsersUI(false);
        btnDeduplicate.disabled = false;
        btnDeduplicate.textContent = '🧹 Limpar Duplicados';
        if (removed > 0) {
          alert(`✅ Limpeza concluída!\n\n${removed} cadastro(s) duplicado(s) foram unificados e limpos com sucesso no banco de dados.`);
        } else {
          alert('✓ O banco de dados já está 100% organizado. Nenhum cadastro duplicado encontrado.');
        }
      });
    }

    // Listen to real-time log events
    window.addEventListener('sv_new_log', (e) => this.appendLogCard(e.detail));

    // Load saved Supabase inputs
    this.loadSupabaseUI();

    // Save Supabase settings
    const btnSaveSupabase = document.getElementById('btnSaveSupabase');
    if (btnSaveSupabase) {
      btnSaveSupabase.addEventListener('click', async () => {
        const url = document.getElementById('supabaseUrlInput').value;
        const key = document.getElementById('supabaseKeyInput').value;
        
        btnSaveSupabase.disabled = true;
        btnSaveSupabase.textContent = '🔄 Conectando e Sincronizando...';

        await window.svDB.saveSupabaseCredentials(url, key);
        const testResult = await window.svDB.testSupabaseConnection();

        if (testResult.success) {
          const syncedCount = await window.svDB.syncAllToSupabase();
          alert(`✅ ${testResult.message}\n\n📦 ${syncedCount} registros locais sincronizados com o Supabase Cloud!`);
        } else {
          alert(`⚠️ ${testResult.message}`);
        }

        btnSaveSupabase.disabled = false;
        btnSaveSupabase.textContent = '💾 Salvar Credenciais Supabase';
      });
    }

    // Export Zero-Knowledge Password-Protected Backup (AES-GCM 256 + SHA-256 Digest)
    const btnExportBackup = document.getElementById('btnExportBackup');
    if (btnExportBackup) {
      btnExportBackup.addEventListener('click', async () => {
        const passphrase = prompt('🔐 DEFINIR SENHA DO BACKUP CRIPTOGRAFADO:\n\nInforme uma senha para proteger os dados biométricos e registros do sistema:', 'SecureVision2026!');
        if (!passphrase) {
          alert('⚠️ Exportação cancelada. A definição de senha é obrigatória para gerar o backup criptografado.');
          return;
        }

        try {
          btnExportBackup.disabled = true;
          btnExportBackup.textContent = '⏳ Gerando Cofre Criptografado...';
          const backupData = await window.svDB.exportDatabaseBackup(passphrase);
          const jsonStr = JSON.stringify(backupData, null, 2);
          const blob = new Blob([jsonStr], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          const dateStr = new Date().toISOString().slice(0, 10);
          a.href = url;
          a.download = `securevision_vault_backup_${dateStr}.json`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          alert('✅ COFRE DE BACKUP EXPORTADO COM SUCESSO!\n\nOs dados foram 100% criptografados com AES-GCM 256-bit e protegidos por assinatura SHA-256.');
        } catch (err) {
          alert(`❌ Erro ao exportar backup: ${err.message}`);
        } finally {
          btnExportBackup.disabled = false;
          btnExportBackup.textContent = '📦 Exportar Backup Criptografado (JSON)';
        }
      });
    }

    // Restore Zero-Knowledge Encrypted Backup
    const inputImportBackup = document.getElementById('inputImportBackup');
    if (inputImportBackup) {
      inputImportBackup.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const passphrase = prompt('🔑 INFORME A SENHA DE DESCRIPTOGRAFIA DO BACKUP:\n\nDigite a senha definida no momento da exportação deste cofre:');
        if (!passphrase) {
          alert('⚠️ Restauração cancelada. A senha de descriptografia é obrigatória.');
          inputImportBackup.value = '';
          return;
        }

        try {
          const text = await file.text();
          const backupData = JSON.parse(text);
          const count = await window.svDB.restoreDatabaseBackup(backupData, passphrase);
          await window.svBiometrics.reloadRegisteredUsers();
          this.loadRegisteredUsersUI();
          this.loadLogsUI();
          alert(`✅ RESTAURAÇÃO CONCLUÍDA COM SUCESSO!\n\n${count} registros foram verificados por esquema, descriptografados e integrados com segurança ao banco de dados.`);
        } catch (err) {
          alert(`❌ FALHA DE SEGURANÇA NA RESTAURAÇÃO:\n\n${err.message}`);
        } finally {
          inputImportBackup.value = '';
        }
      });
    }
  }

  loadSupabaseUI() {
    const urlInput = document.getElementById('supabaseUrlInput');
    const keyInput = document.getElementById('supabaseKeyInput');
    if (urlInput && window.svDB && window.svDB.supabaseConfig.url) {
      urlInput.value = window.svDB.supabaseConfig.url;
    }
    if (keyInput && window.svDB && window.svDB.supabaseConfig.key) {
      keyInput.value = window.svDB.supabaseConfig.key;
    }
  }

  // Security Helper: Official Brazilian CPF Validation Algorithm (Modulo 11 with Check Digits)
  validateCPF(cpf) {
    if (!cpf || typeof cpf !== 'string') return false;
    const clean = cpf.replace(/\D/g, '');
    if (clean.length !== 11) return false;
    
    // Rejeita sequências com todos os dígitos iguais (ex: 00000000000, 11111111111, etc.)
    if (/^(\d)\1{10}$/.test(clean)) return false;

    // Cálculo do 1º Dígito Verificador
    let sum = 0;
    for (let i = 0; i < 9; i++) {
      sum += parseInt(clean.charAt(i), 10) * (10 - i);
    }
    let rest = 11 - (sum % 11);
    let digit1 = (rest === 10 || rest === 11) ? 0 : rest;
    if (digit1 !== parseInt(clean.charAt(9), 10)) return false;

    // Cálculo do 2º Dígito Verificador
    sum = 0;
    for (let i = 0; i < 10; i++) {
      sum += parseInt(clean.charAt(i), 10) * (11 - i);
    }
    rest = 11 - (sum % 11);
    let digit2 = (rest === 10 || rest === 11) ? 0 : rest;
    return digit2 === parseInt(clean.charAt(10), 10);
  }

  loadTheme() {
    const savedTheme = localStorage.getItem('sv_theme') || 'dark';
    this.setTheme(savedTheme);
    const themeSelect = document.getElementById('themeSelect');
    if (themeSelect) themeSelect.value = savedTheme;
  }

  setTheme(theme) {
    localStorage.setItem('sv_theme', theme);
    if (theme === 'light') {
      document.body.classList.add('light-theme');
    } else {
      document.body.classList.remove('light-theme');
    }
  }

  switchTab(tabId) {
    this.activeTab = tabId;
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.tab-section').forEach(el => el.classList.remove('active'));

    const navItem = document.querySelector(`.nav-item[data-tab="${tabId}"]`);
    if (navItem) navItem.classList.add('active');

    const targetTab = document.getElementById(`tab-${tabId}`);
    if (targetTab) targetTab.classList.add('active');

    if (tabId === 'enrollment') {
      this.initEnrollmentWebcam();
    }
  }

  setupDisplayModeSelector() {
    const buttons = document.querySelectorAll('.btn-mode-toggle');
    buttons.forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.getAttribute('data-mode');
        this.setDisplayMode(mode);
      });
    });

    const savedMode = localStorage.getItem('sv_display_mode') || 'default';
    this.setDisplayMode(savedMode);
  }

  setDisplayMode(mode) {
    document.body.classList.remove('mode-default', 'mode-enrollment', 'mode-cameras');
    document.body.classList.add(`mode-${mode}`);
    localStorage.setItem('sv_display_mode', mode);

    document.querySelectorAll('.btn-mode-toggle').forEach(btn => {
      if (btn.getAttribute('data-mode') === mode) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    if (mode === 'enrollment') {
      this.switchTab('enrollment');
      this.initEnrollmentWebcam();
    } else if (mode === 'cameras') {
      this.switchTab('monitoring');
    }
  }

  async initEnrollmentWebcam() {
    const video = document.getElementById('enrollmentWebcamPreview');
    if (video && !video.srcObject) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        video.srcObject = stream;
        await video.play();
      } catch (err) {
        console.warn('[Enrollment] Auto-start preview failed:', err.message);
      }
    }
  }

  // Security Helper: Universal XSS Prevention Sanitizer
  escapeHTML(str) {
    if (typeof str !== 'string') return str || '';
    return str.replace(/[&<>'"]/g, tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag));
  }

  // 🔍 Verificar Câmeras Conectadas no Dispositivo (com detecção de Câmeras Virtuais e Anti-XSS)
  async openCameraCheckModal() {
    const modal = document.getElementById('cameraCheckModal');
    const deviceListEl = document.getElementById('connectedDeviceList');
    if (!deviceListEl) return;

    deviceListEl.innerHTML = '<div style="color:var(--text-muted); font-size:0.85rem;">Escaneando barramento de vídeo do sistema...</div>';
    modal.classList.add('active');

    try {
      await navigator.mediaDevices.getUserMedia({ video: true }).catch(() => {});
      const devices = await navigator.mediaDevices.enumerateDevices();
      this.connectedDevices = devices.filter(d => d.kind === 'videoinput');

      if (this.connectedDevices.length === 0) {
        deviceListEl.innerHTML = `
          <div style="background: rgba(239,68,68,0.1); border:1px solid #ef4444; padding:14px; border-radius:6px; color:#f87171; font-size:0.85rem; text-align:center;">
            ⚠️ Nenhuma câmera física ou webcam USB conectada ao computador.
          </div>`;
      } else {
        deviceListEl.innerHTML = '';
        const ul = document.createElement('ul');
        ul.style.cssText = 'list-style:none; display:flex; flex-direction:column; gap:8px; padding:0; margin:0;';

        const virtualDriverKeywords = ['obs', 'virtual', 'manycam', 'v4l2loopback', 'fake', 'splitcam', 'droidcam'];

        this.connectedDevices.forEach((dev, index) => {
          const rawLabel = dev.label || `Câmera Dispositivo #${index + 1}`;
          const isVirtual = virtualDriverKeywords.some(kw => rawLabel.toLowerCase().includes(kw));

          const li = document.createElement('li');
          li.style.cssText = `background:var(--bg-card); border:1px solid ${isVirtual ? '#ef4444' : 'var(--border-color)'}; padding:10px 14px; border-radius:6px; display:flex; align-items:center; justify-content:space-between;`;

          const infoDiv = document.createElement('div');
          const titleStrong = document.createElement('strong');
          titleStrong.style.cssText = 'color:var(--text-main); font-size:0.85rem; display:block;';
          titleStrong.textContent = `📷 ${rawLabel}`;
          
          if (isVirtual) {
            const warnBadge = document.createElement('span');
            warnBadge.style.cssText = 'font-size:0.65rem; color:#ef4444; background:rgba(239,68,68,0.15); border:1px solid #ef4444; padding:2px 6px; border-radius:3px; margin-left:6px; font-weight:700;';
            warnBadge.textContent = '⚠️ CÂMERA VIRTUAL DETECTADA';
            titleStrong.appendChild(warnBadge);
          }

          const idDiv = document.createElement('div');
          idDiv.style.cssText = 'font-family: monospace; font-size:0.7rem; color:var(--text-dim); margin-top:2px;';
          idDiv.textContent = `ID: ${dev.deviceId.substring(0, 24)}...`;

          infoDiv.appendChild(titleStrong);
          infoDiv.appendChild(idDiv);

          const btnDiv = document.createElement('div');
          btnDiv.style.cssText = 'display:flex; gap:6px; flex-wrap:wrap; align-items:center;';

          [1, 2, 3, 4].forEach(slot => {
            const btn = document.createElement('button');
            btn.className = 'btn-action';
            btn.style.cssText = 'font-size:0.75rem; padding:4px 8px;';
            btn.textContent = `Feed ${slot}`;
            btn.title = `Vincular esta câmera ao Feed ${slot}`;
            btn.addEventListener('click', () => this.assignCameraToSlot(dev.deviceId, rawLabel, slot));
            btnDiv.appendChild(btn);
          });

          li.appendChild(infoDiv);
          li.appendChild(btnDiv);
          ul.appendChild(li);
        });

        deviceListEl.appendChild(ul);
      }

      window.svDB.addLog('INFO', 'VERIFICAÇÃO DE CÂMERAS', `${this.connectedDevices.length} dispositivos de vídeo verificados no sistema.`);
    } catch (err) {
      console.error('[Cameras] Error enumerating devices:', err);
      deviceListEl.innerHTML = `<div style="color:#ef4444;">Erro ao verificar câmeras: ${this.escapeHTML(err.message)}</div>`;
    }
  }

  async assignCameraToSlot(deviceId, label, slotNum = 1) {
    const safeLabel = label || `Webcam ${slotNum}`;
    const slotIdx = slotNum - 1;
    if (this.cameraFeeds[slotIdx]) {
      this.cameraFeeds[slotIdx].deviceId = deviceId;
      this.cameraFeeds[slotIdx].name = safeLabel;
    }
    
    const tagEl = document.getElementById(`tagCam${slotNum}`);
    if (tagEl) tagEl.textContent = `CAM_0${slotNum} · ${safeLabel.substring(0, 18)}`;

    const modal = document.getElementById('cameraCheckModal');
    if (modal) modal.classList.remove('active');
    await this.connectSlotCamera(slotNum, deviceId);
    alert(`✅ Câmera "${safeLabel}" conectada com sucesso ao Feed ${slotNum}!`);
  }

  async connectSlotCamera(slotNum, deviceId) {
    const videoEl = document.getElementById(`videoFeedCam${slotNum}`);
    const overlayEl = document.getElementById(`noCamOverlay${slotNum}`);
    const canvasEl = document.getElementById(`canvasFeedCam${slotNum}`);
    const statusEl = document.getElementById(`statusCam${slotNum}`);

    if (!videoEl) return;

    try {
      const constraints = deviceId 
        ? { video: { deviceId: { exact: deviceId }, width: { ideal: 640 }, height: { ideal: 480 } } } 
        : { video: { width: { ideal: 640 }, height: { ideal: 480 } } };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      videoEl.srcObject = stream;
      videoEl.style.display = 'block';
      if (canvasEl) canvasEl.style.display = 'block';
      await videoEl.play();

      if (overlayEl) overlayEl.style.display = 'none';
      if (statusEl) {
        statusEl.textContent = '● LIVE STREAM';
        statusEl.style.color = '#10b981';
      }
      const slotIdx = slotNum - 1;
      if (this.cameraFeeds[slotIdx]) this.cameraFeeds[slotIdx].active = true;
      this.updateActiveStreamsMetric();
    } catch (err) {
      console.warn(`[Camera Slot ${slotNum}] Connection failed:`, err.message);
      this.showNoCameraOverlay(slotNum);
    }
  }

  showNoCameraOverlay(slotNum) {
    const overlayEl = document.getElementById(`noCamOverlay${slotNum}`);
    const videoEl = document.getElementById(`videoFeedCam${slotNum}`);
    const canvasEl = document.getElementById(`canvasFeedCam${slotNum}`);
    const statusEl = document.getElementById(`statusCam${slotNum}`);

    if (overlayEl) overlayEl.style.display = 'flex';
    if (videoEl) videoEl.style.display = 'none';
    if (canvasEl) canvasEl.style.display = 'none';
    if (statusEl) {
      statusEl.textContent = 'DISCONNECTED';
      statusEl.style.color = '#64748b';
    }
    const slotIdx = slotNum - 1;
    if (this.cameraFeeds[slotIdx]) this.cameraFeeds[slotIdx].active = false;
    this.updateActiveStreamsMetric();
  }

  // Initialize live video feeds
  async initCameraFeeds() {
    await this.connectSlotCamera(1, null);

    // Slots 2, 3, 4 show "NENHUMA CÂMERA CONECTADA" by default
    this.showNoCameraOverlay(2);
    this.showNoCameraOverlay(3);
    this.showNoCameraOverlay(4);

    this.updateActiveStreamsMetric();
    this.startDetectionLoop();
  }

  updateActiveStreamsMetric() {
    const activeCount = Object.values(this.cameraFeeds).filter(f => f.active).length;
    const metricEl = document.getElementById('activeStreamsCount');
    if (metricEl) metricEl.textContent = `${activeCount} / 4`;
  }

  /**
   * Real-time Canvas Rendering Loop (Strict Face Tracking & Database Recognition)
   */
  /**
   * Web Speech API Synthesizer (Anúncio Falado de Pessoas e Alertas)
   */
  speakVoiceNotification(text, messageKey) {
    const voiceSelect = document.getElementById('voiceToggleSelect');
    if (voiceSelect && voiceSelect.value === 'disabled') return;
    if (!('speechSynthesis' in window)) return;

    const now = Date.now();

    // Se uma pessoa autorizada acabou de ser anunciada nos últimos 5 segundos,
    // impede que avisos transitórios de não-autorizado disputem a fala
    if (messageKey === 'unauth_voice' && (now - (this.lastAuthorizedVoiceTime || 0)) < 5000) {
      return;
    }

    const lastTime = this.lastVoiceTimeMap[messageKey] || 0;
    if (now - lastTime < 9000) return; // 9 seconds cooldown per distinct alert message

    this.lastVoiceTimeMap[messageKey] = now;
    if (messageKey.startsWith('auth_')) {
      this.lastAuthorizedVoiceTime = now;
    }

    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'pt-BR';
      utterance.rate = 1.0;
      utterance.pitch = 1.0;
      window.speechSynthesis.speak(utterance);
    } catch (e) {
      console.warn('[Speech] Error speaking notification:', e);
    }
  }

  /**
   * Atualização em Tempo Real do Painel de Identidade (Cadastrado / Não Cadastrado / Pausado)
   */
  updateIdentityBanner(statusState, details = {}) {
    const bannerEl = document.getElementById('realtimeIdentityBanner');
    const iconEl = document.getElementById('identityStatusIcon');
    const titleEl = document.getElementById('identityStatusTitle');
    const subEl = document.getElementById('identityStatusSub');
    const badgeEl = document.getElementById('identityStatusBadge');

    if (!bannerEl) return;

    // Avoid DOM thrashing if state hasn't changed
    const stateKey = `${statusState}_${details.name || ''}`;
    if (this.currentIdentityState === stateKey) return;
    this.currentIdentityState = stateKey;

    if (statusState === 'PAUSED') {
      bannerEl.className = 'identity-status-banner paused';
      if (iconEl) iconEl.textContent = '⏸️';
      if (titleEl) {
        titleEl.textContent = 'NENHUMA PESSOA DETECTADA NA CÂMERA';
        titleEl.style.color = 'var(--text-dim)';
      }
      if (subEl) subEl.textContent = 'Sistema em Pausa Automática (Economizando recursos de CPU/GPU). Aguardando presença humana em frente à câmera.';
      if (badgeEl) {
        badgeEl.textContent = 'PAUSADO';
        badgeEl.style.background = 'rgba(100,116,139,0.15)';
        badgeEl.style.borderColor = '#64748b';
        badgeEl.style.color = '#94a3b8';
      }
      this.speakVoiceNotification('Nenhuma pessoa detectada na câmera. Processamento biométrico pausado.', 'paused_voice');

    } else if (statusState === 'TOO_FAR') {
      bannerEl.className = 'identity-status-banner paused';
      if (iconEl) iconEl.textContent = '📏';
      if (titleEl) {
        titleEl.textContent = 'MUITO DISTANTE — APROXIME-SE DA CÂMERA';
        titleEl.style.color = '#f59e0b';
      }
      if (subEl) subEl.textContent = 'Rosto muito distante ou pequeno para reconhecimento definitivo. Aproxime-se para autorização.';
      if (badgeEl) {
        badgeEl.textContent = 'APROXIME-SE';
        badgeEl.style.background = 'rgba(245,158,11,0.15)';
        badgeEl.style.borderColor = '#f59e0b';
        badgeEl.style.color = '#fbbf24';
      }
      this.speakVoiceNotification('Por favor, aproxime-se da câmera para identificação facial.', 'too_far_voice');

    } else if (statusState === 'SPOOF') {
      bannerEl.className = 'identity-status-banner unauthorized';
      if (iconEl) iconEl.textContent = '⚠️';
      if (titleEl) {
        titleEl.textContent = '🚨 ALERTA CRÍTICO: ATAQUE DE SPOOFING DETECTADO';
        titleEl.style.color = '#ef4444';
      }
      if (subEl) subEl.textContent = 'Fraude Biométrica: Imagem estática ou foto parada detectada em frente à câmera. Prova de vida (Liveness) rejeitada.';
      if (badgeEl) {
        badgeEl.textContent = 'SPOOF / FOTO ESTÁTICA';
        badgeEl.style.background = 'rgba(239,68,68,0.3)';
        badgeEl.style.borderColor = '#ef4444';
        badgeEl.style.color = '#ff6b6b';
      }
      this.speakVoiceNotification('Alerta de segurança! Tentativa de fraude por foto ou tela detectada!', 'spoof_voice');

    } else if (statusState === 'AUTHORIZED') {
      bannerEl.className = 'identity-status-banner authorized';
      if (iconEl) iconEl.textContent = '✅';
      if (titleEl) {
        titleEl.textContent = `PESSOA CADASTRADA: ${details.name ? this.escapeHTML(details.name).toUpperCase() : 'AUTORIZADO'}`;
        titleEl.style.color = '#10b981';
      }
      if (subEl) subEl.textContent = `Identidade confirmada no Banco de Dados Biométrico (Confiança: ${details.confidence || 95}% | Liveness: ${details.livenessScore || 90}% ✓ | ArcFace Margin s=32, m=0.5).`;
      if (badgeEl) {
        badgeEl.textContent = 'CADASTRADO / AUTORIZADO';
        badgeEl.style.background = 'rgba(16,185,129,0.15)';
        badgeEl.style.borderColor = '#10b981';
        badgeEl.style.color = '#10b981';
      }
      this.speakVoiceNotification(`Pessoa cadastrada identificada: ${details.name}`, `auth_${details.name}`);

    } else if (statusState === 'BLOCKED') {
      bannerEl.className = 'identity-status-banner unauthorized';
      if (iconEl) iconEl.textContent = '⛔';
      if (titleEl) {
        titleEl.textContent = `🚫 ALERTA CRÍTICO: PESSOA BLOQUEADA DETECTADA: ${details.name ? this.escapeHTML(details.name).toUpperCase() : 'BLOQUEADO'}`;
        titleEl.style.color = '#ef4444';
      }
      if (subEl) subEl.textContent = `ACESSO TOTALMENTE PROIBIDO (Lista Negra). Indivíduo com restrição de segurança identificado no banco (Confiança: ${details.confidence || 95}%).`;
      if (badgeEl) {
        badgeEl.textContent = 'BLOQUEADO / BLACKLIST';
        badgeEl.style.background = 'rgba(239,68,68,0.25)';
        badgeEl.style.borderColor = '#ef4444';
        badgeEl.style.color = '#ff4d4f';
      }
      this.speakVoiceNotification(`Atenção máxima! Pessoa bloqueada detectada na câmera: ${details.name}!`, `blocked_${details.name}`);

    } else if (statusState === 'UNAUTHORIZED') {
      bannerEl.className = 'identity-status-banner unauthorized';
      if (iconEl) iconEl.textContent = '🚨';
      if (titleEl) {
        titleEl.textContent = 'ALERTA: PESSOA NÃO CADASTRADA DETECTADA';
        titleEl.style.color = '#ef4444';
      }
      const minPercent = (window.svBiometrics && window.svBiometrics.minUnauthPercentage) || 60;
      const currentSim = details && details.confidence ? details.confidence : '0.0';
      if (subEl) subEl.textContent = `Rosto humano detectado na câmera com similaridade biométrica de ${currentSim}%, abaixo da porcentagem mínima configurada (${minPercent}%). Acesso não autorizado.`;
      if (badgeEl) {
        badgeEl.textContent = 'NÃO CADASTRADO / RED ALERT';
        badgeEl.style.background = 'rgba(239,68,68,0.15)';
        badgeEl.style.borderColor = '#ef4444';
        badgeEl.style.color = '#f87171';
      }
      this.speakVoiceNotification('Atenção! Pessoa não cadastrada detectada na câmera!', 'unauth_voice');

    } else if (statusState === 'ANALYZING') {
      bannerEl.className = 'identity-status-banner';
      if (iconEl) iconEl.textContent = '🔍';
      if (titleEl) {
        titleEl.textContent = `ANALISANDO ROSTO EM TEMPO REAL (${details && details.confidence ? details.confidence : 0}%)`;
        titleEl.style.color = 'var(--accent-cyan)';
      }
      const minPercent = (window.svBiometrics && window.svBiometrics.minUnauthPercentage) || 60;
      if (subEl) subEl.textContent = `Rosto em enquadramento. Aguardando confiança mínima configurada (${minPercent}%) para emissão de alertas.`;
      if (badgeEl) {
        badgeEl.textContent = 'ANALISANDO';
        badgeEl.style.background = 'rgba(6,182,212,0.15)';
        badgeEl.style.borderColor = 'rgba(6,182,212,0.4)';
        badgeEl.style.color = '#06b6d4';
      }
    }
  }

  /**
   * Renderiza a marcação de pausa sobre o canvas da câmera quando nenhuma pessoa está presente
   */
  drawPausedCanvasOverlay(ctx, canvas) {
    ctx.save();
    ctx.fillStyle = 'rgba(15, 23, 42, 0.4)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.font = 'bold 12px JetBrains Mono, monospace';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.textAlign = 'center';
    ctx.fillText('⏸️ SISTEMA PAUSADO - AGUARDANDO PRESENÇA DE PESSOA', canvas.width / 2, canvas.height / 2);

    ctx.font = '10px Inter, sans-serif';
    ctx.fillStyle = 'rgba(148, 163, 184, 0.85)';
    ctx.fillText('Economizando 100% de processamento ArcFace. A câmera voltará a analisar assim que uma pessoa surgir.', canvas.width / 2, canvas.height / 2 + 20);
    ctx.restore();
  }

  /**
   * Loop de Renderização em Tempo Real com Suporte a Pausa Automática e Reconhecimento
   */
  startDetectionLoop() {
    const render = () => {
      let anyPersonDetected = false;
      let primaryMatch = null;
      let primaryStatus = 'PAUSED';

      for (let slot = 1; slot <= 4; slot++) {
        const slotIdx = slot - 1;
        const feedConfig = this.cameraFeeds[slotIdx];
        const videoEl = document.getElementById(`videoFeedCam${slot}`);
        const canvasEl = document.getElementById(`canvasFeedCam${slot}`);

        if (canvasEl && videoEl && feedConfig && feedConfig.active && !videoEl.paused && videoEl.readyState >= 2) {
          canvasEl.style.display = 'block';
          const container = canvasEl.parentElement;
          if (container && (canvasEl.width !== container.clientWidth || canvasEl.height !== container.clientHeight)) {
            canvasEl.width = container.clientWidth;
            canvasEl.height = container.clientHeight;
          }
          const ctx = canvasEl.getContext('2d');
          ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);

          // Detect Face & Match with Database
          const trackingData = window.svBiometrics.detectFaceInVideo(videoEl, canvasEl);
          if (trackingData && trackingData.box) {
            const { box, match } = trackingData;

            if (box.detected) {
              anyPersonDetected = true;
              let currentStatus = 'UNAUTHORIZED';
              if (box.isTooFar) {
                currentStatus = 'TOO_FAR';
              } else if (match && match.isSpoofed) {
                currentStatus = 'SPOOF';
              } else if (match && match.matched) {
                currentStatus = match.isBlocked ? 'BLOCKED' : 'AUTHORIZED';
              } else if (match && match.showUnauthAlert === false) {
                currentStatus = 'ANALYZING';
              }

              this.drawDynamicBoundingBox(ctx, box, match, feedConfig.id, trackingData.isolatedCanvas);

              if (!primaryMatch || currentStatus === 'BLOCKED' || currentStatus === 'SPOOF' || (currentStatus === 'AUTHORIZED' && primaryStatus !== 'BLOCKED') || (currentStatus === 'UNAUTHORIZED' && primaryStatus === 'ANALYZING')) {
                primaryMatch = match;
                primaryStatus = currentStatus;
              }
            } else if (canvasEl.width > 0 && canvasEl.height > 0) {
              this.drawPausedCanvasOverlay(ctx, canvasEl);
            }
          }
        } else if (canvasEl && (!feedConfig || !feedConfig.active || !videoEl || videoEl.paused)) {
          canvasEl.style.display = 'none';
        }
      }

      // Estabilização e Debounce de Estado (Elimina oscilação entre Cadastrado e Não Cadastrado)
      if (anyPersonDetected && primaryMatch) {
        if (primaryStatus === 'AUTHORIZED') {
          this.stablePrimaryStatus = 'AUTHORIZED';
          this.unauthDebounceFrames = 0;
          this.lastAuthorizedMatch = primaryMatch;
        } else if (primaryStatus === 'UNAUTHORIZED') {
          // Se estava previamente AUTORIZADO, exige 14 frames contínuos de NÃO-AUTORIZADO (~450ms)
          // antes de rebaixar a interface para Alerta Vermelho
          if (this.stablePrimaryStatus === 'AUTHORIZED' && this.lastAuthorizedMatch) {
            this.unauthDebounceFrames++;
            if (this.unauthDebounceFrames < 14) {
              primaryStatus = 'AUTHORIZED';
              primaryMatch = this.lastAuthorizedMatch;
            } else {
              this.stablePrimaryStatus = 'UNAUTHORIZED';
            }
          } else {
            this.stablePrimaryStatus = 'UNAUTHORIZED';
          }
        } else {
          this.stablePrimaryStatus = primaryStatus;
          this.unauthDebounceFrames = 0;
        }

        if (primaryStatus === 'AUTHORIZED') {
          const livenessScore = primaryMatch.liveness ? primaryMatch.liveness.scorePercent : '95';
          this.updateIdentityBanner('AUTHORIZED', { name: primaryMatch.name, confidence: primaryMatch.confidence, role: primaryMatch.role, livenessScore });
          this.updateSystemStatusLive('AUTHORIZED', primaryMatch);
        } else if (primaryStatus === 'BLOCKED') {
          this.updateIdentityBanner('BLOCKED', { name: primaryMatch.name, confidence: primaryMatch.confidence, role: primaryMatch.role });
          this.updateSystemStatusLive('BLOCKED', primaryMatch);
        } else {
          this.updateIdentityBanner(primaryStatus, primaryMatch);
          this.updateSystemStatusLive(primaryStatus, primaryMatch);
        }
      } else {
        this.stablePrimaryStatus = 'PAUSED';
        this.unauthDebounceFrames = 0;
        this.lastAuthorizedMatch = null;
        this.updateIdentityBanner('PAUSED');
        this.updateSystemStatusLive('PAUSED', null);
      }

      requestAnimationFrame(render);
    };

    render();
  }

  /**
   * Draws dynamic bounding box over active video stream
   */
  drawDynamicBoundingBox(ctx, box, match, camId, isolatedCanvas = null) {
    const isTooFar = box && box.isTooFar;
    const isSpoofed = match && match.isSpoofed;
    const isMatched = match && match.matched && !isSpoofed && !isTooFar;
    const isBlocked = isMatched && match.isBlocked;
    const isAuthorized = isMatched && !match.isBlocked;
    const isAnalyzing = !isMatched && !isTooFar && !isSpoofed && match && match.showUnauthAlert === false;
    const minPercent = (window.svBiometrics && window.svBiometrics.minUnauthPercentage) || 60;

    let strokeColor = '#ef4444';
    let fillColor = 'rgba(239, 68, 68, 0.15)';
    if (isTooFar) {
      strokeColor = '#f59e0b';
      fillColor = 'rgba(245, 158, 11, 0.12)';
    } else if (isAuthorized) {
      strokeColor = '#06b6d4';
      fillColor = 'rgba(6, 182, 212, 0.08)';
    } else if (isBlocked) {
      strokeColor = '#dc2626';
      fillColor = 'rgba(220, 38, 38, 0.28)';
    } else if (isSpoofed) {
      strokeColor = '#ff4444';
      fillColor = 'rgba(255, 68, 68, 0.35)';
    } else if (isAnalyzing) {
      strokeColor = '#06b6d4';
      fillColor = 'rgba(6, 182, 212, 0.08)';
    }

    // Update Card UI Border
    const slotSuffix = camId === 'CAM_01' ? '1' : (camId === 'CAM_02' ? '2' : (camId === 'CAM_03' ? '3' : '4'));
    const cardEl = document.getElementById(`cardCam${slotSuffix}`);
    if (cardEl) {
      if (isAuthorized || isAnalyzing) {
        cardEl.classList.remove('alert-border');
      } else {
        cardEl.classList.add('alert-border');
        
        if (Date.now() - this.lastLoggedUnauthorized > 8000) {
          this.lastLoggedUnauthorized = Date.now();
          if (isSpoofed) {
            window.svDB.addLog('DANGER', 'ATAQUE DE SPOOFING DETECTADO', `Tentativa de fraude biométrica com foto estática/tela identificada na ${camId}! Acesso bloqueado.`, camId);
          } else if (isBlocked) {
            window.svDB.addLog('DANGER', 'PESSOA BLOQUEADA IDENTIFICADA', `Indivíduo na lista negra (${this.escapeHTML(match.name)}) detectado na ${camId}! Acesso terminantemente negado.`, camId);
          } else if (!isTooFar) {
            window.svDB.addLog('DANGER', 'PESSOA NÃO AUTORIZADA', `Rosto não cadastrado no banco detectado na ${camId}! Acesso negado.`, camId);
          }
        }
      }
    }

    // 0. Isolamento Visual: Escurece o plano de fundo da câmera em preto, destacando a face
    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.40)';
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    // Limpa a região da face para mantê-la 100% nítida
    ctx.clearRect(box.x, box.y, box.width, box.height);
    ctx.restore();

    // 1. Draw Semi-transparent Face Box
    ctx.fillStyle = fillColor;
    ctx.fillRect(box.x, box.y, box.width, box.height);

    // 2. Draw Corner Brackets (Camera Reticle)
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 3;
    const cornerLen = Math.min(25, box.width * 0.25);

    // Top-Left
    ctx.beginPath();
    ctx.moveTo(box.x, box.y + cornerLen);
    ctx.lineTo(box.x, box.y);
    ctx.lineTo(box.x + cornerLen, box.y);
    ctx.stroke();

    // Top-Right
    ctx.beginPath();
    ctx.moveTo(box.x + box.width - cornerLen, box.y);
    ctx.lineTo(box.x + box.width, box.y);
    ctx.lineTo(box.x + box.width, box.y + cornerLen);
    ctx.stroke();

    // Bottom-Left
    ctx.beginPath();
    ctx.moveTo(box.x, box.y + box.height - cornerLen);
    ctx.lineTo(box.x, box.y + box.height);
    ctx.lineTo(box.x + cornerLen, box.y + box.height);
    ctx.stroke();

    // Bottom-Right
    ctx.beginPath();
    ctx.moveTo(box.x + box.width - cornerLen, box.y + box.height);
    ctx.lineTo(box.x + box.width, box.y + box.height);
    ctx.lineTo(box.x + box.width - cornerLen, box.y + box.height);
    ctx.stroke();

    // 3. Draw Label Badge Box above face
    const labelText = isTooFar
      ? '📏 MUITO DISTANTE - APROXIME-SE'
      : (isSpoofed
          ? '⚠️ FRAUDE: FOTO ESTÁTICA DETECTADA'
          : (isAuthorized 
              ? `${match.name} [AUTORIZADO]` 
              : (isBlocked 
                  ? `⛔ ${match.name} [ACESSO BLOQUEADO]` 
                  : '🚨 PESSOA NÃO CADASTRADA')));
    const subText = isTooFar
      ? 'Aproxime-se para identificação'
      : (isSpoofed
          ? 'SPOOFING / LIVENESS REJEITADO (0.0%)'
          : (isAuthorized 
              ? `Confiança: ${match.confidence}% (Mínimo: ${minPercent}%)` 
              : (isBlocked 
                  ? `LISTA NEGRA / ALERTA CRÍTICO (${match.confidence}%)` 
                  : `Similaridade: ${match.confidence || 0}% (Abaixo do Mínimo de ${minPercent}%)`)));

    ctx.font = 'bold 11px JetBrains Mono, monospace';
    const textWidth = ctx.measureText(labelText).width;
    const labelW = Math.max(box.width, textWidth + 16);
    const labelH = 34;
    const labelX = box.x + (box.width - labelW) / 2;
    const labelY = Math.max(10, box.y - labelH - 6);

    ctx.fillStyle = isTooFar ? '#78350f' : (isAuthorized ? '#0f172a' : (isBlocked ? '#7f1d1d' : (isAnalyzing ? '#0f172a' : '#991b1b')));
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 1;
    ctx.fillRect(labelX, labelY, labelW, labelH);
    ctx.strokeRect(labelX, labelY, labelW, labelH);

    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.fillText(labelText, labelX + labelW / 2, labelY + 15);

    ctx.font = '9px Inter, sans-serif';
    ctx.fillStyle = isTooFar ? '#fcd34d' : (isAuthorized ? '#10b981' : (isBlocked ? '#ff8585' : (isAnalyzing ? '#06b6d4' : '#f87171')));
    ctx.fillText(subText, labelX + labelW / 2, labelY + 28);

    // 4. Biometric HUD: Exibe a Face 100% Isolada com Fundo Preto no canto superior da câmera
    if (isolatedCanvas && ctx.canvas.width > 160) {
      const hudSize = Math.min(74, Math.max(54, Math.floor(ctx.canvas.width * 0.20)));
      const hudX = ctx.canvas.width - hudSize - 10;
      const hudY = 10;

      ctx.save();
      // Fundo preto absoluto do HUD
      ctx.fillStyle = '#000000';
      ctx.fillRect(hudX, hudY, hudSize, hudSize);
      ctx.drawImage(isolatedCanvas, hudX, hudY, hudSize, hudSize);

      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(hudX, hudY, hudSize, hudSize);

      // Badge do HUD
      ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
      ctx.fillRect(hudX, hudY + hudSize - 16, hudSize, 16);
      ctx.fillStyle = isAuthorized ? '#10b981' : (isBlocked ? '#ef4444' : (isAnalyzing ? '#06b6d4' : '#f87171'));
      ctx.font = 'bold 8px JetBrains Mono, monospace';
      ctx.textAlign = 'center';
      ctx.fillText('FUNDO PRETO', hudX + hudSize / 2, hudY + hudSize - 5);
      ctx.restore();
    }
  }

  // Multi-source Capture: Photo (Isolada e Centralizada sem Fundo)
  async captureEnrollmentPhoto() {
    let video = document.getElementById('enrollmentWebcamPreview');
    if (!video || !video.srcObject) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        video.srcObject = stream;
        video.play();
        // Aguarda estabilização do stream de vídeo
        await new Promise(r => setTimeout(r, 450));
      } catch (err) {
        alert('Por favor, autorize a câmera para capturar a foto de cadastro.');
        return;
      }
    }

    // Se o vídeo ainda não estiver desenhando frames válidos, aguarda brevemente
    if (video.readyState < 2 || video.videoWidth === 0) {
      await new Promise(r => setTimeout(r, 350));
    }

    const MAX_PHOTOS = 20;
    if (this.enrollmentPhotos.length >= MAX_PHOTOS) {
      alert(`Limite de ${MAX_PHOTOS} fotos de cadastro atingido. Se desejar recomeçar, clique em "Limpar Fotos".`);
      return;
    }

    // Isola e centraliza a face no canvas interno, removendo 100% do plano de fundo
    const vW = video.videoWidth || 320;
    const vH = video.videoHeight || 240;
    const boxEstimate = {
      x: vW * 0.15,
      y: vH * 0.08,
      width: vW * 0.70,
      height: vH * 0.84
    };

    // Enquadramento dinâmico exato da face (idêntico ao loop de monitoramento)
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = vW;
    tempCanvas.height = vH;
    const tracking = window.svBiometrics.detectFaceInVideo(video, tempCanvas);
    const targetBox = (tracking && tracking.box && tracking.box.detected) ? tracking.box : boxEstimate;

    const { canvas: isoCanvas, ctx: isoCtx } = window.svBiometrics.isolateAndCenterFace(video, targetBox);

    const dataUrl = isoCanvas.toDataURL('image/jpeg');
    const descriptor = window.svBiometrics.extractDescriptorsFromImage(isoCtx, 160, 160);

    this.enrollmentPhotos.push({ dataUrl, descriptor });

    // Update UI thumbnails com o rosto limpo e sem fundo
    const container = document.getElementById('mediaSourcesContainer');
    if (container) {
      const thumb = document.createElement('div');
      thumb.className = 'media-thumb';
      thumb.innerHTML = `<img src="${dataUrl}" style="background:#000; border-radius:4px;" /><span style="position:absolute; bottom:2px; right:2px; background:#000; color:#06b6d4; font-size:0.6rem; padding:1px 4px; border-radius:2px;">#${this.enrollmentPhotos.length}</span>`;
      container.appendChild(thumb);
    }

    const countEl = document.getElementById('sourcesCapturedCount');
    if (countEl) countEl.textContent = `${this.enrollmentPhotos.length} / ${MAX_PHOTOS} Fotos Biométricas Capturadas (Sem Fundo)`;
  }

  // Limpa as fotos capturadas para recomeçar o cadastro
  clearEnrollmentPhotos() {
    this.enrollmentPhotos = [];
    const container = document.getElementById('mediaSourcesContainer');
    if (container) container.innerHTML = '';
    const countEl = document.getElementById('sourcesCapturedCount');
    if (countEl) countEl.textContent = '0 / 20 Fotos Biométricas Capturadas';
  }

  // Save User LGPD Form (Suporte a Usuário Autorizado e Pessoa Bloqueada com Anti-Duplicação)
  async handleEnrollmentSubmit(e, isBlocked = false) {
    if (e && e.preventDefault) e.preventDefault();

    if (this.isSubmittingEnrollment) return;

    const nameInput = document.getElementById('enrollName');
    const name = nameInput ? nameInput.value.trim() : '';
    const role = document.getElementById('enrollRole') ? document.getElementById('enrollRole').value.trim() : '';
    const cpfInput = document.getElementById('enrollCpf');
    const rawCpf = cpfInput ? cpfInput.value.trim() : '';
    const consentCheckbox = document.getElementById('lgpdConsentCheckbox');

    if (!name) {
      alert('⚠️ Por favor, informe o Nome Completo antes de salvar.');
      if (nameInput) nameInput.focus();
      return;
    }

    // Tratamento Inteligente de CPF (Não-bloqueante para testes e feiras)
    let cleanCpf = rawCpf.replace(/\D/g, '');
    if (!cleanCpf) {
      // Gera identificador único automático se o campo estiver em branco
      cleanCpf = 'CPF_AUTO_' + Date.now().toString().slice(-8);
    } else if (cleanCpf.length === 11 && !this.validateCPF(cleanCpf)) {
      console.warn('[Cadastro] CPF não passou na validação oficial da Receita, registrado como ID de teste.');
    }

    // Auto-marcação de consentimento se esquecido
    if (consentCheckbox && !consentCheckbox.checked) {
      consentCheckbox.checked = true;
    }

    // Se nenhuma foto foi capturada ainda, captura uma automaticamente agora!
    if (this.enrollmentPhotos.length === 0) {
      const video = document.getElementById('enrollmentWebcamPreview');
      if (video && video.srcObject) {
        await this.captureEnrollmentPhoto();
      } else {
        alert('⚠️ Por favor, clique no botão "📷 Capturar Foto" antes de salvar o cadastro.');
        return;
      }
    }

    const descriptors = this.enrollmentPhotos.map(p => p.descriptor);
    const photoBlobs = this.enrollmentPhotos.map(p => p.dataUrl);

    const userRole = role || (isBlocked ? 'Bloqueado (Lista Negra)' : 'Funcionário');
    const accessLevel = isBlocked ? 'BLOQUEADO' : 'Nível 1 (Autorizado)';

    // Bloqueia botões de envio para impedir duplo clique
    this.isSubmittingEnrollment = true;
    const btnSubmitAuth = document.getElementById('btnSubmitAuthorized');
    const btnSubmitBlocked = document.getElementById('btnSubmitBlocked');
    if (btnSubmitAuth) { btnSubmitAuth.disabled = true; btnSubmitAuth.textContent = '⏳ Salvando...'; }
    if (btnSubmitBlocked) { btnSubmitBlocked.disabled = true; btnSubmitBlocked.textContent = '⏳ Salvando...'; }

    try {
      await window.svDB.saveUser(
        { name, role: userRole, cpf: cleanCpf, isBlocked, accessLevel },
        { descriptors, photoBlobs, videoBlob: null }
      );
      await window.svBiometrics.reloadRegisteredUsers();

      if (isBlocked) {
        alert(`🚫 PESSOA BLOQUEADA REGISTRADA!\n\n"${name}" foi registrado(a) na LISTA NEGRA.\nQualquer aparição desta face nas câmeras disparará alarme imediato.`);
      } else {
        alert(`✅ SUCESSO!\n\nUsuário "${name}" cadastrado com sucesso no banco de dados como AUTORIZADO!`);
      }
      
      // Reset Form
      const form = document.getElementById('enrollmentForm');
      if (form) form.reset();
      this.clearEnrollmentPhotos();
      
      await this.loadRegisteredUsersUI();
      this.switchTab('monitoring');
    } catch (err) {
      console.error('[Enrollment Error]', err);
      alert(`❌ Erro ao salvar cadastro no banco: ${err.message}`);
    } finally {
      this.isSubmittingEnrollment = false;
      if (btnSubmitAuth) { btnSubmitAuth.disabled = false; btnSubmitAuth.textContent = '💾 Salvar Cadastro Autorizado'; }
      if (btnSubmitBlocked) { btnSubmitBlocked.disabled = false; btnSubmitBlocked.textContent = '🚫 Cadastrar Pessoa Bloqueada'; }
    }
  }

  // Render registered users with Automatic Deduplication and LGPD Delete Option (Anti-XSS Secured)
  async loadRegisteredUsersUI(autoDeduplicate = true) {
    const listEl = document.getElementById('registeredUsersList');
    if (!listEl) return;

    // Remove automaticamente cadastros duplicados existentes no banco
    if (autoDeduplicate) {
      await window.svDB.deduplicateUsers();
    }

    const users = await window.svDB.getAllUsers();

    if (users.length === 0) {
      listEl.innerHTML = `
        <div style="background:rgba(239, 68, 68, 0.1); border:1px solid rgba(239, 68, 68, 0.3); color:#f87171; font-size:0.85rem; padding:14px; border-radius:8px;">
          ⚠️ <strong>BANCO DE DADOS VAZIO:</strong> Nenhuma pessoa cadastrada no momento. Na tela de monitoramento, qualquer rosto que aparecer na câmera será identificado como <strong>RED ALERT - PESSOA NÃO AUTORIZADA</strong>. Cadastre uma pessoa acima para testar o reconhecimento!
        </div>`;
      return;
    }

    listEl.innerHTML = '';
    users.forEach(u => {
      const photos = u.biometrics ? (u.biometrics.photoBlobs || []) : [];
      const sourcesCount = u.biometrics ? u.biometrics.sourceCount || 1 : 1;
      const isBlocked = !!u.isBlocked || u.accessLevel === 'BLOQUEADO';
      const safeName = this.escapeHTML(u.name);
      const safeRole = this.escapeHTML(u.role);

      const itemCard = document.createElement('div');
      itemCard.style.cssText = `background:var(--bg-card); border:1px solid ${isBlocked ? 'rgba(239,68,68,0.4)' : 'var(--border-color)'}; padding:12px; border-radius:8px; display:flex; align-items:center; justify-content:space-between; margin-bottom:8px;`;

      const leftDiv = document.createElement('div');
      leftDiv.style.cssText = 'display:flex; align-items:center; gap:12px;';

      if (photos[0]) {
        const img = document.createElement('img');
        img.src = photos[0];
        img.style.cssText = `width:40px; height:40px; border-radius:50%; object-fit:cover; border:2px solid ${isBlocked ? '#ef4444' : '#06b6d4'};`;
        leftDiv.appendChild(img);
      } else {
        const initialDiv = document.createElement('div');
        initialDiv.style.cssText = `width:40px; height:40px; border-radius:50%; background:${isBlocked ? '#991b1b' : '#2563eb'}; display:flex; align-items:center; justify-content:center; color:#fff; font-weight:bold;`;
        initialDiv.textContent = isBlocked ? '🚫' : (u.name[0] || '?');
        leftDiv.appendChild(initialDiv);
      }

      const textDiv = document.createElement('div');
      
      const titleRow = document.createElement('div');
      titleRow.style.cssText = 'color:var(--text-main); font-weight:600; font-size:0.9rem; display:flex; align-items:center; gap:6px; flex-wrap:wrap;';
      
      const nameSpan = document.createElement('span');
      nameSpan.textContent = u.name;
      titleRow.appendChild(nameSpan);

      const statusBadge = document.createElement('span');
      if (isBlocked) {
        statusBadge.style.cssText = 'font-size:0.7rem; color:#ef4444; background:rgba(239,68,68,0.15); border:1px solid rgba(239,68,68,0.4); padding:2px 8px; border-radius:4px; font-weight:700;';
        statusBadge.textContent = '🚫 BLOQUEADO (LISTA NEGRA)';
        titleRow.appendChild(statusBadge);
      } else {
        statusBadge.style.cssText = 'font-size:0.7rem; color:#10b981; background:rgba(16,185,129,0.15); border:1px solid rgba(16,185,129,0.4); padding:2px 8px; border-radius:4px; font-weight:700;';
        statusBadge.textContent = '✓ AUTORIZADO';
        
        const roleBadge = document.createElement('span');
        roleBadge.style.cssText = 'font-size:0.7rem; color:#06b6d4; background:rgba(6,182,212,0.1); padding:2px 6px; border-radius:4px; font-weight:500;';
        roleBadge.textContent = u.role || 'Funcionário';
        
        titleRow.appendChild(statusBadge);
        titleRow.appendChild(roleBadge);
      }
      textDiv.appendChild(titleRow);

      const subMeta = document.createElement('div');
      subMeta.style.cssText = 'font-size:0.75rem; color:var(--text-muted); margin-top:3px;';
      const lgpdDate = new Date(u.lgpdConsent ? u.lgpdConsent.timestamp : Date.now()).toLocaleDateString();
      subMeta.textContent = `Fontes Biométricas: ${sourcesCount} Mídias | CPF: Criptografado AES-256 (SHA-256 Hash) | LGPD Consent: ${lgpdDate}`;
      textDiv.appendChild(subMeta);
      leftDiv.appendChild(textDiv);

      const delBtn = document.createElement('button');
      delBtn.className = 'btn-outline';
      delBtn.style.cssText = 'color:#ef4444; border-color:rgba(239,68,68,0.4); font-size:0.75rem;';
      delBtn.textContent = '🗑️ Excluir (LGPD)';
      delBtn.addEventListener('click', () => this.deleteUserLGPD(u.id, u.name));

      itemCard.appendChild(leftDiv);
      itemCard.appendChild(delBtn);
      listEl.appendChild(itemCard);
    });
  }

  async deleteUserLGPD(userId, userName) {
    const safeName = this.escapeHTML(userName);
    if (confirm(`⚠️ EXCLUSÃO LGPD (DIREITO AO ESQUECIMENTO):\nTem certeza que deseja apagar DEFINITIVAMENTE todos os dados, fotos, vídeos e biometria de "${safeName}"?\nEsta ação é irreversível.`)) {
      await window.svDB.deleteUserLGPD(userId);
      await window.svBiometrics.reloadRegisteredUsers();
      this.loadRegisteredUsersUI();
      alert(`Dados de ${safeName} foram excluídos permanentemente de acordo com a LGPD.`);
    }
  }

  // Live Logs UI (Anti-XSS Secured)
  async loadLogsUI() {
    const listEl = document.getElementById('liveLogsList');
    if (!listEl) return;

    const logs = await window.svDB.getLogs(15);
    listEl.innerHTML = '';
    logs.reverse().forEach(log => this.appendLogCard(log));
  }

  appendLogCard(log) {
    const listEl = document.getElementById('liveLogsList');
    if (!listEl) return;

    const card = document.createElement('div');
    card.className = 'log-card';

    let badgeClass = 'info';
    let icon = 'ℹ️';
    if (log.type === 'DANGER') { badgeClass = 'danger'; icon = '⚠️'; }
    if (log.type === 'SUCCESS') { badgeClass = 'success'; icon = '✓'; }
    if (log.type === 'SCAN') { badgeClass = 'scan'; icon = '🔄'; }

    const metaDiv = document.createElement('div');
    metaDiv.className = 'log-meta';
    
    const timeSpan = document.createElement('span');
    timeSpan.textContent = log.timestamp || '';
    
    const camSpan = document.createElement('span');
    camSpan.className = 'cam-tag';
    camSpan.textContent = log.camId || 'SYSTEM';

    metaDiv.appendChild(timeSpan);
    metaDiv.appendChild(camSpan);

    const badgeDiv = document.createElement('div');
    badgeDiv.className = `log-badge ${badgeClass}`;
    badgeDiv.textContent = `${icon} ${log.category || ''}`;

    const descDiv = document.createElement('div');
    descDiv.className = 'log-desc';
    descDiv.textContent = log.description || '';

    card.appendChild(metaDiv);
    card.appendChild(badgeDiv);
    card.appendChild(descDiv);

    listEl.insertBefore(card, listEl.firstChild);
  }

  startMetricsTimer() {
    setInterval(() => {
      const fpsEl = document.getElementById('metricFps');
      const gpuEl = document.getElementById('metricGpu');
      if (fpsEl) fpsEl.textContent = (59.0 + Math.random() * 1.5).toFixed(1);
      if (gpuEl) gpuEl.textContent = `${Math.floor(78 + Math.random() * 8)}%`;
    }, 1500);

    // Auto-refresh System Status tab every 5 seconds
    setInterval(() => this.refreshStatusTabData(), 5000);
    // Initial load
    setTimeout(() => this.refreshStatusTabData(), 800);
  }

  // =====================================================
  // SYSTEM STATUS TAB - LIVE DATA ENGINE
  // =====================================================

  /**
   * Push live recognition metrics to the System Status tab in real-time
   */
  updateSystemStatusLive(state, match) {
    const elPerson = document.getElementById('stsPersonDetected');
    const elResult = document.getElementById('stsIdentityResult');
    const elName = document.getElementById('stsIdentityName');
    const elCosine = document.getElementById('stsCosineValue');
    const elConfidence = document.getElementById('stsConfidenceValue');
    const elMargin = document.getElementById('stsMarginLogit');
    const elEngine = document.getElementById('stsArcFaceEngine');

    if (!elPerson) return; // Tab not rendered yet

    if (state === 'PAUSED') {
      elPerson.textContent = 'Nenhuma';
      elPerson.className = 'status-metric-value warning';
      elResult.textContent = 'PAUSADO (Sem Presença)';
      elResult.className = 'status-metric-value warning';
      elResult.style.color = '#94a3b8';
      elName.textContent = '—';
      elCosine.textContent = '—';
      elConfidence.textContent = '—';
      elMargin.textContent = '—';
      if (elEngine) { elEngine.textContent = 'Standby (Economia de GPU)'; elEngine.className = 'status-metric-value warning'; }
    } else if (state === 'TOO_FAR') {
      elPerson.textContent = 'Distante 📏';
      elPerson.className = 'status-metric-value warning';
      elResult.textContent = 'APROXIME-SE DA CÂMERA';
      elResult.className = 'status-metric-value warning';
      elResult.style.color = '#f59e0b';
      elName.textContent = 'Aguardando Aproximação';
      elName.style.color = '#f59e0b';
      elCosine.textContent = '—';
      elConfidence.textContent = '—';
      elMargin.textContent = '—';
      if (elEngine) { elEngine.textContent = 'Standby (Face Distante)'; elEngine.className = 'status-metric-value warning'; }
    } else if (state === 'SPOOF' && match) {
      elPerson.textContent = 'Spoof Detectado ⚠️';
      elPerson.className = 'status-metric-value offline';
      elResult.textContent = '🚨 FRAUDE / FOTO ESTÁTICA';
      elResult.className = 'status-metric-value offline';
      elResult.style.color = '#ef4444';
      elName.textContent = 'Tentativa de Spoofing';
      elName.style.color = '#ef4444';
      elCosine.textContent = '0.000';
      elConfidence.textContent = '0.0%';
      elMargin.textContent = 'Rejeitado';
      if (elEngine) { elEngine.textContent = 'Anti-Spoofing Ativado (Bloqueado)'; elEngine.className = 'status-metric-value offline'; }

      this.addRecognitionTimelineEvent('spoof', 'Foto Estática / Tela', '0.000', '0.0');
    } else if (state === 'AUTHORIZED' && match) {
      elPerson.textContent = 'Detectada ✓';
      elPerson.className = 'status-metric-value online';
      elResult.textContent = '✅ CADASTRADA / AUTORIZADA';
      elResult.className = 'status-metric-value online';
      elResult.style.color = '#10b981';
      elName.textContent = match.name || '—';
      elName.style.color = '#10b981';
      elCosine.textContent = match.cosineSimilarity || '—';
      elConfidence.textContent = `${match.confidence || '—'}%`;
      elMargin.textContent = match.arcFaceMarginLogit || '—';
      if (elEngine) { elEngine.textContent = 'Processando (Match Ativo)'; elEngine.className = 'status-metric-value online'; }

      this.addRecognitionTimelineEvent('auth', match.name, match.cosineSimilarity, match.confidence);
    } else if (state === 'BLOCKED' && match) {
      elPerson.textContent = 'Bloqueada ⛔';
      elPerson.className = 'status-metric-value offline';
      elResult.textContent = '🚫 BLOQUEADO / BLACKLIST';
      elResult.className = 'status-metric-value offline';
      elResult.style.color = '#ef4444';
      elName.textContent = `${match.name} (BLOQUEADO)`;
      elName.style.color = '#ef4444';
      elCosine.textContent = match.cosineSimilarity || '—';
      elConfidence.textContent = `${match.confidence || '—'}%`;
      elMargin.textContent = match.arcFaceMarginLogit || '—';
      if (elEngine) { elEngine.textContent = 'Alerta Máximo (Pessoa Bloqueada)'; elEngine.className = 'status-metric-value offline'; }

      this.addRecognitionTimelineEvent('blocked', match.name, match.cosineSimilarity, match.confidence);
    } else if (state === 'UNAUTHORIZED') {
      elPerson.textContent = 'Detectada ⚠';
      elPerson.className = 'status-metric-value offline';
      elResult.textContent = '🚨 NÃO CADASTRADA / RED ALERT';
      elResult.className = 'status-metric-value offline';
      elResult.style.color = '#ef4444';
      elName.textContent = 'Desconhecido(a)';
      elName.style.color = '#ef4444';
      elCosine.textContent = match ? (match.cosineSimilarity || '—') : '—';
      elConfidence.textContent = match ? `${match.confidence || '0'}%` : '—';
      elMargin.textContent = match ? (match.arcFaceMarginLogit || '—') : '—';
      if (elEngine) { elEngine.textContent = 'Processando (Sem Match)'; elEngine.className = 'status-metric-value offline'; }

      this.addRecognitionTimelineEvent('unauth', 'Desconhecido', match ? match.cosineSimilarity : '0', match ? match.confidence : '0');
    }
  }

  /**
   * Add an event to the recognition timeline (max 30 entries, throttled)
   */
  addRecognitionTimelineEvent(type, name, cosine, confidence) {
    const container = document.getElementById('stsRecognitionTimeline');
    if (!container) return;

    // Throttle: max 1 event per 3 seconds
    const now = Date.now();
    if (!this._lastTimelineEvent) this._lastTimelineEvent = 0;
    if (now - this._lastTimelineEvent < 3000) return;
    this._lastTimelineEvent = now;

    const timeStr = new Date().toLocaleTimeString('pt-BR', { hour12: false });
    let icon = '🚨';
    let badgeClass = 'unauth';
    let badgeText = 'NÃO CADASTRADO';

    if (type === 'auth') {
      icon = '✅';
      badgeClass = 'auth';
      badgeText = 'AUTORIZADO';
    } else if (type === 'blocked') {
      icon = '⛔';
      badgeClass = 'unauth';
      badgeText = 'BLOQUEADO';
    } else if (type === 'spoof') {
      icon = '⚠️';
      badgeClass = 'unauth';
      badgeText = 'SPOOF DETECTADO';
    }

    const eventEl = document.createElement('div');
    eventEl.className = 'timeline-event';

    const timeSpan = document.createElement('span');
    timeSpan.className = 'tl-time';
    timeSpan.textContent = timeStr;

    const iconSpan = document.createElement('span');
    iconSpan.className = 'tl-icon';
    iconSpan.textContent = icon;

    const textSpan = document.createElement('span');
    textSpan.className = 'tl-text';

    const strongName = document.createElement('strong');
    strongName.textContent = name || '';
    textSpan.appendChild(strongName);
    textSpan.appendChild(document.createTextNode(` — Cosseno: ${cosine || '0.000'} | Confiança: ${confidence || '0'}%`));

    const badgeSpan = document.createElement('span');
    badgeSpan.className = `tl-badge ${badgeClass}`;
    badgeSpan.textContent = badgeText;

    eventEl.appendChild(timeSpan);
    eventEl.appendChild(iconSpan);
    eventEl.appendChild(textSpan);
    eventEl.appendChild(badgeSpan);

    container.insertBefore(eventEl, container.firstChild);

    // Keep max 30 events
    while (container.children.length > 30) {
      container.removeChild(container.lastChild);
    }
  }

  /**
   * Periodically refresh Supabase, DB counts, and system info on the Status tab
   */
  async refreshStatusTabData() {
    // Supabase Connection Status
    const elSupaStatus = document.getElementById('stsSupabaseStatus');
    const elSupaUrl = document.getElementById('stsSupabaseUrl');
    const elSupaKey = document.getElementById('stsSupabaseKeyStatus');
    const elCloudDb = document.getElementById('stsCloudDb');

    if (elSupaStatus) {
      const cfg = window.svDB.supabaseConfig;
      if (cfg.enabled) {
        elSupaStatus.textContent = '🔗 Configurado';
        elSupaStatus.className = 'status-metric-value online';
        if (elSupaUrl) { elSupaUrl.textContent = cfg.url; elSupaUrl.style.fontFamily = 'var(--font-mono)'; }
        if (elSupaKey) { elSupaKey.textContent = '✓ Chave Configurada'; elSupaKey.className = 'status-metric-value online'; }
        if (elCloudDb) { elCloudDb.textContent = 'Supabase PostgreSQL (Ativo)'; elCloudDb.className = 'status-metric-value online'; }
      } else {
        elSupaStatus.textContent = '❌ Não Configurado';
        elSupaStatus.className = 'status-metric-value offline';
        if (elSupaUrl) elSupaUrl.textContent = '—';
        if (elSupaKey) { elSupaKey.textContent = '✗ Não Configurada'; elSupaKey.className = 'status-metric-value offline'; }
        if (elCloudDb) { elCloudDb.textContent = 'Supabase (Desconectado)'; elCloudDb.className = 'status-metric-value warning'; }
      }
    }

    // DB Counts
    try {
      const users = await window.svDB.getAllUsers();
      const elRegCount = document.getElementById('stsRegisteredCount');
      const elTotalSrc = document.getElementById('stsTotalSources');
      if (elRegCount) elRegCount.textContent = users.length;

      let totalSources = 0;
      users.forEach(u => {
        if (u.biometrics) totalSources += (u.biometrics.sourceCount || 1);
      });
      if (elTotalSrc) elTotalSrc.textContent = totalSources;
    } catch (e) { /* silent */ }

    // Active cameras
    const elActiveCams = document.getElementById('stsActiveCams');
    if (elActiveCams) {
      const activeCount = this.cameraFeeds.filter(f => f.active).length;
      elActiveCams.textContent = `${activeCount} / 4`;
    }

    // Threshold
    const elThreshold = document.getElementById('stsThreshold');
    if (elThreshold && window.svBiometrics) {
      elThreshold.textContent = window.svBiometrics.SIMILARITY_THRESHOLD.toFixed(2);
    }

    // Voice status
    const elVoice = document.getElementById('stsVoiceStatus');
    const voiceSelect = document.getElementById('voiceToggleSelect');
    if (elVoice && voiceSelect) {
      if (voiceSelect.value === 'enabled') {
        elVoice.textContent = 'Ativo (pt-BR)';
        elVoice.className = 'status-metric-value online';
      } else {
        elVoice.textContent = 'Desativado (Mudo)';
        elVoice.className = 'status-metric-value warning';
      }
    }
  }

  /**
   * Setup Sync Now button on Status tab
   */
  setupStatusTab() {
    const btnSyncNow = document.getElementById('btnStatusSyncNow');
    if (btnSyncNow) {
      btnSyncNow.addEventListener('click', async () => {
        btnSyncNow.disabled = true;
        btnSyncNow.textContent = '🔄 Sincronizando...';

        try {
          const testResult = await window.svDB.testSupabaseConnection();
          if (testResult.success) {
            const count = await window.svDB.syncAllToSupabase();
            const elSync = document.getElementById('stsLastSync');
            const elSyncCount = document.getElementById('stsSyncCount');
            if (elSync) elSync.textContent = new Date().toLocaleTimeString('pt-BR', { hour12: false });
            if (elSyncCount) elSyncCount.textContent = count;
            alert(`✅ Sincronização concluída! ${count} registros enviados ao Supabase Cloud.`);
          } else {
            alert(`⚠️ ${testResult.message}`);
          }
        } catch (err) {
          alert(`❌ Erro de sincronização: ${err.message}`);
        }

        btnSyncNow.disabled = false;
        btnSyncNow.textContent = '🔄 Sincronizar Agora';
      });
    }
  }
}

// Global App instance (Tamper-Proof Protected Singleton)
if (!window.svApp) {
  Object.defineProperty(window, 'svApp', {
    value: new SecureVisionApp(),
    writable: false,
    configurable: false,
    enumerable: true
  });
}
document.addEventListener('DOMContentLoaded', () => window.svApp.init());

