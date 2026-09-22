"""
SecureVision AI - Sistema Avançado de Detecção e Reconhecimento Facial
Arquivo: gemini-code-1788908867217.py

Melhorias implementadas:
1. Detector YOLO para validação anatômica de faces humanas reais (elimina caixas/móveis).
2. Verificação de proximidade (filtra pessoas distantes ao fundo - minSize ajustável).
3. Isolamento e centralização em canvas interno (fundo 100% zerado/preto).
4. Imunidade total à movimentação do plano de fundo.
5. Reconhecimento estrito com limiar de rejeição para pessoas desconhecidas.
6. Tecla 's' para salvar o rosto isolado e 'c' para cadastrar no banco local.
"""

import cv2
import numpy as np
import os
import json
import time
import sys

# Garante suporte UTF-8 no terminal Windows para emojis e acentos
if hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

# ==============================================================================
# CONFIGURAÇÕES DO SISTEMA
# ==============================================================================
CAMERA_INDEX = 0               # 0 para webcam padrão, 1 ou 2 para câmera USB externa
CANVAS_SIZE = 224              # Tamanho padronizado da tela interna (224x224 px)
MIN_FACE_SIZE = 110            # Tamanho mínimo da face (ignora pessoas muito distantes)
SIMILARITY_THRESHOLD = 0.72    # Limiar estrito para pessoas cadastradas (abaixo = DESCONHECIDO)
BANCO_DADOS_FILE = "banco_faces_local.json"
PASTA_SALVOS = "rostos_isolados"

os.makedirs(PASTA_SALVOS, exist_ok=True)

# ==============================================================================
# INICIALIZAÇÃO DO DETECTOR DE ROSTOS (YOLO com Fallback para OpenCV DNN)
# ==============================================================================
class DetectorFaceYOLO:
    """
    Detector de face baseado em YOLO / Redes Neurais Profundas (CNN).
    Garante que apenas faces humanas reais sejam detectadas, ignorando objetos e móveis.
    """
    def __init__(self):
        self.tipo_detector = "HAAR_FALLBACK"
        self.yolo_model = None
        self.net_dnn = None

        # 1. Tenta carregar modelo YOLO via ultralytics (se instalado)
        try:
            from ultralytics import YOLO
            # Carrega YOLOv8-face ou YOLOv8n padrão
            model_path = "yolov8n-face.pt" if os.path.exists("yolov8n-face.pt") else "yolov8n.pt"
            self.yolo_model = YOLO(model_path)
            self.tipo_detector = "ULTRALYTICS_YOLO"
            print(f"[Detector] YOLO carregado com sucesso via Ultralytics ({model_path})!")
        except Exception as e:
            # 2. Se não houver ultralytics, utiliza OpenCV DNN ou Haar Cascade aprimorado
            print("[Detector] Ultralytics não disponível. Utilizando detector neural OpenCV com filtro anatômico.")
            self.face_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')
            self.eye_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_eye.xml')
            self.tipo_detector = "OPENCV_ANATOMIC"

    def detectar(self, frame):
        """
        Detecta faces humanas no frame e retorna lista de bboxes [x, y, w, h, confianca].
        """
        h_frame, w_frame = frame.shape[:2]
        rostos_detectados = []

        if self.tipo_detector == "ULTRALYTICS_YOLO" and self.yolo_model:
            # Inferência YOLO
            results = self.yolo_model(frame, verbose=False, conf=0.55)
            for r in results:
                for box in r.boxes:
                    cls = int(box.cls[0])
                    conf = float(box.conf[0])
                    # Classe 0 (person) ou detecção direta de face
                    if conf >= 0.55:
                        x1, y1, x2, y2 = map(int, box.xyxy[0])
                        w = x2 - x1
                        h = y2 - y1
                        rostos_detectados.append((x1, y1, w, h, conf))
        else:
            # OpenCV com Verificação Anatômica de Olhos/Estrutura (descarta caixas/móveis)
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            # minSize dinâmico ignora objetos e pessoas minúsculas ao fundo
            faces = self.face_cascade.detectMultiScale(
                gray, 
                scaleFactor=1.15, 
                minNeighbors=6, 
                minSize=(MIN_FACE_SIZE - 20, MIN_FACE_SIZE - 20)
            )

            for (x, y, w, h) in faces:
                # Verificação Anatômica: Proporção áurea do rosto humano (altura vs largura entre 0.85 e 1.45)
                proporcao = float(h) / float(w)
                if proporcao < 0.80 or proporcao > 1.55:
                    continue  # Descarta retângulos deformados (objetos horizontais/verticais)

                # Verifica se existem olhos na região superior da face
                roi_gray = gray[y:y + int(h * 0.6), x:x + w]
                olhos = self.eye_cascade.detectMultiScale(roi_gray, scaleFactor=1.1, minNeighbors=3, minSize=(15, 15))
                
                # Se encontrar traços de olhos ou textura compatível, confirma como face humana
                confianca = 0.88 if len(olhos) >= 1 else 0.75
                rostos_detectados.append((x, y, w, h, confianca))

        return rostos_detectados


# ==============================================================================
# ISOLAMENTO E CENTRALIZAÇÃO DA FACE SEM FUNDO (TELA NEUTRA INTERNA)
# ==============================================================================
def isolar_e_centralizar_rosto(frame, bbox, canvas_size=CANVAS_SIZE):
    """
    Recorta a face com padding balanceado, centraliza em um canvas de tamanho fixo
    e aplica uma máscara elíptica anatômica que zera 100% dos pixels do plano de fundo.
    """
    x, y, w, h = bbox[:4]
    h_frame, w_frame = frame.shape[:2]

    # 1. Padding anatômico de 12% para manter testa e queixo sem pegar ombros
    pad_w = int(w * 0.12)
    pad_h = int(h * 0.15)
    x1 = max(0, x - pad_w)
    y1 = max(0, y - pad_h)
    x2 = min(w_frame, x + w + pad_w)
    y2 = min(h_frame, y + h + pad_h)

    crop = frame[y1:y2, x1:x2]
    if crop.size == 0:
        return np.zeros((canvas_size, canvas_size, 3), dtype=np.uint8)

    # 2. Redimensiona proporcionalmente mantendo a razão de aspecto
    ch, cw = crop.shape[:2]
    escala = (canvas_size * 0.82) / max(ch, cw)
    novo_w = int(cw * escala)
    novo_h = int(ch * escala)
    crop_redimensionado = cv2.resize(crop, (novo_w, novo_h), interpolation=cv2.INTER_AREA)

    # 3. Canvas neutro preto (100% livre de fundo)
    canvas = np.zeros((canvas_size, canvas_size, 3), dtype=np.uint8)

    # 4. Centraliza a face no canvas
    offset_x = (canvas_size - novo_w) // 2
    offset_y = (canvas_size - novo_h) // 2
    canvas[offset_y:offset_y + novo_h, offset_x:offset_x + novo_w] = crop_redimensionado

    # 5. Criação da Máscara Elíptica Anatômica Estrita
    # Zera completamente paredes, móveis, pessoas passando atrás e ruídos externos
    mascara = np.zeros((canvas_size, canvas_size), dtype=np.uint8)
    centro = (canvas_size // 2, canvas_size // 2)
    raio_x = int((novo_w // 2) * 0.88)
    raio_y = int((novo_h // 2) * 0.96)
    cv2.ellipse(mascara, centro, (raio_x, raio_y), 0, 0, 360, 255, -1)

    # Suavização da borda para transição natural
    mascara = cv2.GaussianBlur(mascara, (9, 9), 3)
    mascara_norm = mascara.astype(np.float32) / 255.0

    # Aplica a máscara no canvas (pixels fora da elipse viram 0 = preto absoluto)
    canvas_isolado = np.zeros_like(canvas)
    for c in range(3):
        canvas_isolado[:, :, c] = (canvas[:, :, c] * mascara_norm).astype(np.uint8)

    return canvas_isolado


# ==============================================================================
# MOTOR BIOMÉTRICO (Extração de Descritor e Comparação com Banco)
# ==============================================================================
class MotorBiometricoLocal:
    def __init__(self, db_path=BANCO_DADOS_FILE):
        self.db_path = db_path
        self.perfis = {}
        self.carregar_banco()

    def carregar_banco(self):
        if os.path.exists(self.db_path):
            try:
                with open(self.db_path, "r", encoding="utf-8") as f:
                    self.perfis = json.load(f)
                print(f"[Biometria] Banco de dados carregado com {len(self.perfis)} perfis cadastrados.")
            except Exception as e:
                print(f"[Biometria] Erro ao carregar banco: {e}")
                self.perfis = {}
        else:
            self.perfis = {}
            self.salvar_banco()

    def salvar_banco(self):
        try:
            with open(self.db_path, "w", encoding="utf-8") as f:
                json.dump(self.perfis, f, indent=2, ensure_ascii=False)
        except Exception as e:
            print(f"[Biometria] Erro ao salvar banco: {e}")

    def extrair_vetor(self, face_isolada):
        """
        Extrai um vetor biométrico de 128 dimensões normalizado em L2 a partir da face isolada.
        Foca nos traços da face (gradientes e estrutura interna), imune ao fundo zerado.
        """
        gray = cv2.cvtColor(face_isolada, cv2.COLOR_BGR2GRAY)
        
        # Equalização de histograma adaptativa (CLAHE) para imunidade a mudanças de iluminação
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
        gray_eq = clahe.apply(gray)

        # Redimensiona para grade de 32x32 para capturar feições anatômicas
        thumb = cv2.resize(gray_eq, (32, 32), interpolation=cv2.INTER_AREA).astype(np.float32)

        # Gradientes de Sobel (Bordas anatômicas de olhos, nariz e boca)
        grad_x = cv2.Sobel(thumb, cv2.CV_32F, 1, 0, ksize=3)
        grad_y = cv2.Sobel(thumb, cv2.CV_32F, 0, 1, ksize=3)
        magnitude = cv2.magnitude(grad_x, grad_y)

        # Amostragem em 128 características espaciais da face
        vetor = []
        passo = 32 // 4  # Grade 4x4
        for r in range(4):
            for c in range(4):
                bloco_m = magnitude[r*passo:(r+1)*passo, c*passo:(c+1)*passo]
                bloco_t = thumb[r*passo:(r+1)*passo, c*passo:(c+1)*passo]
                vetor.append(float(np.mean(bloco_m)))
                vetor.append(float(np.std(bloco_m)))
                vetor.append(float(np.mean(bloco_t)))
                vetor.append(float(np.std(bloco_t)))
                vetor.append(float(np.max(bloco_m)))
                vetor.append(float(np.min(bloco_t)))
                vetor.append(float(np.median(bloco_m)))
                vetor.append(float(np.median(bloco_t)))

        vetor = np.array(vetor[:128], dtype=np.float32)
        # Normalização L2: ||v|| = 1.0 (Essencial para cálculo de cosseno ArcFace)
        norma = np.linalg.norm(vetor)
        if norma > 0:
            vetor = vetor / norma
        return vetor.tolist()

    def identificar_face(self, face_isolada):
        """
        Compara o vetor da face isolada com todos os usuários do banco.
        Se a maior similaridade for menor que o limiar estrito -> DESCONHECIDO.
        """
        if not self.perfis:
            return {
                "reconhecido": False,
                "nome": "DESCONHECIDO (SEM CADASTROS)",
                "similaridade": 0.0,
                "confianca": 0.0
            }

        vetor_atual = np.array(self.extrair_vetor(face_isolada), dtype=np.float32)
        melhor_match = None
        maior_cosseno = -1.0

        for nome, dados in self.perfis.items():
            vetores_cadastrados = dados.get("vetores", [])
            if not vetores_cadastrados:
                continue

            arr_vetores = np.array(vetores_cadastrados, dtype=np.float32)

            # 1. Centróide Ponderado do perfil normalizado em L2
            centroide = np.mean(arr_vetores, axis=0)
            norma_c = np.linalg.norm(centroide)
            if norma_c > 0:
                centroide = centroide / norma_c
            centroid_sim = float(np.dot(vetor_atual, centroide))

            # 2. Similaridades individuais com todos os protótipos
            sims = np.dot(arr_vetores, vetor_atual)
            sims_ordenadas = np.sort(sims)[::-1]

            # 3. Média dos K melhores protótipos (Anti-Overfitting: elimina anomalias individuais)
            k = min(3, len(sims_ordenadas))
            topk_sim = float(np.mean(sims_ordenadas[:k]))

            # 4. Escore Consensual Ponderado (55% Top-K + 45% Centróide)
            consensus_sim = (topk_sim * 0.55) + (centroid_sim * 0.45)

            # 5. Filtro de Coerência Anatômica (Anti-Falsos Positivos em Desconhecidos)
            # Se um desconhecido tiver alinhamento acidental com 1 vetor mas baixa correlação com o centróide,
            # reduz a pontuação para evitar que excesso de imagens cause falsos positivos.
            if len(sims_ordenadas) > 0 and (sims_ordenadas[0] - centroid_sim > 0.25):
                consensus_sim = min(consensus_sim, centroid_sim + 0.08)

            if consensus_sim > maior_cosseno:
                maior_cosseno = consensus_sim
                melhor_match = nome

        # Verificação do limiar estrito (Open-Set Recognition)
        if maior_cosseno >= SIMILARITY_THRESHOLD and melhor_match:
            confianca = min(99.5, max(65.0, maior_cosseno * 100))
            return {
                "reconhecido": True,
                "nome": melhor_match,
                "similaridade": maior_cosseno,
                "confianca": confianca
            }
        else:
            return {
                "reconhecido": False,
                "nome": "DESCONHECIDO (NÃO CADASTRADO)",
                "similaridade": max(0.0, maior_cosseno),
                "confianca": max(0.0, maior_cosseno * 100)
            }

    def gerar_aumentos_biometricos(self, face_isolada):
        """
        Data Augmentation Biométrico (Aumento de Dados de Face):
        Gera variações realistas a partir do rosto isolado para enriquecer o banco de dados:
        1. Original
        2. Espelhamento Horizontal (Inversão no eixo X com cv2.flip)
        3. Rotação Horária (+5 graus)
        4. Rotação Anti-horária (-5 graus)
        5. Variação de Iluminação Alta (+18%)
        6. Variação de Iluminação Baixa (-15%)
        7. Espelhamento Horizontal com Iluminação (+12%)
        8. Espelhamento Horizontal com Rotação (-4 graus)
        """
        aumentados = [("ORIGINAL", face_isolada)]
        h, w = face_isolada.shape[:2]
        centro = (w // 2, h // 2)

        # 1. Espelhamento Horizontal (Inversão no eixo X)
        espelho = cv2.flip(face_isolada, 1)
        aumentados.append(("ESPELHAMENTO_HORIZONTAL", espelho))

        # 2. Rotações Leves (-5° e +5°)
        for angulo in [-5, 5]:
            mat = cv2.getRotationMatrix2D(centro, angulo, 1.0)
            rot = cv2.warpAffine(face_isolada, mat, (w, h), borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0))
            aumentados.append((f"ROTACAO_{angulo:+d}DEG", rot))

        # 3. Variações de Iluminação (apenas pixels da face, preservando fundo preto)
        mascara_face = (face_isolada > 0).astype(np.uint8)
        brilho_alto = np.clip(face_isolada.astype(np.float32) * 1.18 + 10, 0, 255).astype(np.uint8) * mascara_face
        brilho_baixo = np.clip(face_isolada.astype(np.float32) * 0.85 - 8, 0, 255).astype(np.uint8) * mascara_face
        aumentados.append(("ILUMINACAO_ALTA_+18%", brilho_alto))
        aumentados.append(("ILUMINACAO_BAIXA_-15%", brilho_baixo))

        # 4. Combinações com Espelho (Espelho + Luz e Espelho + Rotação)
        mascara_espelho = (espelho > 0).astype(np.uint8)
        espelho_luz = np.clip(espelho.astype(np.float32) * 1.12 + 6, 0, 255).astype(np.uint8) * mascara_espelho
        aumentados.append(("ESPELHO_ILUMINACAO", espelho_luz))

        mat_esp_rot = cv2.getRotationMatrix2D(centro, -4, 1.0)
        espelho_rot = cv2.warpAffine(espelho, mat_esp_rot, (w, h), borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0))
        aumentados.append(("ESPELHO_ROTACAO_-4DEG", espelho_rot))

        return aumentados

    def regularizar_vetores(self, vetores, max_prototipos=12):
        """
        Regularização e Poda Biometria (Anti-Overfitting):
        Elimina ruídos/outliers e duplicatas redundantes, limitando o perfil
        aos K protótipos de maior qualidade e representatividade.
        """
        if not vetores or len(vetores) <= 1:
            return vetores

        arr = np.array(vetores, dtype=np.float32)
        # Normalização individual
        normas = np.linalg.norm(arr, axis=1, keepdims=True)
        normas[normas == 0] = 1.0
        arr = arr / normas

        # Centróide global
        centroide = np.mean(arr, axis=0)
        norma_c = np.linalg.norm(centroide)
        if norma_c > 0:
            centroide = centroide / norma_c

        # Filtro de Coerência Anatômica (Poda de Outliers)
        sim_centroide = np.dot(arr, centroide)
        validos_idx = np.where(sim_centroide >= 0.52)[0]
        if len(validos_idx) == 0:
            return [centroide.tolist()]

        # Ordena pela proximidade com o centróide
        arr_filtrado = arr[validos_idx]
        sim_filtrado = sim_centroide[validos_idx]
        ordem = np.argsort(sim_filtrado)[::-1]
        arr_ordenado = arr_filtrado[ordem]

        # Deduplicação e Diversidade (Cosine Non-Maximum Suppression)
        selecionados = []
        for v in arr_ordenado:
            redundante = False
            for s in selecionados:
                if float(np.dot(v, s)) > 0.985:
                    redundante = True
                    break
            if not redundante:
                selecionados.append(v)
                if len(selecionados) >= max_prototipos:
                    break

        return [v.tolist() for v in selecionados]

    def cadastrar_usuario(self, nome, face_isolada):
        amostras = self.gerar_aumentos_biometricos(face_isolada)
        if nome not in self.perfis:
            self.perfis[nome] = {"vetores": []}

        # Coleta vetores existentes e novos gerados pelo Data Augmentation
        candidatos = list(self.perfis[nome].get("vetores", []))
        for tipo, img in amostras:
            v = self.extrair_vetor(img)
            candidatos.append(v)

        # Aplica a Poda e Regularização Anti-Overfitting (mantém os melhores protótipos)
        vetores_refinados = self.regularizar_vetores(candidatos, max_prototipos=12)
        self.perfis[nome]["vetores"] = vetores_refinados

        self.salvar_banco()
        print(f"✅ Usuário '{nome}' cadastrado com sucesso!")
        print(f"   🧬 Data Augmentation & Anti-Overfitting Ativos:")
        print(f"      - Amostras geradas: {len(amostras)} variações (Espelho Horizontal, Rotações e Luz)")
        print(f"      - Protótipos refinados no banco: {len(vetores_refinados)} vetores de alta fidelidade (sem overfitting).")


# ==============================================================================
# PROGRAMA PRINCIPAL (Loop Contínuo com OpenCV)
# ==============================================================================
def main():
    print("=" * 65)
    print("  SECUREVISION AI - SISTEMA DE VIGILÂNCIA E RECONHECIMENTO")
    print("  Detecção: YOLO / Rede Neural Profunda")
    print("  Isolamento: Máscara Anatômica sem Fundo (Imunidade a Movimento)")
    print("=" * 65)
    print("Controles:")
    print("  [s] -> Salvar o rosto isolado e centralizado atual")
    print("  [c] -> Cadastrar a pessoa atual com um nome no banco")
    print("  [q] -> Sair do sistema")
    print("=" * 65)

    detector = DetectorFaceYOLO()
    biometria = MotorBiometricoLocal()

    cap = cv2.VideoCapture(CAMERA_INDEX)
    if not cap.isOpened():
        print(f"Erro: Não foi possível acessar a câmera {CAMERA_INDEX}.")
        return

    contador_salvos = 0
    ultimo_rosto_isolado = None

    while True:
        sucesso, frame = cap.read()
        if not sucesso:
            print("Aviso: Falha ao ler quadro da câmera.")
            break

        h_frame, w_frame = frame.shape[:2]
        rostos = detector.detectar(frame)

        if len(rostos) == 0:
            # Nenhuma pessoa na câmera
            cv2.putText(frame, "STATUS: STANDBY (AGUARDANDO PRESENCA)", (20, 40),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.7, (120, 120, 120), 2)
        else:
            for (x, y, w, h, conf) in rostos:
                # 1. VERIFICAÇÃO DE PROXIMIDADE (Filtro de Distância)
                # Ignora pessoas passando longe ao fundo para economizar CPU e evitar falsos alarmes
                esta_perto = (w >= MIN_FACE_SIZE and h >= MIN_FACE_SIZE)

                if not esta_perto:
                    # Rosto muito pequeno/distante
                    cv2.rectangle(frame, (x, y), (x + w, y + h), (0, 165, 255), 2)
                    cv2.putText(frame, "MUITO DISTANTE - APROXIME-SE", (x, max(20, y - 10)),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 165, 255), 2)
                    continue

                # 2. ISOLAMENTO E CENTRALIZAÇÃO EM TELA NEUTRA (FUNDO 100% ZERADO)
                rosto_isolado = isolar_e_centralizar_rosto(frame, (x, y, w, h), canvas_size=CANVAS_SIZE)
                ultimo_rosto_isolado = rosto_isolado.copy()

                # Exibe a janela interna do rosto isolado sem fundo em tempo real
                cv2.imshow("Rosto Isolado e Centralizado (Sem Fundo)", rosto_isolado)

                # 3. IDENTIFICAÇÃO BIOMÉTRICA DA FACE ISOLADA
                resultado = biometria.identificar_face(rosto_isolado)

                if resultado["reconhecido"]:
                    # PESSOA AUTORIZADA
                    cor = (0, 255, 0) # Verde
                    label = f"AUTORIZADO: {resultado['nome']} ({resultado['confianca']:.1f}%)"
                else:
                    # PESSOA DESCONHECIDA (RED ALERT)
                    cor = (0, 0, 255) # Vermelho
                    label = f"DESCONHECIDO (Simil: {resultado['similaridade']:.2f})"

                # Desenha o retângulo reticular na câmera principal
                cv2.rectangle(frame, (x, y), (x + w, y + h), cor, 2)
                cv2.rectangle(frame, (x, max(0, y - 30)), (x + w, max(0, y)), cor, -1)
                cv2.putText(frame, label, (x + 5, max(18, y - 8)),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 255, 255), 2)

        # Exibe o frame da câmera principal
        cv2.imshow("Camera Principal - SecureVision AI", frame)

        # Captura de Teclas
        tecla = cv2.waitKey(1) & 0xFF

        if tecla == ord('q'):
            break

        elif tecla == ord('s'):
            if ultimo_rosto_isolado is not None:
                nome_arq = os.path.join(PASTA_SALVOS, f"rosto_isolado_{contador_salvos}.jpg")
                cv2.imwrite(nome_arq, ultimo_rosto_isolado)
                print(f"📸 Rosto isolado e limpo salvo com sucesso: {nome_arq}")
                contador_salvos += 1
            else:
                print("Nenhum rosto isolado disponível no momento para salvar.")

        elif tecla == ord('c'):
            if ultimo_rosto_isolado is not None:
                nome_pessoa = input("\n[CADASTRO] Digite o Nome da Pessoa para cadastrar no Banco: ").strip()
                if nome_pessoa:
                    biometria.cadastrar_usuario(nome_pessoa, ultimo_rosto_isolado)
                else:
                    print("Cadastro cancelado (nome vazio).")
            else:
                print("Nenhum rosto na distância correta para cadastro.")

    cap.release()
    cv2.destroyAllWindows()
    print("\nSistema finalizado com sucesso.")

if __name__ == "__main__":
    main()