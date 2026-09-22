# SecureVision AI (OlharDasMaquinas)

Sistema de vigilância, reconhecimento facial biométrico e controle de acesso 24h.

---

## 🚀 Como Executar o Sistema (1 Clique)

Você pode executar o projeto em **qualquer computador** de maneira simples:

### No Windows:
- Dê dois cliques em **`index.bat`** (ou **`INICIAR_PROJETO.bat`**).
  1. Ele verifica se o Python está presente na máquina.
  2. Se as bibliotecas ainda não tiverem sido instaladas, ele instala automaticamente via `pip`.
  3. Abre o servidor local seguro (`http://localhost:8000`) no seu navegador com **permissões totais para webcams e múltiplas câmeras USB**.
  4. Permite também executar o motor nativo em Python (`gemini-code-1788908867217.py`).

### No Linux / macOS:
```bash
chmod +x iniciar_projeto.sh instalar_dependencias.sh
./iniciar_projeto.sh
```

---

## 📦 Instalação Manual de Dependências Python

Caso queira apenas instalar as bibliotecas do Python antecipadamente:
- No Windows: Execute **`instalar_dependencias.bat`**.
- No Linux/macOS: Execute `./instalar_dependencias.sh`.
- Ou via terminal:
  ```bash
  pip install -r requirements.txt
  ```

### Bibliotecas Utilizadas:
- **`opencv-python`**: Captura de vídeo das webcams e processamento de imagem em tempo real.
- **`numpy`**: Operações matriciais e cálculo de descritores vetoriais ArcFace (128-D).
- **`ultralytics`** *(Opcional)*: Caso queira utilizar inferência neural YOLOv8 (o sistema conta com fallback anatômico inteligente para OpenCV caso não esteja instalado).

---

## 🛠️ Arquitetura Multi-Linguagem do Projeto

| Componente | Linguagem | Função |
| :--- | :--- | :--- |
| **Painel de Monitoramento** | HTML5, CSS3, JavaScript | Interface 24h, suporte a até 4 feeds de câmera, gráficos de FPS/GPU, cadastro facial com recorte em fundo preto e modo quiosque. |
| **Motor Biométrico Web** | JavaScript (`biometrics.js`) | Implementação ArcFace com margem angular aditiva, prova de vida (*liveness detection*) e extração vetorial. |
| **Banco de Dados Local** | IndexedDB (`db.js`) | Armazenamento seguro de usuários, descritores biométricos e logs com criptografia AES-GCM e conformidade LGPD. |
| **Motor de IA Nativo** | Python (`gemini-code-1788908867217.py`) | Reconhecimento facial nativo de alto desempenho via OpenCV/YOLO com isolamento de face em canvas neutro. |
| **Segurança na Nuvem** | SQL (`supabase_security_rls.sql`) | Esquema para Supabase/PostgreSQL com Row Level Security (RLS) e imutabilidade de logs de auditoria. |

---

## 📸 Cadastro Facial Sem Limite de Fotos
- O sistema permite o cadastramento de **fotos ilimitadas** por pessoa no menu de Cadastro.
- Quanto mais fotos em diferentes ângulos e expressões forem capturadas, maior será a precisão do centroide vetorial ArcFace no reconhecimento ao vivo.

---

## 🧬 Aumento de Dados Biométrico (Data Augmentation)
Para cada foto capturada de um usuário, o sistema multiplica automaticamente o banco de dados em **8 variações biométricas**:
1. **Foto Original Isolada** (fundo 100% preto).
2. **Espelhamento Horizontal (Inversão no Eixo X)**: Garante reconhecimento idêntico mesmo se a pessoa estiver virada para o lado oposto.
3. **Rotação Anatômica (-5°)**: Simula inclinação natural da cabeça à esquerda.
4. **Rotação Anatômica (+5°)**: Simula inclinação natural da cabeça à direita.
5. **Variação de Iluminação Alta (+18%)**: Garante robustez sob luz forte ou holofote.
6. **Variação de Iluminação Baixa (-15%)**: Garante reconhecimento em ambientes com sombra.
7. **Espelho com Iluminação Ajustada (+12%)**.
8. **Espelho com Rotação (-4°)**.

Tanto no Painel Web (`index.html`) quanto no Motor Python (`gemini-code-1788908867217.py`), os vetores gerados alimentam o banco de dados e elevam drasticamente a precisão de identificação em tempo real.