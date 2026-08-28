import json
import os
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


MODEL = "hermes-agent-qualification"
DELAY = max(0.0, min(float(os.environ.get("MODEL_STUB_DELAY_MS", "120")) / 1000.0, 2.0))


def text_content(message):
    content = message.get("content", "") if isinstance(message, dict) else ""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return " ".join(part.get("text", "") for part in content if isinstance(part, dict) and part.get("type") == "text")
    return ""


def event(delta, finish=None):
    return {
        "id": "chatcmpl-qualification",
        "object": "chat.completion.chunk",
        "created": 0,
        "model": MODEL,
        "choices": [{"index": 0, "delta": delta, "finish_reason": finish}],
    }


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, _format, *_args):
        return

    def body(self, status, payload):
        encoded = json.dumps(payload, separators=(",", ":")).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(encoded)

    def do_GET(self):
        if self.path == "/health":
            self.body(200, {"status": "ok"})
        elif self.path == "/v1/models":
            self.body(200, {"object": "list", "data": [{"id": MODEL, "object": "model"}]})
        else:
            self.body(404, {})

    def do_POST(self):
        if self.path != "/v1/chat/completions":
            self.body(404, {})
            return
        try:
            length = int(self.headers.get("Content-Length", ""))
            if length < 0 or length > 1024 * 1024:
                self.body(413, {})
                return
            payload = json.loads(self.rfile.read(length))
        except (ValueError, json.JSONDecodeError):
            self.body(400, {})
            return
        if payload.get("model") != MODEL or payload.get("stream") is not True:
            self.body(400, {})
            return

        messages = payload.get("messages", [])
        last_user = next((text_content(message) for message in reversed(messages) if isinstance(message, dict) and message.get("role") == "user"), "")
        has_tool_result = any(isinstance(message, dict) and message.get("role") == "tool" for message in messages)
        chunks = []
        if "QUALIFY_TOOL" in last_user and not has_tool_result:
            tools = payload.get("tools", [])
            terminal = next((tool.get("function", {}).get("name") for tool in tools if "terminal" in tool.get("function", {}).get("name", "").lower()), None)
            if terminal:
                chunks.append(event({"role": "assistant", "tool_calls": [{"index": 0, "id": "call_qualification", "type": "function", "function": {"name": terminal, "arguments": "{\"command\":\"rm -rf /tmp/hermes-agent-qualification-empty\"}"}}]}, "tool_calls"))
            else:
                chunks.append(event({"role": "assistant", "content": "No terminal tool was advertised; optional tool scenario unavailable."}, "stop"))
        elif has_tool_result:
            chunks.extend([
                event({"role": "assistant", "content": "Tool activity observed. "}),
                event({"content": "Qualification complete."}, "stop"),
            ])
        elif "QUALIFY_SLOW" in last_user:
            chunks.append(event({"role": "assistant", "content": "Slow qualification stream started. "}))
            for index in range(80):
                chunks.append(event({"content": f"step-{index + 1} "}, "stop" if index == 79 else None))
        else:
            chunks.extend([
                event({"role": "assistant", "content": "Hermes qualification "}),
                event({"content": "stream complete."}, "stop"),
            ])

        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "close")
        self.end_headers()
        for chunk in chunks:
            self.wfile.write(f"data: {json.dumps(chunk, separators=(',', ':'))}\n\n".encode())
            self.wfile.flush()
            time.sleep(DELAY)
        self.wfile.write(b"data: [DONE]\n\n")
        self.wfile.flush()


ThreadingHTTPServer(("0.0.0.0", 8000), Handler).serve_forever()
