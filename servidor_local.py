# tresD DICOM - servidor local para probar docs\ (lo usa ABRIR_tresD_DICOM.bat).
# Igual que `python -m http.server` pero con cabeceras "no-store": el navegador no guarda en cache
# index.html ni los assets, asi que cada apertura muestra la ultima version construida.
import http.server, os, sys, functools

PORT = 8123
DOCS = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'docs')

class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def log_message(self, fmt, *args):
        pass  # sin ruido en la ventana

if __name__ == '__main__':
    handler = functools.partial(Handler, directory=DOCS)
    try:
        srv = http.server.ThreadingHTTPServer(('127.0.0.1', PORT), handler)
    except OSError:
        print('El puerto %d ya esta en uso: probablemente hay otra ventana del servidor abierta. Usa esa.' % PORT)
        sys.exit(0)
    print('tresD DICOM sirviendo %s en http://localhost:%d/  (cierra esta ventana para apagarlo)' % (DOCS, PORT))
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
