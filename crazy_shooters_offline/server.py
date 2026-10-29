import os
import sys
from http.server import HTTPServer, SimpleHTTPRequestHandler

DEFAULT_PORT = 8088
ROOT = os.path.dirname(os.path.abspath(__file__))

MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.wasm': 'application/wasm',
    '.unityweb': 'application/octet-stream',
    '.data': 'application/octet-stream',
}

class CrazyShootersHandler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        path = path.split('?')[0].split('#')[0]
        if path == '/' or path == '':
            path = '/index.html'
        clean = os.path.normpath(path.lstrip('/'))
        return os.path.join(ROOT, clean)

    def end_headers(self):
        self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
        self.send_header('Cross-Origin-Embedder-Policy', 'require-corp')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def do_GET(self):
        filepath = self.translate_path(self.path)
        if not os.path.exists(filepath) or not os.path.isfile(filepath):
            self.send_error(404, f"File Not Found: {self.path}")
            return

        ext = os.path.splitext(filepath)[1].lower()
        content_type = MIME_TYPES.get(ext, 'application/octet-stream')

        self.send_response(200)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(os.path.getsize(filepath)))

        if ext == '.unityweb':
            self.send_header('Content-Encoding', 'gzip')

        self.end_headers()

        with open(filepath, 'rb') as f:
            chunk_size = 64 * 1024
            while True:
                chunk = f.read(chunk_size)
                if not chunk:
                    break
                try:
                    self.wfile.write(chunk)
                except (BrokenPipeError, ConnectionResetError):
                    break

def run_server(port=DEFAULT_PORT):
    while True:
        try:
            server_address = ('127.0.0.1', port)
            httpd = HTTPServer(server_address, CrazyShootersHandler)
            print("=" * 55)
            print(f"🎮 Crazy Shooters Offline Server (Python) is RUNNING!")
            print(f"📡 URL: http://127.0.0.1:{port}")
            print(f"📂 Root: {ROOT}")
            print("⚡ Gzip Streaming & Cross-Origin Isolation: ACTIVE")
            print("=" * 55)
            httpd.serve_forever()
            break
        except OSError as e:
            if e.errno == 10048:  # Port in use
                print(f"Port {port} in use, trying {port + 1}...")
                port += 1
            else:
                raise

if __name__ == '__main__':
    run_server()
