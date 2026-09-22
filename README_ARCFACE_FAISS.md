# SecureVision AI — Motor de Biometria ArcFace + Análise Física Multimodal + FAISS

> **Arquitetura de Engenharia de Visão Computacional & IA Sênior**
> Pipeline completo de extração de embeddings faciais profundos, análise física complementar (pele e orelha), armazenamento vetorial em FAISS (sub-milissegundo) e inferência em tempo real para câmeras de vigilância.

---

## 📌 Visão Geral do Sistema

O sistema substitui abordagens tradicionais e imprecisas por um **pipeline multimodal de 707 dimensões** estruturado em dois momentos fundamentais:

1. **Fase 1: Cadastro Perpétuo de Vetores (
egister_faces.py)**:
   - Lê as fotos das pessoas cadastradas na pasta dataset/.
   - Detecta o rosto via **YuNet** e realiza o **alinhamento afim canônico 2D** (112x112 px) com 5 marcos faciais anatômicos (olhos, nariz, cantos da boca).
   - Extrai o **Embedding Profundo ArcFace (512-D)** representando a geometria óssea e proporções faciais.
   - Extrai características físicas complementares:
     - **Cor e Textura da Pele (123-D)**: compensação de iluminação (*Gray-World Retinex* + CLAHE em CIE-L*a*b*) + *Uniform Local Binary Patterns* (LBP).
     - **Biometria das Orelhas (72-D)**: projeção anatômica bilateral, HOG de contorno cartilaginoso e razões geométricas, com tratamento inteligente para oclusões (cabelos).
   - Funde os vetores em um vetor unificado ponderado e normalizado $ (**707-D**).
   - Indexa no **FAISS (IndexFlatIP)** e salva os metadados em JSON para busca instantânea.

2. **Fase 2: Inferência e Comparação na Câmera ao Vivo (camera_matching.py)**:
   - Captura frames em tempo real de webcam (--source 0), arquivo de vídeo (.mp4) ou stream RTSP.
   - Gera instantaneamente o vetor multimodal do rosto detectado.
   - Consulta o banco **FAISS em menos de 0.2 milissegundos (< 200 µs)** por produto interno/similaridade de cosseno.
   - Aplica a **calibração de confiança sigmoide** ( \ge 0.70 ightarrow >95\%$ de confiança).
   - Exibe o **HUD de Vigilância Profissional**:
     - Retângulo verde [AUTORIZADO] com nome e porcentagem de confiança.
     - Retângulo vermelho [ALERTA - DESCONHECIDO] para visitantes não cadastrados.
     - Taxa de FPS em tempo real, latência em ms e decomposição forense (ArcFace %, Pele %, Orelha %).

---

## 📐 Estrutura Matemática dos Vetores

| Componente Biométrico | Dimensões | Algoritmo / Modelo | Normalização |
| :--- | :---: | :--- | :---: |
| **Estrutura Facial Profunda** | **512-D** | ArcFace MobileFaceNet ONNX (ResNet backbone) | Norma Euclidiana $ |
| **Cor e Textura da Pele** | **123-D** | CIE-L*a*b* Soft Histogram (60-D) + Momentos (4-D) + Uniform LBP (59-D) | Norma Euclidiana $ |
| **Biometria das Orelhas** | **72-D** | HOG de Cartilagem (64-D) + Razões Geométricas (8-D) | Norma Euclidiana $ |
| **Vetor Multimodal Fused** | **707-D** | Fusão Ponderada: $[0.80 \mathbf{v}_{	ext{arc}} \parallel 0.12 \mathbf{v}_{	ext{skin}} \parallel 0.08 \mathbf{v}_{	ext{ear}}]$ | **$\|\mathbf{v}\|_2 = 1.0$** |

### Por que usar o FAISS (IndexFlatIP)?
Para vetores normalizados na esfera unitária ($\|\mathbf{v}\| = 1$), o produto interno é **exatamente igual à Similaridade de Cosseno**:
\langle \mathbf{u}, \mathbf{v} angle = \sum_{i=1}^{707} u_i v_i = \cos(	heta)
O FAISS utiliza instruções vetoriais SIMD (AVX2/AVX-512) na CPU para calcular essa similaridade contra milhares de identidades em frações de milissegundo, permitindo que a câmera opere a 60+ FPS sem engasgos.

---

## 🚀 Como Executar

### 1. Pré-requisitos
Os pacotes já foram instalados no ambiente:
`ash
pip install faiss-cpu onnxruntime opencv-python numpy
`

### 2. Cadastrar Pessoas no Banco Vetorial (Fase 1)
Crie uma pasta com as fotos das pessoas ou use a pasta dataset/:
`
dataset/
  Zinedine_Zidane/
    foto1.jpg
    foto2.jpg
  Carlos_Alberto/
    foto1.jpg
`
*(Ou simplesmente coloque arquivos nomeados como dataset/Carlos_Alberto.jpg)*

Execute o comando de cadastro:
`ash
python register_faces.py --dataset dataset/ --storage storage/
`
Para limpar o banco anterior e recriar do zero:
`ash
python register_faces.py --dataset dataset/ --storage storage/ --clear
`

### 3. Executar o Reconhecimento ao Vivo na Câmera (Fase 2)
Para abrir a sua webcam:
`ash
python camera_matching.py --source 0
`
Para processar um arquivo de vídeo ou RTSP:
`ash
python camera_matching.py --source video_seguranca.mp4
# ou
python camera_matching.py --source rtsp://admin:senha@192.168.1.100:554/live
`

**Atalhos do Teclado na Janela da Câmera:**
- q ou ESC: Sair da aplicação.
- s: Salvar um snapshot de segurança com a sobreposição forense.
- : Alternar exibição dos detalhes forenses (ArcFace, Pele, Orelha).
- 
: Recarregar o banco de vetores do disco sem reiniciar o script.

### 4. Executar os Testes Automatizados e Benchmarks
Para validar toda a precisão matemática e latência:
`ash
python benchmark_and_test.py
`
Esse comando executa 7 testes unitários e de integração, incluindo latência do FAISS (< 0.2 ms) e separação de pessoas autorizadas vs impostores.

---

## 📂 Arquivos do Projeto

- iometric_engine.py: Motor central contendo FaceDetector, ArcFaceEmbeddingExtractor, SkinBiometricExtractor, EarBiometricExtractor e BiometricPipeline.
- ector_registry.py: Banco de dados vetorial FAISS com persistência em disco e calibração sigmoide.
- 
egister_faces.py: Script CLI de cadastro em lote de fotos.
- camera_matching.py: Script de inferência em tempo real na câmera de segurança.
- enchmark_and_test.py: Suite de testes e benchmarks de latência/acurácia.
- models/: Contém os modelos neurais ONNX (w600k_mbf.onnx e ace_detection_yunet_2023mar.onnx).
- storage/: Armazena o índice vetorial iometric_registry.faiss e metadados iometric_registry.json.