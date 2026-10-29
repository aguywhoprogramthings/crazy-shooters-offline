import errno
import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlsplit

DEFAULT_PORT = int(os.environ.get('PORT', '8088'))
HOST = os.environ.get('HOST', '127.0.0.1')
ROOT = os.path.realpath(os.path.dirname(os.path.abspath(__file__)))


def publish_ready_file(port):
    """Tell the launcher which port this particular server bound to."""
    ready_file = os.environ.get('CSO_PORT_FILE')
    if not ready_file:
        return
    temporary_file = f'{ready_file}.{os.getpid()}.tmp'
    try:
        with open(temporary_file, 'x', encoding='utf-8') as ready:
            ready.write(f'{port},{os.getpid()}\n')
        os.replace(temporary_file, ready_file)
    finally:
        try:
            os.unlink(temporary_file)
        except FileNotFoundError:
            pass


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
    def end_headers(self):
        self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
        self.send_header('Cross-Origin-Embedder-Policy', 'require-corp')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def serve_game_file(self, send_body):
        request_path = unquote(urlsplit(self.path).path)
        if request_path in ('', '/'):
            request_path = '/index.html'
        if '\0' in request_path:
            self.send_error(400, 'Invalid request path')
            return
        filepath = os.path.realpath(os.path.join(ROOT, request_path.lstrip('/')))
        try:
            allowed = os.path.commonpath((ROOT, filepath)) == ROOT
        except ValueError:  # Different drives on Windows.
            allowed = False
        if not allowed:
            self.send_error(403, 'Access Denied')
            return
        if not os.path.isfile(filepath):
            self.send_error(404, f'File Not Found: {request_path}')
            return

        ext = os.path.splitext(filepath)[1].lower()
        self.send_response(200)
        self.send_header('Content-Type', MIME_TYPES.get(ext, 'application/octet-stream'))
        self.send_header('Content-Length', str(os.path.getsize(filepath)))
        if ext == '.unityweb':
            self.send_header('Content-Encoding', 'gzip')
        self.end_headers()
        if not send_body:
            return

        with open(filepath, 'rb') as game_file:
            while True:
                chunk = game_file.read(64 * 1024)
                if not chunk:
                    break
                try:
                    self.wfile.write(chunk)
                except (BrokenPipeError, ConnectionResetError):
                    break

    def do_GET(self):
        self.serve_game_file(True)

    def do_HEAD(self):
        self.serve_game_file(False)


def run_server(port=DEFAULT_PORT, host=HOST):
    while True:
        try:
            # Unity downloads several large files at once. A single-threaded
            # HTTPServer serialized those requests and slowed game startup.
            httpd = ThreadingHTTPServer((host, port), CrazyShootersHandler)
            actual_port = httpd.server_address[1]
            try:
                publish_ready_file(actual_port)
            except OSError:
                httpd.server_close()
                raise
            print('=' * 55, flush=True)
            print('Crazy Shooters Offline Server (Python) is RUNNING!', flush=True)
            print(f'URL: http://127.0.0.1:{actual_port}', flush=True)
            print(f'Root: {ROOT}', flush=True)
            print('Gzip Streaming & Cross-Origin Isolation: ACTIVE', flush=True)
            print('=' * 55, flush=True)
            httpd.serve_forever()
            break
        except OSError as error:
            if error.errno in (errno.EADDRINUSE, 10048):
                print(f'Port {port} in use, trying {port + 1}...', flush=True)
                port += 1
            else:
                raise


if __name__ == '__main__':
    run_server()
