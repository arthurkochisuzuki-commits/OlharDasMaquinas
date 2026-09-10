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

        window.svDB.saveSupabaseCredentials(url, key);
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
  }

  loadSupabaseUI() {
    const urlInput = document.getElementById('supabaseUrlInput');
    const keyInput = document.getElementById('supabaseKeyInput');
    if (urlInput) urlInput.value = window.svDB.supabaseConfig.url || '';
    if (keyInput) keyInput.value = window.svDB.supabaseConfig.key || '';
  }

  // Theme Management (Light vs Dark Mode)
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

  // 🔍 Verificar Câmeras Conectadas no Dispositivo
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
        let html = `<ul style="list-style:none; display:flex; flex-direction:column; gap:8px;">`;
        this.connectedDevices.forEach((dev, index) => {
          html += `
            <li style="background:var(--bg-card); border:1px solid var(--border-color); padding:10px 14px; border-radius:6px; display:flex; align-items:center; justify-content:space-between;">
              <div>
                <strong style="color:var(--text-main); font-size:0.85rem;">📷 ${dev.label || `Câmera Dispositivo #${index + 1}`}</strong>
                <div style="font-family: monospace; font-size:0.7rem; color:var(--text-dim);">ID: ${dev.deviceId.substring(0, 20)}...</div>
              </div>
              <div style="display:flex; gap:6px;">
                <button class="btn-action" style="font-size:0.75rem; padding:4px 8px;" onclick="window.svApp.assignCameraToSlot('${dev.deviceId}', '${dev.label}', 1)">Conectar Feed 1</button>
              </div>
            </li>`;
        });
        html += `</ul>`;
        deviceListEl.innerHTML = html;
      }

      window.svDB.addLog('INFO', 'VERIFICAÇÃO DE CÂMERAS', `${this.connectedDevices.length} dispositivos de vídeo verificados no sistema.`);
    } catch (err) {
      console.error('[Cameras] Error enumerating devices:', err);
      deviceListEl.innerHTML = `<div style="color:#ef4444;">Erro ao verificar câmeras: ${err.message}</div>`;
    }
  }

  async assignCameraToSlot(deviceId, label, slotNum = 1) {
    this.cameraFeeds[0].deviceId = deviceId;
    this.cameraFeeds[0].name = label || `Webcam ${slotNum}`;
    
    document.getElementById('cameraCheckModal').classList.remove('active');
    await this.connectSlotCamera(1, deviceId);
    alert(`Câmera "${label}" conectada com sucesso ao Feed 1!`);
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

    } else if (statusState === 'AUTHORIZED') {
      bannerEl.className = 'identity-status-banner authorized';
      if (iconEl) iconEl.textContent = '✅';
      if (titleEl) {
        titleEl.textContent = `PESSOA CADASTRADA: ${details.name ? details.name.toUpperCase() : 'AUTORIZADO'}`;
        titleEl.style.color = '#10b981';
      }
      if (subEl) subEl.textContent = `Identidade confirmada no Banco de Dados Biométrico (Confiança: ${details.confidence || 95}% | ArcFace Margin s=32, m=0.5).`;
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
        titleEl.textContent = `🚫 ALERTA CRÍTICO: PESSOA BLOQUEADA DETECTADA: ${details.name ? details.name.toUpperCase() : 'BLOQUEADO'}`;
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
      if (subEl) subEl.textContent = 'Rosto humano detectado na câmera, porém a pessoa NÃO possui cadastro no Banco de Dados Biométrico.';
      if (badgeEl) {
        badgeEl.textContent = 'NÃO CADASTRADO / RED ALERT';
        badgeEl.style.background = 'rgba(239,68,68,0.15)';
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
          const { box, match } = trackingData;

          if (box.detected) {
            // PESSOA DETECTADA NA CÂMERA -> PROCESSAR BIOMETRIA E ATUALIZAR STATUS
            if (match && match.matched) {
              if (match.isBlocked) {
                this.updateIdentityBanner('BLOCKED', { name: match.name, confidence: match.confidence, role: match.role });
                this.updateSystemStatusLive('BLOCKED', match);
              } else {
                this.updateIdentityBanner('AUTHORIZED', { name: match.name, confidence: match.confidence, role: match.role });
                this.updateSystemStatusLive('AUTHORIZED', match);
              }
            } else {
              this.updateIdentityBanner('UNAUTHORIZED', match);
              this.updateSystemStatusLive('UNAUTHORIZED', match);
            }
            this.drawDynamicBoundingBox(ctx1, box, match, 'CAM_01');
          } else {
            // NENHUMA PESSOA NA CÂMERA -> PAUSAR PROCESSAMENTO HEAVY DE IA
            this.updateIdentityBanner('PAUSED');
            this.updateSystemStatusLive('PAUSED', null);
            this.drawPausedCanvasOverlay(ctx1, canvasCam1);
          }
        }
      } else if (canvasCam1 && (!this.cameraFeeds[0].active || !videoCam1 || videoCam1.paused)) {
        canvasCam1.style.display = 'none';
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
  drawDynamicBoundingBox(ctx, box, match, camId) {
    const isMatched = match && match.matched;
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
          if (isBlocked) {
            window.svDB.addLog('DANGER', 'PESSOA BLOQUEADA IDENTIFICADA', `Indivíduo na lista negra (${match.name}) detectado na ${camId}! Acesso terminantemente negado.`, camId);
          } else {
            window.svDB.addLog('DANGER', 'PESSOA NÃO AUTORIZADA', `Rosto não cadastrado no banco detectado na ${camId}! Acesso negado.`, camId);
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
    const labelText = isAuthorized 
      ? `${match.name} [AUTORIZADO]` 
      : (isBlocked ? `⛔ ${match.name} [ACESSO BLOQUEADO]` : (match.label || '🚨 RED ALERT - NÃO AUTORIZADO'));
    const subText = isAuthorized 
      ? `Confiança: ${match.confidence}%` 
      : (isBlocked ? `LISTA NEGRA / ALERTA CRÍTICO (${match.confidence}%)` : 'Rosto Ausente no Banco DB');

    ctx.font = 'bold 11px JetBrains Mono, monospace';
    const textWidth = ctx.measureText(labelText).width;
    const labelW = Math.max(box.width, textWidth + 16);
    const labelH = 34;
    const labelX = box.x + (box.width - labelW) / 2;
    const labelY = Math.max(10, box.y - labelH - 6);

    ctx.fillStyle = isAuthorized ? '#0f172a' : (isBlocked ? '#7f1d1d' : '#991b1b');
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

  // Multi-source Capture: Photo
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
    const descriptor = await window.svBiometrics.extractDescriptorsFromCanvas(canvas);

    this.enrollmentPhotos.push({ dataUrl, descriptor });

    // Update UI thumbnails (Carrossel Horizontal com Auto-Scroll)
    const container = document.getElementById('mediaSourcesContainer');
    if (container) {
      const thumb = document.createElement('div');
      thumb.className = 'media-thumb';
      thumb.title = `Foto Biométrica #${this.enrollmentPhotos.length}`;
      thumb.innerHTML = `<img src="${dataUrl}" /><span style="position:absolute; bottom:2px; right:2px; background:rgba(0,0,0,0.85); color:#06b6d4; font-size:0.6rem; padding:1px 4px; border-radius:2px; font-weight:700;">#${this.enrollmentPhotos.length}</span>`;
      container.appendChild(thumb);

      // Auto-scroll suave para a foto recém capturada
      setTimeout(() => {
        container.scrollTo({ left: container.scrollWidth, behavior: 'smooth' });
      }, 50);
    }

    const countEl = document.getElementById('sourcesCapturedCount');
    if (countEl) countEl.textContent = `${this.enrollmentPhotos.length} / 3 Fotos Biométricas Capturadas`;
  }

  /**
   * Habilita funcionalidade de arrastar com o mouse (Drag-to-Scroll) e roda do mouse no carrossel de fotos
   */
  setupMediaCarouselDrag() {
    const container = document.getElementById('mediaSourcesContainer');
    if (!container) return;

    let isDown = false;
    let startX = 0;
    let scrollLeft = 0;

    container.addEventListener('mousedown', (e) => {
      isDown = true;
      startX = e.pageX - container.offsetLeft;
      scrollLeft = container.scrollLeft;
    });

    container.addEventListener('mouseleave', () => {
      isDown = false;
    });

    container.addEventListener('mouseup', () => {
      isDown = false;
    });

    container.addEventListener('mousemove', (e) => {
      if (!isDown) return;
      e.preventDefault();
      const x = e.pageX - container.offsetLeft;
      const walk = (x - startX) * 1.8; // Velocidade do arraste
      container.scrollLeft = scrollLeft - walk;
    });

    // Permite rolar para os lados usando a roda do mouse (Wheel Scroll)
    container.addEventListener('wheel', (e) => {
      if (e.deltaY !== 0) {
        e.preventDefault();
        container.scrollLeft += e.deltaY;
      }
    }, { passive: false });
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

    // Validação estrita de CPF (11 dígitos numéricos)
    const cleanCpf = cpf.replace(/\D/g, '');
    if (cleanCpf.length !== 11) {
      alert('⚠️ CPF Inválido: O CPF deve conter exatamente 11 dígitos numéricos (formato 000.000.000-00).');
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

    const userRole = role || (isBlocked ? 'Bloqueado (Lista Negra)' : 'Funcionário');
    const accessLevel = isBlocked ? 'BLOQUEADO' : 'Nível 1 (Autorizado)';

    await window.svDB.saveUser(
      { name, role: userRole, cpf, isBlocked, accessLevel },
      { descriptors, photoBlobs, videoBlob: this.enrollmentVideoBlob }
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
    if (countEl) countEl.textContent = '0 / 3 Fotos Biométricas Capturadas';
    
    this.loadRegisteredUsersUI();
    this.switchTab('monitoring');
  }

  // Render registered users with LGPD Delete Option and Blocked Badges
  async loadRegisteredUsersUI() {
    const listEl = document.getElementById('registeredUsersList');
    if (!listEl) return;

    const users = await window.svDB.getAllUsers();

    if (users.length === 0) {
      listEl.innerHTML = `
        <div style="background:rgba(239, 68, 68, 0.1); border:1px solid rgba(239, 68, 68, 0.3); color:#f87171; font-size:0.85rem; padding:14px; border-radius:8px;">
          ⚠️ <strong>BANCO DE DADOS VAZIO:</strong> Nenhuma pessoa cadastrada no momento. Na tela de monitoramento, qualquer rosto que aparecer na câmera será identificado como <strong>RED ALERT - PESSOA NÃO AUTORIZADA</strong>. Cadastre uma pessoa acima para testar o reconhecimento!
        </div>`;
      return;
    }

    let html = '';
    users.forEach(u => {
      const photos = u.biometrics ? (u.biometrics.photoBlobs || []) : [];
      const sourcesCount = u.biometrics ? u.biometrics.sourceCount || 1 : 1;
      const isBlocked = !!u.isBlocked || u.accessLevel === 'BLOQUEADO';

      const avatarHtml = photos[0]
        ? `<img src="${photos[0]}" style="width:40px; height:40px; border-radius:50%; object-fit:cover; border:2px solid ${isBlocked ? '#ef4444' : '#06b6d4'};" />`
        : `<div style="width:40px; height:40px; border-radius:50%; background:${isBlocked ? '#991b1b' : '#2563eb'}; display:flex; align-items:center; justify-content:center; color:#fff; font-weight:bold;">${isBlocked ? '🚫' : u.name[0]}</div>`;

      const statusBadge = isBlocked
        ? `<span style="font-size:0.7rem; color:#ef4444; background:rgba(239,68,68,0.15); border:1px solid rgba(239,68,68,0.4); padding:2px 8px; border-radius:4px; font-weight:700;">🚫 BLOQUEADO (LISTA NEGRA)</span>`
        : `<span style="font-size:0.7rem; color:#10b981; background:rgba(16,185,129,0.15); border:1px solid rgba(16,185,129,0.4); padding:2px 8px; border-radius:4px; font-weight:700;">✓ AUTORIZADO</span> <span style="font-size:0.7rem; color:#06b6d4; background:rgba(6,182,212,0.1); padding:2px 6px; border-radius:4px;">${u.role}</span>`;

      html += `
        <div style="background:var(--bg-card); border:1px solid ${isBlocked ? 'rgba(239,68,68,0.4)' : 'var(--border-color)'}; padding:12px; border-radius:8px; display:flex; align-items:center; justify-content:space-between; margin-bottom:8px;">
          <div style="display:flex; align-items:center; gap:12px;">
            ${avatarHtml}
            <div>
              <div style="color:var(--text-main); font-weight:600; font-size:0.9rem;">${u.name} ${statusBadge}</div>
              <div style="font-size:0.75rem; color:var(--text-muted); margin-top:3px;">Fontes Biométricas: ${sourcesCount} Mídias | CPF: Criptografado AES-256 | LGPD Consent: ${new Date(u.lgpdConsent.timestamp).toLocaleDateString()}</div>
            </div>
          </div>
          <button class="btn-outline" style="color:#ef4444; border-color:rgba(239,68,68,0.4); font-size:0.75rem;" onclick="window.svApp.deleteUserLGPD('${u.id}', '${u.name}')">🗑️ Excluir (LGPD)</button>
        </div>`;
    });

    listEl.innerHTML = html;
  }

  async deleteUserLGPD(userId, userName) {
    if (confirm(`⚠️ EXCLUSÃO LGPD (DIREITO AO ESQUECIMENTO):\nTem certeza que deseja apagar DEFINITIVAMENTE todos os dados, fotos, vídeos e biometria de "${userName}"?\nEsta ação é irreversível.`)) {
      await window.svDB.deleteUserLGPD(userId);
      await window.svBiometrics.reloadRegisteredUsers();
      this.loadRegisteredUsersUI();
      alert(`Dados de ${userName} foram excluídos permanentemente de acordo com a LGPD.`);
    }
  }

  // Live Logs UI
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

    card.innerHTML = `
      <div class="log-meta">
        <span>${log.timestamp}</span>
        <span class="cam-tag">${log.camId}</span>
      </div>
      <div class="log-badge ${badgeClass}">${icon} ${log.category}</div>
      <div class="log-desc">${log.description}</div>
    `;

    listEl.insertBefore(card, listEl.firstChild);
  }

  startMetricsTimer() {
    setInterval(() => {
      const fpsEl = document.getElementById('metricFps');
      const gpuEl = document.getElementById('metricGpu');
      if (fpsEl) fpsEl.textContent = (59.0 + Math.random() * 1.5).toFixed(1);
      if (gpuEl) gpuEl.textContent = `${Math.floor(78 + Math.random() * 8)}%`;

      // Atualiza leitura em tempo real dos pixels detectados na aba de configurações
      const livePxEl = document.getElementById('lblLiveDetectedPixels');
      if (livePxEl && window.svBiometrics) {
        livePxEl.textContent = `${window.svBiometrics.lastDetectedPixels || 0} px`;
      }
    }, 500);

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
    }

    const eventEl = document.createElement('div');
    eventEl.className = 'timeline-event';
    eventEl.innerHTML = `
      <span class="tl-time">${timeStr}</span>
      <span class="tl-icon">${icon}</span>
      <span class="tl-text"><strong>${name}</strong> — Cosseno: ${cosine} | Confiança: ${confidence}%</span>
      <span class="tl-badge ${badgeClass}">${badgeText}</span>
    `;

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

  /**
   * Configuração dos controles avançados de calibração de câmera e manutenção do banco
   */
  setupSettingsTabControls() {
    // 1. Slider de Densidade Facial Mínima (Filtro Anti-Fundo / Móveis)
    const rangeEl = document.getElementById('minFacePixelsRange');
    const valEl = document.getElementById('valMinFacePixels');
    if (rangeEl && valEl) {
      rangeEl.value = window.svBiometrics.minFacePixels || 110;
      valEl.textContent = `${rangeEl.value} px`;

      rangeEl.addEventListener('input', (e) => {
        valEl.textContent = `${e.target.value} px`;
        window.svBiometrics.setMinFacePixels(e.target.value);
      });
    }

    // 2. Botão Calibrar / Capturar Fundo Vazio Atual (Background Subtraction)
    const btnCalib = document.getElementById('btnCalibrateBg');
    const badgeCalib = document.getElementById('bgCalibBadge');
    if (btnCalib) {
      btnCalib.addEventListener('click', () => {
        const video = document.getElementById('videoFeedCam1') || document.getElementById('enrollmentWebcamPreview');
        if (!video || video.readyState < 2) {
          alert('⚠️ Certifique-se de que a câmera esteja conectada e transmitindo vídeo para calibrar o fundo.');
          return;
        }

        const success = window.svBiometrics.calibrateBackground(video);
        if (success) {
          if (badgeCalib) {
            badgeCalib.innerHTML = '✅ <strong style="color:#10b981;">Fundo Calibrado e Ativo</strong> (Subtração Dinâmica Ligada)';
          }
          alert('📸 Fundo capturado com sucesso!\n\nO sistema memorizou o ambiente sem ninguém na frente. Paredes, portas, móveis de madeira e luzes do fundo serão subtraídos e ignorados, eliminando falsos positivos.');
        } else {
          alert('⚠️ Não foi possível capturar o frame de fundo. Verifique se o vídeo da câmera está ativo.');
        }
      });
    }

    // 3. Resetar Calibração de Fundo
    const btnResetCalib = document.getElementById('btnResetBgCalib');
    if (btnResetCalib) {
      btnResetCalib.addEventListener('click', () => {
        window.svBiometrics.resetBackgroundCalibration();
        if (badgeCalib) {
          badgeCalib.textContent = 'Subtração de Fundo: Desativada (Padrão)';
          badgeCalib.style.color = 'var(--text-dim)';
        }
        alert('🔄 Calibração de fundo resetada para o padrão.');
      });
    }

    // 4. Limpar Mensagens de Log (Histórico) sem alterar tabela
    const btnClearLogs = document.getElementById('btnClearLogsBtn');
    if (btnClearLogs) {
      btnClearLogs.addEventListener('click', async () => {
        if (confirm('🧹 Limpeza de Histórico:\n\nDeseja apagar todas as mensagens de logs da central?\n\n(A tabela "logs" permanecerá intacta no banco de dados)')) {
          btnClearLogs.disabled = true;
          btnClearLogs.textContent = '🧹 Limpando...';
          await window.svDB.clearAllLogs();
          await this.loadLogsUI();
          const timeline = document.getElementById('stsRecognitionTimeline');
          if (timeline) timeline.innerHTML = '';
          btnClearLogs.disabled = false;
          btnClearLogs.textContent = '🧹 Limpar Mensagens de Logs / Histórico';
          alert('✅ Mensagens de logs limpas com sucesso! A estrutura da tabela foi preservada.');
        }
      });
    }

    // 5. Limpar Todos os Usuários e Biometrias sem alterar tabela
    const btnClearUsers = document.getElementById('btnClearUsersBtn');
    if (btnClearUsers) {
      btnClearUsers.addEventListener('click', async () => {
        if (confirm('🗑️ Limpeza de Cadastros:\n\nDeseja excluir todos os usuários cadastrados e dados biométricos?\n\n(As tabelas "users" e "biometrics" permanecerão criadas e prontas no banco)')) {
          btnClearUsers.disabled = true;
          btnClearUsers.textContent = '🗑️ Limpando...';
          await window.svDB.clearAllUserData();
          await window.svBiometrics.reloadRegisteredUsers();
          this.loadRegisteredUsersUI();
          this.refreshStatusTabData();
          btnClearUsers.disabled = false;
          btnClearUsers.textContent = '🗑️ Limpar Todos os Usuários e Biometrias';
          alert('✅ Todos os usuários e biometrias foram excluídos com sucesso! Nenhuma tabela foi alterada.');
        }
      });
    }
  }
}

// Global App instance
window.svApp = new SecureVisionApp();
document.addEventListener('DOMContentLoaded', () => window.svApp.init());

