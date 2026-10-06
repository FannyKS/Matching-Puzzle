#!/usr/bin/env python3
"""
Static file server for the browser suite.

Two extra endpoints, POST /report and POST /report-final, are where a probe page
publishes its results. Progress goes to /report; the real ending, including the
failure count, goes to /report-final. run.sh waits on the second file, so a late
progress post can never be mistaken for the ending.

  usage: server.py serve <port> [report-path] [final-path]
"""

import os
import sys
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPORT = None
FINAL = None


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def log_message(self, *args):
        pass

    def do_POST(self):
        if self.path not in ('/report', '/report-final'):
            self.send_error(404)
            return
        length = int(self.headers.get('Content-Length') or 0)
        body = self.rfile.read(length).decode('utf-8', 'replace')
        target = FINAL if self.path == '/report-final' else REPORT
        if target:
            # Truncate on the first progress post, then append: run.sh deletes
            # the files before each run, so the last file is always one run.
            mode = 'w' if (self.path == '/report' and not os.path.exists(target)) else 'a'
            with open(target, mode, encoding='utf-8') as fh:
                fh.write(body)
        self.send_response(204)
        self.send_header('Content-Length', '0')
        self.end_headers()

    def end_headers(self):
        # The suite re-imports the same URLs over and over within one page
        # load, so a cached script would silently test an older build.
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


def main():
    global REPORT, FINAL
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'serve'
    if cmd != 'serve':
        sys.exit('usage: server.py serve <port> [report] [final]')
    port = int(sys.argv[2]) if len(sys.argv) > 2 else 8765
    REPORT = sys.argv[3] if len(sys.argv) > 3 else None
    FINAL = sys.argv[4] if len(sys.argv) > 4 else None

    srv = ThreadingHTTPServer(('127.0.0.1', port), Handler)
    srv.daemon_threads = True
    print('serving %s on http://127.0.0.1:%d' % (ROOT, port), flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()