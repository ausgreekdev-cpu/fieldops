#!/usr/bin/env python3
"""Serve `expo export --platform web` output locally (npm run build:web).

Clean URLs: /jobs/edit → jobs/edit.html, /jobs → jobs/index.html.
The app has no "/" route — "/" redirects to /login.
Deep links with no prerender (e.g. /jobs/<uuid>) fall back to the login
shell so expo-router matches the route client-side.

Usage: python3 scripts/serve-web.py [dir] [port]   (default: dist 3000)
"""
import http.server
import os
import sys

ROOT = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else 'dist')
PORT = int(sys.argv[2]) if len(sys.argv) > 2 else 3000


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def send_head(self):
        if self.path in ('/', '/index.html') and not os.path.isfile(os.path.join(ROOT, 'index.html')):
            self.send_response(302)
            self.send_header('Location', '/login')
            self.end_headers()
            return None
        return super().send_head()

    def translate_path(self, path):
        p = super().translate_path(path)
        if os.path.isfile(p):
            return p
        if os.path.isfile(p + '.html'):
            return p + '.html'
        idx = os.path.join(p, 'index.html')
        if os.path.isfile(idx):
            return idx
        shell = os.path.join(ROOT, 'login.html')
        return shell if os.path.isfile(shell) else os.path.join(ROOT, 'index.html')

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write('%s - %s\n' % (self.address_string(), fmt % args))


if __name__ == '__main__':
    if not os.path.isdir(ROOT):
        sys.exit(f'{ROOT} not found — run: npm run build:web')
    server = http.server.ThreadingHTTPServer(('0.0.0.0', PORT), Handler)
    print(f'serving {ROOT} on :{PORT}', flush=True)
    server.serve_forever()
