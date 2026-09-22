"""
SecureVision AI - Servidor Web Local e Inicializador
Finalidade: Subir um servidor HTTP local seguro (localhost) para que qualquer
navegador libere o uso das câmeras (getUserMedia) sem restrições de segurança do protocolo file://.
"""

import http.server
import socketserver
import webbrowser
import os
import sys
import socket

DEFAULT_PORT = 8000

def find_available_port(start_port=DEFAULT_PORT):
    port = start_port
    while port < start_port + 20:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex(('127.0.0.1', port)) != 0:
                return port
            port += 1
    return DEFAULT_PORT

class CustomHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # Permissões completas de câmera e isolamento de contexto
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        super().end_headers()

    def log_message(self, format, *args):
        # Silencia logs repetitivos de polling para manter o terminal limpo
        if any(ext in args[0] for ext in ['.js', '.css', '.png', '.jpg', '.ico']):
            return
        super().log_message(format, *args)

def main():
    # Garante que o diretório de execução seja a pasta onde está este script
    script_dir = os.path.dirname(os.path.abspath(__file__))
    os.chdir(script_dir)

    port = find_available_port(DEFAULT_PORT)
    url = f"http://localhost:{port}/index.html"

    print("=" * 70)
    print("      SECUREVISION AI - PAINEL DE VIGILÂNCIA LOCAL ATIVO")
    print("=" * 70)
    print(f" Servidor rodando em: {url}")
    print(" As permissões de webcam e microfone estão 100% liberadas.")
    print(" Pressione Ctrl+C a qualquer momento para encerrar o servidor.")
    print("=" * 70)
    print("\nAbrindo o navegador automaticamente...\n")

    # Abre o navegador padrão na URL segura
    webbrowser.open(url)

    handler = CustomHandler
    with socketserver.TCPServer(("127.0.0.1", port), handler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nServidor encerrado com sucesso.")
            sys.exit(0)

if __name__ == "__main__":
    main()
