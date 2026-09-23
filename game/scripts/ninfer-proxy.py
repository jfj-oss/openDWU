#!/usr/bin/env python3
"""Normalizing proxy between Claude Code and ninfer-serve (Anthropic Messages API).

1. Claude Code sends some messages first as [{type:text, text, cache_control}] and later
as a plain string.
2. It also sends role=system messages mid-conversation, which the Qwen chat template
hoists to the top system prompt (changing the prompt head every turn). ninfer-serve renders the two shapes differently, so the prompt
diverges early and the hybrid (GDN) model can't reuse its KV/turn checkpoints
(every turn = reuse=full_reset). This proxy canonicalizes content so consecutive
requests are exact extensions of each other.

Usage: ninfer-proxy.py [listen_port=8099] [upstream=http://127.0.0.1:8095] [bind_host=127.0.0.1]
(e.g. bind the Tailscale IP to serve the MacBook wrapper over the tailnet)
"""
import http.server, itertools, json, os, sys, urllib.request, urllib.error

LISTEN = int(sys.argv[1]) if len(sys.argv) > 1 else 8099
UPSTREAM = sys.argv[2] if len(sys.argv) > 2 else "http://127.0.0.1:8095"
BIND = sys.argv[3] if len(sys.argv) > 3 else "127.0.0.1"
DUMP_DIR = os.environ.get("NINFER_PROXY_DUMP")  # debug: write each canonicalized request here
_seq = itertools.count(1)


def canon_content(c):
    if isinstance(c, list):
        blocks = []
        for b in c:
            if isinstance(b, dict):
                b = {k: v for k, v in b.items() if k != "cache_control"}
            blocks.append(b)
        if len(blocks) == 1 and isinstance(blocks[0], dict) and blocks[0].get("type") == "text":
            return blocks[0]["text"]
        return blocks
    return c


def canonicalize(body):
    if isinstance(body.get("system"), list):
        body["system"] = canon_content(body["system"])
    for m in body.get("messages", []):
        m["content"] = canon_content(m.get("content"))
        # Claude Code puts role=system messages mid-conversation; the Qwen template
        # hoists them into the top system prompt, so the prompt head changes every
        # turn and nothing is reusable. Send them as user-side reminders instead.
        if m.get("role") == "system":
            text = m["content"] if isinstance(m["content"], str) else json.dumps(m["content"])
            m["role"] = "user"
            m["content"] = "<system-reminder>\n" + text + "\n</system-reminder>"
    for t in body.get("tools", []) or []:
        t.pop("cache_control", None)
    return body


class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.0"

    def do_POST(self):
        raw = self.rfile.read(int(self.headers.get("content-length", 0)))
        if self.path.startswith("/v1/messages"):
            try:
                raw = json.dumps(canonicalize(json.loads(raw))).encode()
                if DUMP_DIR:
                    with open(os.path.join(DUMP_DIR, f"req{next(_seq):04d}.json"), "wb") as f:
                        f.write(raw)
            except ValueError:
                pass
        headers = {k: v for k, v in self.headers.items() if k.lower() not in ("host", "content-length", "connection")}
        req = urllib.request.Request(UPSTREAM + self.path, raw, headers, method="POST")
        try:
            resp = urllib.request.urlopen(req, timeout=3600)
        except urllib.error.HTTPError as e:
            resp = e
        self.send_response(resp.status if hasattr(resp, "status") else resp.code)
        for k, v in resp.headers.items():
            if k.lower() not in ("transfer-encoding", "content-length", "connection"):
                self.send_header(k, v)
        self.end_headers()
        while True:
            chunk = resp.read(4096)
            if not chunk:
                break
            self.wfile.write(chunk)
            self.wfile.flush()

    def do_GET(self):
        try:
            resp = urllib.request.urlopen(UPSTREAM + self.path, timeout=30)
        except urllib.error.HTTPError as e:
            resp = e
        body = resp.read()
        self.send_response(resp.status if hasattr(resp, "status") else resp.code)
        self.send_header("content-type", resp.headers.get("content-type", "application/json"))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    http.server.ThreadingHTTPServer((BIND, LISTEN), Handler).serve_forever()
