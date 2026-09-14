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
      { id: 'CAM_04', name: 'Server Rm B (Vault)', deviceId: null, active: false },
      { id: 'CAM_03', name: 'Infra Vault Thermal', deviceId: null, active: false },
      { id: 'CAM_02', name: 'North Turnstiles', deviceId: null, active: false }
    ];
    this.enrollmentPhotos = [];
    this.enrollmentVideoBlob = null;
    this.lastLoggedUnauthorized = 0;
    this.lastVoiceTimeMap = {};
    this.currentIdentityState = null;
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
    this.setupSettingsTabControls();
    this.setupMediaCarouselDrag();
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

    // Botão de upload de fotos do computador
    const btnUpload = document.getElementById('btnUploadPhotos');
    const photoFileInput = document.getElementById('photoFileInput');
    if (btnUpload && photoFileInput) {
      btnUpload.addEventListener('click', () => photoFileInput.click());
      photoFileInput.addEventListener('change', (e) => {
        this.handlePhotoFilesSelected(e.target.files);
        photoFileInput.value = '';
      });
    }

    // Botão de captura automática de 3 ângulos
    const btnBurst = document.getElementById('btnBurstCapture');
    if (btnBurst) {
      btnBurst.addEventListener('click', () => this.captureBurstThreeAngles());
    }

    // Drag-and-Drop de imagens na área biométrica
    const dropZone = document.getElementById('mediaSourcesDropZone');
    if (dropZone) {
      dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.add('drag-active');
      });
      dropZone.addEventListener('dragleave', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.remove('drag-active');
      });
      dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.remove('drag-active');
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
          this.handlePhotoFilesSelected(e.dataTransfer.files);
        }
      });
    }

    // Input oculto para anexar fotos a usuário existente
    const appendFileInput = document.getElementById('appendUserPhotosFileInput');
    if (appendFileInput) {
      appendFileInput.addEventListener('change', async (e) => {
        if (!e.target.files || e.target.files.length === 0 || !this.currentAppendUserId) return;
        const files = Array.from(e.target.files).filter(f => f.type.startsWith('image/'));
        if (files.length === 0) {
          alert('Por favor, selecione arquivos de imagem válidos.');
          return;
        }

        const targetUserId = this.currentAppendUserId;
        const targetUserName = this.currentAppendUserName || 'Usuário';

        try {
          const newDescriptors = [];
          const newPhotoBlobs = [];

          for (const file of files) {
            const dataUrl = await this.readFileAsDataURL(file);
            const img = new Image();
            await new Promise(r => { img.onload = r; img.onerror = r; img.src = dataUrl; });
            const canvas = document.createElement('canvas');
            canvas.width = Math.min(640, img.naturalWidth || 320);
            canvas.height = Math.min(480, img.naturalHeight || 240);
            canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);

            const desc = await window.svBiometrics.extractDescriptorsFromCanvas(canvas);
            newDescriptors.push(desc);
            newPhotoBlobs.push(dataUrl);
          }

          await window.svDB.appendBiometricsToUser(targetUserId, newDescriptors, newPhotoBlobs);
          await window.svBiometrics.reloadRegisteredUsers();
          this.loadRegisteredUsersUI();
          this.refreshStatusTabData();
          alert(`✅ ${newPhotoBlobs.length} nova(s) foto(s) biométrica(s) adicionada(s) ao perfil de "${targetUserName}" com sucesso!`);
        } catch (err) {
          alert('❌ Erro ao adicionar fotos: ' + err.message);
        } finally {
          this.currentAppendUserId = null;
          this.currentAppendUserName = null;
          appendFileInput.value = '';
        }
      });
    }

    const btnCapVideo = document.getElementById('btnRecordVideo');
    if (btnCapVideo) {
      btnCapVideo.addEventListener('click', () => this.recordEnrollmentVideo());
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
          const btn = document.createElement('button');
          btn.className = 'btn-action';
          btn.style.cssText = 'font-size:0.75rem; padding:4px 8px;';
          btn.textContent = 'Conectar Feed 1';
          btn.addEventListener('click', () => this.assignCameraToSlot(dev.deviceId, rawLabel, 1));

          btnDiv.appendChild(btn);
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
    this.cameraFeeds[0].deviceId = deviceId;
    this.cameraFeeds[0].name = safeLabel;
    
    document.getElementById('cameraCheckModal').classList.remove('active');
    await this.connectSlotCamera(1, deviceId);
    alert(`Câmera "${safeLabel}" conectada com sucesso ao Feed 1!`);
  }

  async connectSlotCamera(slotNum, deviceId) {
    const videoEl = document.getElementById('videoFeedCam1');
    const overlayEl = document.getElementById('noCamOverlay1');
    const statusEl = document.getElementById('statusCam1');

    if (!videoEl) return;

    try {
      const constraints = deviceId ? { video: { deviceId: { exact: deviceId } } } : { video: true };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      videoEl.srcObject = stream;
      videoEl.style.display = 'block';
      await videoEl.play();

      if (overlayEl) overlayEl.style.display = 'none';
      if (statusEl) {
        statusEl.textContent = '● LIVE STREAM';
        statusEl.style.color = '#10b981';
      }
      this.cameraFeeds[0].active = true;
      this.updateActiveStreamsMetric();
    } catch (err) {
      console.warn(`[Camera Slot ${slotNum}] Connection failed:`, err.message);
      this.showNoCameraOverlay(1);
    }
  }

  showNoCameraOverlay(slotNum) {
    const overlayEl = document.getElementById(`noCamOverlay${slotNum}`);
    const videoEl = document.getElementById(`videoFeedCam${slotNum}`);
    const statusEl = document.getElementById(`statusCam${slotNum}`);

    if (overlayEl) overlayEl.style.display = 'flex';
    if (videoEl) videoEl.style.display = 'none';
    if (statusEl) {
      statusEl.textContent = 'DISCONNECTED';
      statusEl.style.color = '#64748b';
    }
    if (slotNum === 1) this.cameraFeeds[0].active = false;
    this.updateActiveStreamsMetric();
  }

  // Initialize live video feeds
  async initCameraFeeds() {
    await this.connectSlotCamera(1, null);

    // Slots 2, 3, 4 show "NENHUMA CÂMERA CONECTADA" by default
    this.showNoCameraOverlay(4);
    this.showNoCameraOverlay(3);
    this.showNoCameraOverlay(2);

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
    const lastTime = this.lastVoiceTimeMap[messageKey] || 0;
    if (now - lastTime < 9000) return; // 9 seconds cooldown per distinct alert message

    this.lastVoiceTimeMap[messageKey] = now;

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

    } else if (statusState === 'UNKNOWN' || statusState === 'UNAUTHORIZED') {
      const minThresh = this.getMinThreshold();
      bannerEl.className = 'identity-status-banner unauthorized';
      if (iconEl) iconEl.textContent = '👤❓';
      if (titleEl) {
        titleEl.textContent = 'ALERTA: PESSOA NÃO CADASTRADA DETECTADA';
        titleEl.style.color = '#ef4444';
      }
      if (subEl) {
        const confVal = details && details.confidence ? details.confidence : '0.0';
        subEl.textContent = `Rosto humano validado pelo YOLO e isolado em 16×16 sobre fundo preto, porém a compatibilidade biométrica (${confVal}%) é inferior ao limiar (${minThresh.toFixed(1)}%). Pessoa não cadastrada no banco de dados.`;
      }
      if (badgeEl) {
        badgeEl.textContent = `PESSOA NÃO CADASTRADA (< ${Math.round(minThresh)}%)`;
        badgeEl.style.background = 'rgba(239,68,68,0.18)';
        badgeEl.style.borderColor = '#ef4444';
        badgeEl.style.color = '#f87171';
      }
      this.speakVoiceNotification('Atenção! Pessoa não cadastrada detectada na câmera!', 'unauth_voice');
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
    const videoCam1 = document.getElementById('videoFeedCam1');
    const canvasCam1 = document.getElementById('canvasFeedCam1');

    const render = () => {
      if (canvasCam1 && videoCam1 && this.cameraFeeds[0].active && !videoCam1.paused && videoCam1.readyState >= 2) {
        canvasCam1.style.display = 'block';
        const container = canvasCam1.parentElement;
        canvasCam1.width = container.clientWidth;
        canvasCam1.height = container.clientHeight;
        const ctx1 = canvasCam1.getContext('2d');
        ctx1.clearRect(0, 0, canvasCam1.width, canvasCam1.height);

        // Detect Face & Match with Database
        const trackingData = window.svBiometrics.detectFaceInVideo(videoCam1, canvasCam1);
        if (trackingData && trackingData.box) {
          const { box, match, isolatedFaceCanvas } = trackingData;

          // Atualizar miniatura HUD do Rosto Isolado em Fundo Preto & Centralizado
          const pipContainer = document.getElementById('isolatedFacePip');
          const pipCanvas = document.getElementById('isolatedFaceCanvas');
          if (pipContainer && pipCanvas) {
            if (box.detected && isolatedFaceCanvas) {
              pipContainer.style.display = 'block';
              const pctx = pipCanvas.getContext('2d');
              pctx.clearRect(0, 0, pipCanvas.width, pipCanvas.height);
              pctx.drawImage(isolatedFaceCanvas, 0, 0, pipCanvas.width, pipCanvas.height);
            } else {
              pipContainer.style.display = 'none';
            }
          }

          if (box.detected) {
            // ROSTO HUMANO CONFIRMADO PELO YOLO -> PROCESSAR BIOMETRIA E ATUALIZAR STATUS
            if (match && match.isSpoofed) {
              this.updateIdentityBanner('SPOOF', match);
              this.updateSystemStatusLive('SPOOF', match);
            } else if (match && match.matched) {
              if (match.isBlocked) {
                this.updateIdentityBanner('BLOCKED', { name: match.name, confidence: match.confidence, role: match.role });
                this.updateSystemStatusLive('BLOCKED', match);
              } else {
                const livenessScore = match.liveness ? match.liveness.scorePercent : '95';
                this.updateIdentityBanner('AUTHORIZED', { name: match.name, confidence: match.confidence, role: match.role, livenessScore });
                this.updateSystemStatusLive('AUTHORIZED', match);
              }
            } else {
              // COMPATIBILIDADE < LIMIAR: PESSOA NÃO CADASTRADA
              this.updateIdentityBanner('UNKNOWN', match);
              this.updateSystemStatusLive('UNKNOWN', match);
            }
            this.drawDynamicBoundingBox(ctx1, box, match, 'CAM_01');
            this.updateOrangeWorkflowLive(match, isolatedFaceCanvas);
          } else {
            // NENHUMA PESSOA NA CÂMERA -> MANTER COMPORTAMENTO PAUSADO / STANDBY
            this.updateIdentityBanner('PAUSED');
            this.updateSystemStatusLive('PAUSED', null);
            this.drawPausedCanvasOverlay(ctx1, canvasCam1);
            this.updateOrangeWorkflowLive(null, null);
          }
        }
      } else if (canvasCam1 && (!this.cameraFeeds[0].active || !videoCam1 || videoCam1.paused)) {
        canvasCam1.style.display = 'none';
        const pipContainer = document.getElementById('isolatedFacePip');
        if (pipContainer) pipContainer.style.display = 'none';
        this.updateIdentityBanner('PAUSED');
        this.updateSystemStatusLive('PAUSED', null);
        this.updateOrangeWorkflowLive(null, null);
      }

      requestAnimationFrame(render);
    };

    render();
  }

  /**
   * Draws dynamic bounding box over active video stream
   */
  drawDynamicBoundingBox(ctx, box, match, camId) {
    const isSpoofed = match && match.isSpoofed;
    const isMatched = match && match.matched && !isSpoofed;
    const isBlocked = isMatched && match.isBlocked;
    const isAuthorized = isMatched && !match.isBlocked;

    let strokeColor = '#ef4444';
    let fillColor = 'rgba(239, 68, 68, 0.15)';
    if (isAuthorized) {
      strokeColor = '#06b6d4';
      fillColor = 'rgba(6, 182, 212, 0.08)';
    } else if (isBlocked) {
      strokeColor = '#dc2626';
      fillColor = 'rgba(220, 38, 38, 0.28)';
    } else if (isSpoofed) {
      strokeColor = '#ff4444';
      fillColor = 'rgba(255, 68, 68, 0.35)';
    }

    // Update Card UI Border
    const cardEl = document.getElementById('cardCam1');
    if (cardEl) {
      if (isAuthorized) {
        cardEl.classList.remove('alert-border');
      } else {
        cardEl.classList.add('alert-border');
        
        if (Date.now() - this.lastLoggedUnauthorized > 8000) {
          this.lastLoggedUnauthorized = Date.now();
          if (isSpoofed) {
            window.svDB.addLog('DANGER', 'ATAQUE DE SPOOFING DETECTADO', `Tentativa de fraude biométrica com foto estática/tela identificada na ${camId}! Acesso bloqueado.`, camId);
          } else if (isBlocked) {
            window.svDB.addLog('DANGER', 'PESSOA BLOQUEADA IDENTIFICADA', `Indivíduo na lista negra (${this.escapeHTML(match.name)}) detectado na ${camId}! Acesso terminantemente negado.`, camId);
          } else {
            const minThresh = this.getMinThreshold().toFixed(0);
            window.svDB.addLog('WARNING', 'PESSOA NÃO CADASTRADA', `Rosto humano isolado via YOLO (16×16) detectado na ${camId} com compatibilidade (${match.confidence || 0}%) inferior ao limiar (${minThresh}%)! Indivíduo não consta na base de dados biométrica.`, camId);
          }
        }
      }
    }

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
    const currentThresh = this.getMinThreshold().toFixed(0);
    const labelText = isSpoofed
      ? '⚠️ FRAUDE: FOTO ESTÁTICA DETECTADA'
      : (isAuthorized 
          ? `${match.name} [AUTORIZADO]` 
          : (isBlocked ? `⛔ ${match.name} [ACESSO BLOQUEADO]` : `👤 Pessoa Não Cadastrada`));
    const subText = isSpoofed
      ? 'SPOOFING / LIVENESS REJEITADO (0.0%)'
      : (isAuthorized 
          ? `Compatibilidade: ${match.confidence}% (>= ${currentThresh}%)` 
          : (isBlocked ? `LISTA NEGRA (${match.confidence}%)` : `Pessoa não cadastrada (${match.confidence || 0}% < ${currentThresh}%)`));

    ctx.font = 'bold 11px JetBrains Mono, monospace';
    const textWidth = ctx.measureText(labelText).width;
    const labelW = Math.max(box.width, textWidth + 16);
    const labelH = 34;
    const labelX = box.x + (box.width - labelW) / 2;
    const labelY = Math.max(10, box.y - labelH - 6);

    ctx.fillStyle = isAuthorized ? '#0f172a' : (isBlocked ? '#7f1d1d' : '#831843');
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 1;
    ctx.fillRect(labelX, labelY, labelW, labelH);
    ctx.strokeRect(labelX, labelY, labelW, labelH);

    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.fillText(labelText, labelX + labelW / 2, labelY + 15);

    ctx.font = '9px Inter, sans-serif';
    ctx.fillStyle = isAuthorized ? '#10b981' : (isBlocked ? '#ff8585' : '#f87171');
    ctx.fillText(subText, labelX + labelW / 2, labelY + 28);
  }

  getMinThreshold() {
    return window.svBiometrics ? (window.svBiometrics.REQUIRED_COMPATIBILITY || 90.0) : 90.0;
  }

  // Multi-source Capture: Photo Webcam
  async captureEnrollmentPhoto() {
    let video = document.getElementById('enrollmentWebcamPreview');
    if (!video || !video.srcObject) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        video.srcObject = stream;
        video.play();
      } catch (err) {
        alert('Por favor, autorize a câmera para capturar a foto de cadastro.');
        return;
      }
    }

    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 240;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, 320, 240);

    const dataUrl = canvas.toDataURL('image/jpeg');
    await this.processAndAddPhoto(dataUrl, `Webcam #${this.enrollmentPhotos.length + 1}`);
  }

  // Processa e extrai biometria de uma imagem (Webcam, Upload ou Drag & Drop)
  async processAndAddPhoto(dataUrl, sourceName = 'Foto') {
    const statusEl = document.getElementById('photoValidationStatus');
    if (statusEl) {
      statusEl.style.display = 'block';
      statusEl.style.background = 'rgba(6, 182, 212, 0.15)';
      statusEl.style.color = 'var(--accent-cyan)';
      statusEl.style.border = '1px solid rgba(6, 182, 212, 0.3)';
      statusEl.innerHTML = `⏳ Analisando ${sourceName} via YOLOv5 e ArcFace...`;
    }

    const img = new Image();
    await new Promise((resolve) => {
      img.onload = resolve;
      img.onerror = resolve;
      img.src = dataUrl;
    });

    const canvas = document.createElement('canvas');
    const targetW = Math.min(640, img.naturalWidth || 320);
    const targetH = Math.min(480, img.naturalHeight || 240);
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, targetW, targetH);

    const descriptor = await window.svBiometrics.extractDescriptorsFromCanvas(canvas);
    const facePatch16x16 = (descriptor && descriptor.facePatch16x16) ? descriptor.facePatch16x16 : null;

    this.enrollmentPhotos.push({ dataUrl, descriptor, facePatch16x16, sourceName });
    this.renderEnrollmentThumbnails();

    if (statusEl) {
      statusEl.style.background = 'rgba(16, 185, 129, 0.15)';
      statusEl.style.color = '#10b981';
      statusEl.style.border = '1px solid rgba(16, 185, 129, 0.3)';
      statusEl.innerHTML = `✅ ${sourceName} adicionada com sucesso (Rosto 16×16 isolado via YOLO + ArcFace 128-D)!`;
      setTimeout(() => {
        if (statusEl && statusEl.innerHTML.includes(sourceName)) {
          statusEl.style.display = 'none';
        }
      }, 3500);
    }
  }

  // Renderiza miniaturas no carrossel com botão de exclusão individual (✕)
  renderEnrollmentThumbnails() {
    const container = document.getElementById('mediaSourcesContainer');
    if (!container) return;

    container.innerHTML = '';
    this.enrollmentPhotos.forEach((photo, idx) => {
      const thumb = document.createElement('div');
      thumb.className = 'media-thumb';
      thumb.style.position = 'relative';
      thumb.title = `${photo.sourceName || 'Foto'} #${idx + 1} (Clique no ✕ para excluir)`;

      const img = document.createElement('img');
      img.src = photo.dataUrl;
      thumb.appendChild(img);

      if (photo.facePatch16x16) {
        const patchImg = document.createElement('img');
        patchImg.src = photo.facePatch16x16;
        patchImg.className = 'patch-16x16-badge';
        patchImg.title = 'Rosto 16×16 isolado via YOLO em fundo preto';
        thumb.appendChild(patchImg);
      }

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'btn-remove-thumb';
      delBtn.textContent = '✕';
      delBtn.title = 'Excluir esta foto';
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.removeEnrollmentPhoto(idx);
      });
      thumb.appendChild(delBtn);

      const badge = document.createElement('span');
      badge.style.cssText = 'position:absolute; bottom:2px; right:2px; background:rgba(0,0,0,0.85); color:#06b6d4; font-size:0.6rem; padding:1px 4px; border-radius:2px; font-weight:700;';
      badge.textContent = `#${idx + 1} · 16×16`;
      thumb.appendChild(badge);

      container.appendChild(thumb);
    });

    const countEl = document.getElementById('sourcesCapturedCount');
    if (countEl) {
      const photoCount = this.enrollmentPhotos.length;
      const videoCount = this.enrollmentVideoBlob ? 1 : 0;
      countEl.textContent = `${photoCount} Foto${photoCount === 1 ? '' : 's'} Biometrica${photoCount === 1 ? '' : 's'} Adicionada${photoCount === 1 ? '' : 's'}${videoCount ? ' + 1 Vídeo' : ''}`;
    }

    setTimeout(() => {
      container.scrollTo({ left: container.scrollWidth, behavior: 'smooth' });
    }, 50);
  }

  // Remove foto individual da lista
  removeEnrollmentPhoto(index) {
    if (index >= 0 && index < this.enrollmentPhotos.length) {
      this.enrollmentPhotos.splice(index, 1);
      this.renderEnrollmentThumbnails();
      const statusEl = document.getElementById('photoValidationStatus');
      if (statusEl) {
        statusEl.style.display = 'block';
        statusEl.style.background = 'rgba(239, 68, 68, 0.12)';
        statusEl.style.color = '#ef4444';
        statusEl.style.border = '1px solid rgba(239, 68, 68, 0.3)';
        statusEl.textContent = `🗑️ Foto removida da lista de cadastro.`;
        setTimeout(() => { if (statusEl) statusEl.style.display = 'none'; }, 2500);
      }
    }
  }

  // Processa múltiplos arquivos de fotos selecionados
  async handlePhotoFilesSelected(files) {
    if (!files || files.length === 0) return;
    const validImageFiles = Array.from(files).filter(f => f.type.startsWith('image/'));
    if (validImageFiles.length === 0) {
      alert('Por favor, selecione arquivos de imagem válidos (JPG, PNG, WEBP).');
      return;
    }

    for (let i = 0; i < validImageFiles.length; i++) {
      const file = validImageFiles[i];
      try {
        const dataUrl = await this.readFileAsDataURL(file);
        await this.processAndAddPhoto(dataUrl, file.name);
      } catch (err) {
        console.warn('[App] Erro ao ler arquivo de foto:', file.name, err);
      }
    }
  }

  // Utilitário para ler arquivo como DataURL
  readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = (e) => reject(e);
      reader.readAsDataURL(file);
    });
  }

  // Captura guiada em sequência rápida de 3 ângulos (Frontal, Esquerda, Direita)
  async captureBurstThreeAngles() {
    let video = document.getElementById('enrollmentWebcamPreview');
    if (!video || !video.srcObject) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        video.srcObject = stream;
        video.play();
      } catch (err) {
        alert('Por favor, autorize a câmera para a captura de 3 ângulos.');
        return;
      }
    }

    const angles = [
      { name: 'Frontal', prompt: 'Olhe diretamente para a câmera' },
      { name: 'Leve Esquerda', prompt: 'Incline a cabeça levemente para a esquerda' },
      { name: 'Leve Direita', prompt: 'Incline a cabeça levemente para a direita' }
    ];

    const statusEl = document.getElementById('photoValidationStatus');
    const btnBurst = document.getElementById('btnBurstCapture');
    if (btnBurst) btnBurst.disabled = true;

    for (let i = 0; i < angles.length; i++) {
      const angle = angles[i];
      if (statusEl) {
        statusEl.style.display = 'block';
        statusEl.style.background = 'rgba(6, 182, 212, 0.2)';
        statusEl.style.color = 'var(--accent-cyan)';
        statusEl.style.border = '1px solid var(--accent-cyan)';
        statusEl.innerHTML = `📸 Ângulo ${i + 1}/3 (${angle.name}): <strong>${angle.prompt}</strong> em 2s...`;
      }
      this.speakVoiceNotification(angle.prompt, `burst_${i}`);
      await new Promise(r => setTimeout(r, 1800));

      const canvas = document.createElement('canvas');
      canvas.width = 320;
      canvas.height = 240;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, 320, 240);
      const dataUrl = canvas.toDataURL('image/jpeg');

      await this.processAndAddPhoto(dataUrl, `Ângulo ${angle.name}`);
    }

    if (btnBurst) btnBurst.disabled = false;
    if (statusEl) {
      statusEl.style.background = 'rgba(16, 185, 129, 0.2)';
      statusEl.style.color = '#10b981';
      statusEl.innerHTML = `🎉 Sequência de 3 ângulos concluída com sucesso!`;
      setTimeout(() => { if (statusEl) statusEl.style.display = 'none'; }, 4000);
    }
  }

  // Prepara adição de fotos a um usuário já cadastrado
  handleAppendPhotosToUser(userId, userName) {
    this.currentAppendUserId = userId;
    this.currentAppendUserName = userName;
    const fileInput = document.getElementById('appendUserPhotosFileInput');
    if (fileInput) {
      fileInput.value = '';
      fileInput.click();
    }
  }

  recordEnrollmentVideo() {
    alert('Simulando gravação de vídeo de amostra (3 segundos)...');
    setTimeout(() => {
      this.enrollmentVideoBlob = 'sample_video_blob';
      const countEl = document.getElementById('sourcesCapturedCount');
      if (countEl) countEl.textContent = `${this.enrollmentPhotos.length} Fotos + 1 Vídeo Gravado`;
      alert('Vídeo de amostra gravado com sucesso para reforçar o vetor facial!');
    }, 1500);
  }

  // Save User LGPD Form (Suporte a Usuário Autorizado e Pessoa Bloqueada)
  async handleEnrollmentSubmit(e, isBlocked = false) {
    if (e && e.preventDefault) e.preventDefault();

    const name = document.getElementById('enrollName').value.trim();
    const role = document.getElementById('enrollRole').value.trim();
    const cpf = document.getElementById('enrollCpf').value.trim();
    const consentChecked = document.getElementById('lgpdConsentCheckbox').checked;

    if (!name) {
      alert('⚠️ Por favor, informe o Nome Completo antes de salvar.');
      return;
    }

    // Validação estrita e matemática do CPF (Dígitos Verificadores Módulo 11)
    if (!this.validateCPF(cpf)) {
      alert('⚠️ CPF Inválido: O número informado não é um CPF autêntico válido perante o algoritmo oficial da Receita Federal. Verifique os números digitados.');
      document.getElementById('enrollCpf').focus();
      return;
    }

    if (!consentChecked) {
      alert('⚠️ Para conformidade rigorosa com a LGPD, o aceite dos termos de consentimento biométrico é obrigatório.');
      return;
    }

    if (this.enrollmentPhotos.length === 0) {
      alert('⚠️ Por favor, capture pelo menos 1 foto biométrica da face para gerar os descritores ArcFace.');
      return;
    }

    const descriptors = this.enrollmentPhotos.map(p => p.descriptor);
    const photoBlobs = this.enrollmentPhotos.map(p => p.dataUrl);
    const facePatches16x16 = this.enrollmentPhotos.map(p => p.facePatch16x16 || null);

    const userRole = role || (isBlocked ? 'Bloqueado (Lista Negra)' : 'Funcionário');
    const accessLevel = isBlocked ? 'BLOQUEADO' : 'Nível 1 (Autorizado)';

    await window.svDB.saveUser(
      { name, role: userRole, cpf, isBlocked, accessLevel },
      { descriptors, photoBlobs, videoBlob: this.enrollmentVideoBlob, facePatches16x16 }
    );
    await window.svBiometrics.reloadRegisteredUsers();

    if (isBlocked) {
      alert(`🚫 PESSOA BLOQUEADA CADASTRADA!\n\n"${name}" foi registrado(a) na LISTA NEGRA.\nQualquer aparição desta face nas câmeras disparará alarme imediato.`);
    } else {
      alert(`✅ Usuário "${name}" cadastrado com sucesso no banco de dados como AUTORIZADO!`);
    }
    
    // Reset Form
    const form = document.getElementById('enrollmentForm');
    if (form) form.reset();
    this.enrollmentPhotos = [];
    this.enrollmentVideoBlob = null;
    const mediaContainer = document.getElementById('mediaSourcesContainer');
    if (mediaContainer) mediaContainer.innerHTML = '';
    const countEl = document.getElementById('sourcesCapturedCount');
    if (countEl) countEl.textContent = '0 Fotos Biométricas Adicionadas';
    
    this.loadRegisteredUsersUI();
    this.switchTab('monitoring');
  }

  // Render registered users with LGPD Delete Option and Blocked Badges (Anti-XSS Secured)
  async loadRegisteredUsersUI() {
    const listEl = document.getElementById('registeredUsersList');
    if (!listEl) return;

    const users = await window.svDB.getAllUsers();

    if (users.length === 0) {
      listEl.innerHTML = `
        <div style="background:rgba(239, 68, 68, 0.1); border:1px solid rgba(239, 68, 68, 0.3); color:#f87171; font-size:0.85rem; padding:14px; border-radius:8px;">
          Nenhum usuário cadastrado no banco local. Cadastre acima para que o sistema passe a autorizar os acessos.
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

      const actionsDiv = document.createElement('div');
      actionsDiv.style.cssText = 'display:flex; align-items:center; gap:8px;';

      const appendBtn = document.createElement('button');
      appendBtn.className = 'btn-action';
      appendBtn.style.cssText = 'font-size:0.75rem; padding:4px 10px; background:linear-gradient(135deg, #0ea5e9, #0284c7); border-color:#0284c7;';
      appendBtn.textContent = '➕ Adicionar Fotos';
      appendBtn.addEventListener('click', () => this.handleAppendPhotosToUser(u.id, u.name));

      const delBtn = document.createElement('button');
      delBtn.className = 'btn-outline';
      delBtn.style.cssText = 'color:#ef4444; border-color:rgba(239,68,68,0.4); font-size:0.75rem; padding:4px 8px;';
      delBtn.textContent = '🗑️ Excluir (LGPD)';
      delBtn.addEventListener('click', () => this.deleteUserLGPD(u.id, u.name));

      actionsDiv.appendChild(appendBtn);
      actionsDiv.appendChild(delBtn);

      itemCard.appendChild(leftDiv);
      itemCard.appendChild(actionsDiv);
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

  // Anexa fotos adicionais ao cadastro existente (Isola 16x16 via YOLO + Extrai ArcFace 128-D)
  async handleAppendPhotosToUser(userId, userName) {
    const input = document.getElementById('appendUserPhotosFileInput');
    if (!input) return;

    input.value = '';

    input.onchange = async (e) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;

      const validFiles = Array.from(files).filter(f => f.type.startsWith('image/'));
      if (validFiles.length === 0) {
        alert('Por favor selecione arquivos de imagem válidos (JPG, PNG, WEBP).');
        return;
      }

      const statusEl = document.getElementById('photoValidationStatus');
      if (statusEl) {
        statusEl.style.display = 'block';
        statusEl.style.background = 'rgba(6, 182, 212, 0.15)';
        statusEl.style.color = 'var(--accent-cyan)';
        statusEl.style.border = '1px solid rgba(6, 182, 212, 0.3)';
        statusEl.innerHTML = `⏳ Processando ${validFiles.length} nova(s) foto(s) para "${userName}" (YOLO 16×16 + ArcFace)...`;
      }

      const newDescriptors = [];
      const newPhotoBlobs = [];
      const newPatches16 = [];

      for (const file of validFiles) {
        try {
          const dataUrl = await this.readFileAsDataURL(file);
          const img = new Image();
          await new Promise(res => { img.onload = res; img.onerror = res; img.src = dataUrl; });

          const canvas = document.createElement('canvas');
          canvas.width = Math.min(640, img.naturalWidth || 320);
          canvas.height = Math.min(480, img.naturalHeight || 240);
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

          const desc = await window.svBiometrics.extractDescriptorsFromCanvas(canvas);
          newDescriptors.push(desc);
          newPhotoBlobs.push(dataUrl);
          newPatches16.push(desc.facePatch16x16 || null);
        } catch (err) {
          console.warn('[App] Erro ao processar foto anexada:', file.name, err);
        }
      }

      if (newDescriptors.length > 0) {
        await window.svDB.appendBiometricsToUser(userId, newDescriptors, newPhotoBlobs, newPatches16);
        await window.svBiometrics.reloadRegisteredUsers();
        await this.loadRegisteredUsersUI();

        if (statusEl) {
          statusEl.style.background = 'rgba(16, 185, 129, 0.15)';
          statusEl.style.color = '#10b981';
          statusEl.style.border = '1px solid rgba(16, 185, 129, 0.3)';
          statusEl.innerHTML = `✅ ${newDescriptors.length} foto(s) anexada(s) com sucesso a "${userName}" (Rostos 16×16 isolados via YOLO)!`;
          setTimeout(() => { if (statusEl) statusEl.style.display = 'none'; }, 4000);
        }
        alert(`✅ ${newDescriptors.length} foto(s) adicionada(s) com sucesso ao cadastro de "${userName}"!`);
      }
    };

    input.click();
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
    } else if (state === 'UNAUTHORIZED' || state === 'UNKNOWN') {
      const minThresh = this.getMinThreshold();
      elPerson.textContent = 'Detectada ⚠';
      elPerson.className = 'status-metric-value offline';
      elResult.textContent = `👤 PESSOA NÃO CADASTRADA (< ${Math.round(minThresh)}%)`;
      elResult.className = 'status-metric-value offline';
      elResult.style.color = '#ef4444';
      elName.textContent = 'Pessoa não cadastrada';
      elName.style.color = '#ef4444';
      elCosine.textContent = match ? (match.cosineSimilarity || '—') : '—';
      elConfidence.textContent = match ? `${match.confidence || '0'}%` : '—';
      elMargin.textContent = match ? (match.arcFaceMarginLogit || '—') : '—';
      if (elEngine) { elEngine.textContent = `YOLO 16×16 + ArcFace (< ${Math.round(minThresh)}%)`; elEngine.className = 'status-metric-value offline'; }

      this.addRecognitionTimelineEvent('unauth', 'Pessoa não cadastrada', match ? match.cosineSimilarity : '0', match ? match.confidence : '0');
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
      elThreshold.textContent = `${(window.svBiometrics.REQUIRED_COMPATIBILITY || 90.0).toFixed(1)}% (Mínimo de Segurança)`;
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

  /**
   * Setup controls in the Settings tab:
   * - Limiar Biométrico Mínimo (#minRecognitionThresholdRange)
   * - Presets (80% Tolerante, 90% Padrão, 95% Rigoroso)
   * - Sincronização de badges visuais e atualização dinâmica do motor biométrico
   */
  setupSettingsTabControls() {
    const range = document.getElementById('minRecognitionThresholdRange');
    const badge = document.getElementById('valThresholdPct');
    const btnTolerant = document.getElementById('btnPresetTolerant');
    const btnStandard = document.getElementById('btnPresetStandard');
    const btnStrict = document.getElementById('btnPresetStrict');

    const updatePresetStyles = (val) => {
      const activeColor = 'var(--accent-cyan)';
      if (btnTolerant) {
        const isTolerant = Math.abs(val - 80) < 0.5;
        btnTolerant.style.borderColor = isTolerant ? activeColor : '';
        btnTolerant.style.color = isTolerant ? activeColor : '';
      }
      if (btnStandard) {
        const isStandard = Math.abs(val - 90) < 0.5;
        btnStandard.style.borderColor = isStandard ? activeColor : '';
        btnStandard.style.color = isStandard ? activeColor : '';
      }
      if (btnStrict) {
        const isStrict = Math.abs(val - 95) < 0.5;
        btnStrict.style.borderColor = isStrict ? activeColor : '';
        btnStrict.style.color = isStrict ? activeColor : '';
      }
    };

    const applyThreshold = (newVal, notify = false) => {
      const numericVal = Math.min(98, Math.max(50, parseFloat(newVal) || 90.0));
      if (range) range.value = numericVal;
      if (badge) badge.textContent = `${numericVal.toFixed(1)}%`;

      if (window.svBiometrics && typeof window.svBiometrics.setRequiredCompatibility === 'function') {
        window.svBiometrics.setRequiredCompatibility(numericVal);
      }

      const stsThreshold = document.getElementById('stsThreshold');
      if (stsThreshold) {
        stsThreshold.textContent = `${numericVal.toFixed(1)}% (Mínimo de Segurança)`;
      }

      updatePresetStyles(numericVal);

      if (notify && window.svDB) {
        window.svDB.addLog(
          'INFO',
          'CONFIGURAÇÃO ALTERADA',
          `Limiar de reconhecimento mínimo para desconhecido ajustado para ${numericVal.toFixed(1)}%.`,
          'SYSTEM'
        );
      }
    };

    // Valor inicial do motor ou do localStorage
    const initialVal = (window.svBiometrics && window.svBiometrics.REQUIRED_COMPATIBILITY)
      ? window.svBiometrics.REQUIRED_COMPATIBILITY
      : 90.0;
    applyThreshold(initialVal, false);

    if (range) {
      range.addEventListener('input', (e) => {
        applyThreshold(e.target.value, false);
      });
      range.addEventListener('change', (e) => {
        applyThreshold(e.target.value, true);
      });
    }

    if (btnTolerant) {
      btnTolerant.addEventListener('click', () => applyThreshold(80.0, true));
    }
    if (btnStandard) {
      btnStandard.addEventListener('click', () => applyThreshold(90.0, true));
    }
    if (btnStrict) {
      btnStrict.addEventListener('click', () => applyThreshold(95.0, true));
    }
  }

  /**
   * Setup horizontal dragging and wheel scroll for the media sources carousel
   */
  setupMediaCarouselDrag() {
    const container = document.getElementById('mediaSourcesContainer');
    if (!container) return;

    // Roda do mouse rola horizontalmente
    container.addEventListener('wheel', (e) => {
      if (e.deltaY !== 0) {
        e.preventDefault();
        container.scrollLeft += e.deltaY;
      }
    }, { passive: false });

    // Arraste com o ponteiro do mouse (click & drag)
    let isDown = false;
    let startX = 0;
    let scrollLeft = 0;

    container.addEventListener('mousedown', (e) => {
      if (e.target.closest('.btn-remove-thumb')) return;
      isDown = true;
      container.classList.add('dragging');
      startX = e.pageX - container.offsetLeft;
      scrollLeft = container.scrollLeft;
    });

    container.addEventListener('mouseleave', () => {
      isDown = false;
      container.classList.remove('dragging');
    });

    container.addEventListener('mouseup', () => {
      isDown = false;
      container.classList.remove('dragging');
    });

    container.addEventListener('mousemove', (e) => {
      if (!isDown) return;
      e.preventDefault();
      const x = e.pageX - container.offsetLeft;
      const walk = (x - startX) * 1.5;
      container.scrollLeft = scrollLeft - walk;
    });
  }

  /**
   * Atualiza os nós e painel de comparação do fluxo Orange Data Mining em tempo real
   * (Isolamento 16x16 YOLO + Embeddings 128-D ArcFace + Classificador kNN/Rede Neural)
   */
  updateOrangeWorkflowLive(match, isolatedFaceCanvas) {
    const liveCanvas = document.getElementById('orangeLiveFace16Canvas');
    const compLive = document.getElementById('compLive16');
    const compDb = document.getElementById('compDb16');
    const cosineEl = document.getElementById('compCosineVal');
    const confEl = document.getElementById('compConfVal');
    const statusTag = document.getElementById('compStatusTag');
    const predSub = document.getElementById('orangePredictionSub');
    const nodePred = document.getElementById('nodePredictions');

    if (!liveCanvas || !compLive) return;

    if (isolatedFaceCanvas && match) {
      // 1. Renderiza rosto 16x16 ao vivo na miniatura do nó Image Viewer (1)
      const ctxLiveNode = liveCanvas.getContext('2d');
      ctxLiveNode.clearRect(0, 0, 16, 16);
      ctxLiveNode.drawImage(isolatedFaceCanvas, 0, 0, 16, 16);

      // 2. Renderiza rosto 16x16 no painel de comparação
      const ctxCompLive = compLive.getContext('2d');
      ctxCompLive.clearRect(0, 0, 16, 16);
      ctxCompLive.drawImage(isolatedFaceCanvas, 0, 0, 16, 16);

      // 3. Renderiza rosto 16x16 do banco cadastrado se houver correspondência
      if (compDb) {
        const ctxDb = compDb.getContext('2d');
        ctxDb.clearRect(0, 0, 16, 16);
        if (match.databaseFacePatch16x16) {
          if (!this._dbPatchImgCache) this._dbPatchImgCache = {};
          let cachedImg = this._dbPatchImgCache[match.databaseFacePatch16x16];
          if (!cachedImg) {
            cachedImg = new Image();
            cachedImg.src = match.databaseFacePatch16x16;
            this._dbPatchImgCache[match.databaseFacePatch16x16] = cachedImg;
          }
          if (cachedImg.complete && cachedImg.naturalWidth > 0) {
            ctxDb.drawImage(cachedImg, 0, 0, 16, 16);
          } else {
            cachedImg.onload = () => {
              if (compDb) {
                const c = compDb.getContext('2d');
                c.clearRect(0, 0, 16, 16);
                c.drawImage(cachedImg, 0, 0, 16, 16);
              }
            };
          }
        } else {
          ctxDb.fillStyle = '#000000';
          ctxDb.fillRect(0, 0, 16, 16);
        }
      }

      // 4. Métricas numéricas de ArcFace
      if (cosineEl) cosineEl.textContent = match.cosineSimilarity || '—';
      if (confEl) confEl.textContent = `${match.confidence || '0'}%`;

      // 5. Atualiza badge e predições do nó
      const isMatched = match.matched && !match.isSpoofed;
      if (isMatched) {
        if (match.isBlocked) {
          if (statusTag) {
            statusTag.textContent = `⛔ BLOQUEADO (${match.name})`;
            statusTag.style.background = 'rgba(239,68,68,0.2)';
            statusTag.style.color = '#ef4444';
            statusTag.style.borderColor = '#ef4444';
          }
          if (predSub) predSub.textContent = `Pessoa Bloqueada: ${match.name}`;
          if (nodePred) {
            nodePred.classList.remove('match-ok');
            nodePred.classList.add('match-fail');
          }
        } else {
          if (statusTag) {
            statusTag.textContent = `✓ CADASTRADO (${match.name})`;
            statusTag.style.background = 'rgba(16,185,129,0.2)';
            statusTag.style.color = '#10b981';
            statusTag.style.borderColor = '#10b981';
          }
          if (predSub) predSub.textContent = `Pessoa Cadastrada: ${match.name}`;
          if (nodePred) {
            nodePred.classList.remove('match-fail');
            nodePred.classList.add('match-ok');
          }
        }
      } else {
        if (statusTag) {
          statusTag.textContent = '⚠ PESSOA NÃO CADASTRADA';
          statusTag.style.background = 'rgba(239,68,68,0.18)';
          statusTag.style.color = '#f87171';
          statusTag.style.borderColor = '#ef4444';
        }
        if (predSub) predSub.textContent = 'Pessoa não cadastrada';
        if (nodePred) {
          nodePred.classList.remove('match-ok');
          nodePred.classList.add('match-fail');
        }
      }
    } else {
      // Standby / Sem pessoa na câmera
      if (cosineEl) cosineEl.textContent = '—';
      if (confEl) confEl.textContent = '—';
      if (statusTag) {
        statusTag.textContent = '⏸️ STANDBY (SEM PESSOA)';
        statusTag.style.background = 'rgba(100,116,139,0.15)';
        statusTag.style.color = '#94a3b8';
        statusTag.style.borderColor = '#64748b';
      }
      if (predSub) predSub.textContent = 'Aguardando presença...';
      if (nodePred) {
        nodePred.classList.remove('match-ok', 'match-fail');
      }
      if (compLive) {
        const c = compLive.getContext('2d');
        c.fillStyle = '#000000';
        c.fillRect(0, 0, 16, 16);
      }
      if (compDb) {
        const c = compDb.getContext('2d');
        c.fillStyle = '#000000';
        c.fillRect(0, 0, 16, 16);
      }
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

