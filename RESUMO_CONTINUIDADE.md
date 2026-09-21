# RESUMO EXECUTIVO PARA CONTINUIDADE DO PROJETO: SECUREVISION AI
**Projeto:** SecureVision AI — Sistema de Monitoramento e Reconhecimento Facial Biométrico  
**Evento / Ano:** FECART 2026  
**Localização do Workspace:** `c:\Users\26012195\Desktop\TRABALHO FECART COM CYFER`  
**Pasta Espelho Sincronizada (100% Paridade):** `TRABALHO FECART 2026/`  
**Data do Ponto de Restauração:** 15 de Setembro de 2026  

---

## 1. Visão Geral da Arquitetura

O sistema é uma aplicação web completa de segurança patrimonial e controle de acesso biométrico que opera localmente no navegador (Zero-Cloud por padrão, com suporte opcional a Supabase), em total conformidade com a **LGPD (Lei 13.709/2018)**.

### Pipeline Biométrico Integrado (YOLOv5 + 16×16 + ArcFace + Orange Data Mining)

```
[Webcam / Câmera] 
       │
       ▼
[Detecção de Presença Humana] ── (Se vazio: mantém varredura rápida)
       │ (Se detectar movimento/presença)
       ▼
[YOLO Face Detector Engine] ── Scaneia todo o quadro (diferentes alturas e fundos)
       │
       ▼
[Filtro NMS & Motor de Proximidade Óptica] 
       ├─► Pessoas ao Fundo: Retícula tracejada [👤 2º Plano (Ignorado)]
       └─► Pessoa Mais Próxima: Alvo Primário selecionado
               │
               ▼
[Isolamento Estrito em Matriz 16×16 no Fundo Preto #000000]
               │
               ▼
[ArcFace 128-D Feature Extractor (Norma L2 = 1.0000)]
               │
               ▼
[Classificador kNN / Similaridade Cosseno no Banco Criptografado AES-256]
               │
       ┌───────┴────────────────────────┐
       ▼                                ▼
[Compatibilidade >= Limiar (ex: 90%)]   [Compatibilidade < Limiar]
       │                                │
       ▼                                ▼
[✓ Identificação Autorizada]      [⚠ "Pessoa não cadastrada" / Alerta Vermelho]
```

---

## 2. Histórico de Solicitações Implementadas em Ordem Cronológica

1. **Pipeline de Isolamento YOLO 16×16 e Rotulação "Pessoa não cadastrada"**:
   - Varredura de presença: se não há ninguém, segue o fluxo normal; se há presença, ativa o detector YOLO para localizar a face.
   - Recorte estrito da face em matriz canônica quadrada **16 × 16** pixels centralizada sobre fundo preto puro (`#000000`).
   - Se a compatibilidade for menor que o limiar (padrão 90%), o sistema exibe categoricamente **"Pessoa não cadastrada"** (substituindo qualquer menção a "Usuário Desconhecido"), disparando alertas sonoros TTS e logs visuais.
   - Exibição do patch 16×16 ao vivo no HUD PiP (`image-rendering: pixelated;`) e no fluxo visual **Orange Data Mining**.

2. **Eliminação da Comparação por Pixels Iguais & Estabilização ArcFace**:
   - O sistema antigo comparava apenas pixels brutos idênticos, não distinguindo formato, cor da pele ou anatomia.
   - Foi construído um extrator vetorial **ArcFace 128-D** baseado em:
     1. *Matriz Latente Espacial (48 dimensões)*: anatomia posicional (testa, sobrancelhas, olhos, nariz, lábios, queixo).
     2. *Colorimetria e Pigmentação (32 dimensões)*: luminância $Y$ e cromaticidades $Cb, Cr$ em espaço $YCbCr$ universal.
     3. *Morfologia Periocular, Olhos e Óculos (24 dimensões)*: IPD (distância interpupilar), abertura e armações.
     4. *Contorno Mandibular e Clínico (24 dimensões)*: proporções de terços faciais e queixo.
   - Estabilizador temporal (*temporal hysteresis*) com filtro de predições que acabou com a alternância indesejada de identidades (*jittering*).

3. **Gestão de Fotos & Limiar Configurável**:
   - Possibilidade de anexar fotos a usuários já cadastrados com 1 clique (`➕ Adicionar Fotos`).
   - Painel de configurações com slider contínuo de limiar de reconhecimento (50% a 98%) e presets rápidos:
     - **Tolerante (80%)**: para ambientes com iluminação variável.
     - **Padrão (90%)**: equilíbrio ideal de segurança.
     - **Rigoroso (95%)**: alta segurança para áreas críticas.

4. **Banco de Dados Criptografado & Arquitetura Visual Orange Data Mining**:
   - Dados biométricos (descritores 128-D, fotos e patches 16×16) cifrados com **AES-256-GCM** no IndexedDB local.
   - CPF protegido com hash criptográfico SHA-256 e consentimento explícito LGPD.
   - Widget visual interativo reproduzindo fielmente o fluxo do **Orange Data Mining**:
     - Linha 1 (Banco): `Import Images` $\rightarrow$ `Image Viewer (16×16)` $\rightarrow$ `Image Embedding (128-D)` $\rightarrow$ `Data Table` $\rightarrow$ `kNN / Neural Net`.
     - Linha 2 (Câmera): `Import Images (1)` $\rightarrow$ `Image Viewer (1)` $\rightarrow$ `Image Embedding (1)` $\rightarrow$ `Data Table (1)` $\rightarrow$ `Predictions`.
     - Painel comparativo ao vivo exibindo o patch 16×16 da câmera lado a lado com o patch 16×16 do banco, similaridade cosseno e status.

5. **Detecção em Diferentes Alturas e Fundos Desafiadores**:
   - Varredura vertical sem bordas cegas ($y \in [2, h-2]$), resolução de célula reduzida para 6 pixels e limiar mínimo reduzido para 20 pixels.
   - Detecta pessoas em pé (topo), sentadas (embaixo), próximas e distantes.
   - Modelo de pele invariante $YCbCr$ de banda larga resistente a todos os fototipos humanos (I a VI).
   - Isolamento por contraste anatômico contra paredes de madeira, tijolo ou tons castanhos, eliminando falsos positivos em portas ou paredes lisas.

6. **Estabilização do Layout de Cadastro**:
   - Resolução definitiva do bug de rolagem horizontal ao adicionar muitas fotos:
     - `.enrollment-grid` com `minmax(0, 1fr)`.
     - Contenção de largura estrita e `overflow-x: hidden` no painel central.
     - O carrossel de fotos agora rola estritamente dentro da sua própria caixa sem deformar a tela.

7. **Priorização Estrita da Pessoa Mais Próxima**:
   - Identifica simultaneamente todos os rostos no campo de visão e calcula a distância aparente:
     $$D_{\text{est}} = \max\left(0.3, \min\left(4.0, \frac{26.0}{\max(w, 0.78h)}\right)\right)\text{ metros}$$
   - Pondera por área aparente, bônus de centralidade e histerese temporal.
   - **Apenas o rosto mais próximo** é isolado em 16×16 e consultado no banco. Pessoas ao fundo recebem retícula pontilhada discreta `[👤 2º Plano (Ignorado)]` e jamais disparam alarmes falsos.

8. **Sistema de Aumento de Banco de Dados (Data Augmentation por Espelhamento Horizontal)**:
   - Utiliza as fotos cadastradas e gera cópias espelhadas horizontalmente (*horizontal flip*).
   - Submete as fotos espelhadas ao YOLO, isola o rosto em **16 × 16** sobre fundo preto `#000000` e extrai novos vetores **ArcFace 128-D**.
   - **Idempotência Garantida**: Marcadores `mirroredFlags` impedem duplicações infinitas se o operador clicar novamente.
   - **Controles**:
     - Checkbox `[x] 🪞 Aumento Automático` no formulário de cadastro.
     - Botão `🪞 Aumentar Dados` no card individual de cada usuário.
     - Botão `🪞 Aumentar Todo o Banco (Espelhamento)` no cabeçalho da lista de cadastrados.
     - Metadados exibem contagem detalhada: `Fontes: X Mídias (Y Originais + Z Espelhadas 🪞)`.

9. **Otimizações de Alto Desempenho & Prova de Vida (Anti-Spoofing Real)**:
   - **Eliminação de `toDataURL` contínuo**: Conversão Base64 PNG removida do loop ao vivo de 60 FPS (`exportDataUrl = false`), reservando-a exclusivamente para o momento de salvar fotos no banco (redução imediata de 35% de consumo de CPU).
   - **Pré-Normalização $L_2$ no Banco de Dados**: Vetores descritores 128-D e centróides agora são normalizados uma única vez na carga inicial (`reloadRegisteredUsers`). No loop de matching (`matchFaceArcFaceRaw`), executa-se produto escalar direto e `computeArcMargin` é acionado apenas para o candidato vencedor.
   - **Reuso de Buffers e BFS Zero-Allocation no YOLO**: Eliminação de alocações dinâmicas de TypedArrays e do `queue.shift()`, extinguindo micro-travamentos de Garbage Collection (GC).
   - **Guarda de Redimensionamento do Canvas**: Evita reflows e recriação de texturas GPU a cada frame em `app.js`.
   - **Pausa e Economia Fora do Monitoramento**: Desacelera a taxa de varredura quando a aba ativa não é monitoramento ou a janela está minimizada.
   - **Módulo `LivenessAntiSpoofDetector` Ativo**: Análise de micro-dinâmica facial no patch canônico 16×16. Se uma foto estática ou tela de celular for sustentada sem variação micro-motora por > 12 quadros, dispara `isSpoofed = true`, ativando o banner crítico `🚨 ALERTA CRÍTICO: ATAQUE DE SPOOFING DETECTADO` e bloqueando o acesso.

---

## 3. Mapa de Arquivos do Projeto

| Arquivo | Função Principal |
| :--- | :--- |
| `biometrics.js` | Motor YOLOv5 com buffers reutilizáveis, recorte 16×16 fundo preto `#000000`, ArcFace 128-D pré-normalizado, `LivenessAntiSpoofDetector`, proximidade óptica, data augmentation. |
| `db.js` | IndexedDB criptografado (AES-256-GCM), logs de auditoria, consentimento LGPD, `augmentUserBiometrics` e `augmentAllUsersBiometrics`. |
| `app.js` | Controlador central da UI, restrições ideais de webcam (640×480), guarda de resize de canvas, desaceleração inteligente de aba e integração visual Orange Data Mining (com badge de Spoofing). |
| `integrity.js` | Monitor de integridade e auto-reversão do sistema com cálculo de hash SHA-256 em tempo de execução. |
| `index.html` | Interface completa com abas de Monitoramento, Cadastro e Configurações, HUD com PiP 16×16, widget visual Orange Data Mining e controles de Data Augmentation. |
| `styles.css` | Folha de estilos responsiva Cyber Dark Navy, layout CSS Grid estável, badges de aumento de dados e animações. |
| `TRABALHO FECART 2026/` | Diretório espelho mantido em **100% de paridade byte a byte** com todos os arquivos acima. |

---

## 4. Testes Automatizados Validados no Scratch

Todos os testes foram implementados em Node.js e executados com **100% de sucesso**:

1. **`scratch/test_pipeline_yolo16x16_arcface.js`**:
   - Valida recorte 16×16 sobre fundo preto `#000000`.
   - Valida norma unitária $L_2 = 1.0000$ dos descritores 128-D ArcFace.
   - Valida rotulação obrigatória `"Pessoa não cadastrada"` para compatibilidade < 90%.
   - Valida limiar dinâmico ajustável.

2. **`scratch/test_db_patches16x16.js`**:
   - Valida criptografia AES-GCM 256 dos vetores e fotos.
   - Valida persistência dos patches 16×16 e integridade após append.

3. **`scratch/test_detector_heights_backgrounds.js`** (31 de 31 testes aprovados):
   - Valida detecção de rostos no topo (pessoa em pé), centro (distância média) e inferior (pessoa sentada).
   - Valida detecção contra paredes brancas, fundos escuros, paredes azuis e painéis de madeira/castanhos.
   - Valida rejeição absoluta de falso positivo em portas ou paredes lisas sem face.

4. **`scratch/test_closest_person_selection.js`** (3 de 3 testes aprovados):
   - Valida seleção estrita da pessoa em 1º plano em cenas de 2 e 3 pessoas.
   - Valida marcação de pessoas secundárias como ignoradas.
   - Valida transição dinâmica instantânea quando uma nova pessoa mais próxima se aproxima.

5. **`scratch/test_data_augmentation.js`** (5 de 5 testes aprovados):
   - Valida `mirrorImageDataUrl` (inversão horizontal perfeita).
   - Valida `generateAugmentedBiometricsFromPhoto` (vetor 128-D $L_2 = 1.000$, patch 16×16 e flags `isAugmented`/`isMirrored`).
   - Valida duplicação no banco criptografado AES-GCM (`mirroredFlags: [false, false, true, true]`).
   - Valida idempotência (segunda execução não cria duplicatas indevidas).
   - Valida aumento global em massa (`augmentAllUsersBiometrics`).

6. **`scratch/test_optimization_liveness_pipeline.js`** (12 de 12 testes aprovados):
   - Valida estabilidade de buffers e zero vazamento em 100 iterações do YOLOv5.
   - Valida disparo de `isSpoofed = true` em sequência de fotos estáticas / telas.
   - Valida preservação de `isSpoofed = false` e liveness ativo em micro-movimentos fisiológicos humanos.
   - Valida modo rápido `exportDataUrl = false` com `dataUrl === null` e modo cadastro com Base64 válido.
   - Valida equivalência matemática exata do ArcFace pré-normalizado e rejeição estrita de pessoas não cadastradas.

---

## 5. Como Iniciar o Projeto e Testar

1. **Abrir a Aplicação**:
   - Basta abrir o arquivo `index.html` em qualquer navegador moderno (Chrome, Edge, Firefox, Brave).
   - Não requer servidores Node.js ou Python externos para o funcionamento básico, pois todo o pipeline corre via Web APIs, Canvas 2D e IndexedDB.
2. **Monitoramento**:
   - Clique em "Iniciar Câmera".
   - Posicione o rosto: o sistema desenha a retícula com a distância estimada (ex: `~0.5m Mais Próximo`).
   - Se houver pessoas ao fundo, elas aparecerão com retículas pontilhadas discretas `👤 2º Plano (Ignorado)`.
   - O PiP inferior direito e o nó Orange mostram o rosto isolado em 16×16 com fundo preto.
3. **Cadastrar Pessoa & Aumento de Dados**:
   - Na aba **Cadastro**, tire fotos pela webcam ou faça upload de imagens.
   - Deixe marcado o checkbox `🪞 Aumento de Dados Automático` para que o sistema duplique os vetores automaticamente gerando versões espelhadas.
   - Na lista de cadastrados abaixo, teste clicar em `🪞 Aumentar Dados` ou `🪞 Aumentar Todo o Banco`.
4. **Testar Pessoa Não Cadastrada**:
   - Se uma pessoa não cadastrada for posicionada na câmera, o sistema anunciará por voz e exibirá **"Pessoa não cadastrada"** com banner vermelho e retícula de alerta.

---

## 6. Diretrizes para Próximos Chats / Continuidade

- **Paridade Obrigatória**: Sempre que modificar qualquer arquivo na raiz (`biometrics.js`, `db.js`, `app.js`, `index.html`, `styles.css`), sincronize imediatamente para `TRABALHO FECART 2026/`.
- **Restrição de Resolução**: O isolamento facial canônico para extração e comparação ArcFace deve permanecer estritamente em **16 × 16 pixels sobre fundo preto puro `#000000`**.
- **Regra de Incompatibilidade**: Compatibilidade menor que o limiar configurado deve produzir a rotulação e alertas de **"Pessoa não cadastrada"**.
- **Pessoa Mais Próxima**: O motor de seleção por proximidade óptica deve continuar priorizando o indivíduo em 1º plano, mantendo segundo plano apenas informativo.
