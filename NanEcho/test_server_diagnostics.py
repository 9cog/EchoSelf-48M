#!/usr/bin/env python3
"""
/diagnostics must not diagnose data that was never measured.

A stub AtomSpace answers /status and /atoms/count but fails the goal, attention and
STI queries. Both diagnostics endpoints must then answer 502 without asking the model,
and the client must raise rather than report an empty agent state.
"""

import http.server
import os
import sys
import threading

sys.path.append(os.path.dirname(os.path.abspath(__file__)))

import server  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402


class _PartialAtomSpace(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        if self.path.startswith("/status"):
            code, body = 200, b"{}"
        elif self.path.startswith("/atoms/count"):
            code, body = 200, b'{"count": 42}'
        else:
            code, body = 500, b"query failed"
        self.send_response(code)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


class _ModelThatMustNotRun:
    model_path = "unused"
    asked = False

    def generate(self, **kwargs):
        _ModelThatMustNotRun.asked = True
        raise AssertionError("the model must not diagnose unmeasured data")


def test_failed_atomspace_query_is_an_error_not_empty_state():
    atomspace = http.server.HTTPServer(("127.0.0.1", 0), _PartialAtomSpace)
    threading.Thread(target=atomspace.serve_forever, daemon=True).start()
    endpoint = f"http://127.0.0.1:{atomspace.server_port}"
    server.app.dependency_overrides[server.get_model_config] = lambda: _ModelThatMustNotRun()
    try:
        client = TestClient(server.app)
        for path in ("/diagnostics", "/diagnostics/stream"):
            response = client.post(path, json={"atomspace_endpoint": endpoint})
            assert response.status_code == 502, (path, response.status_code, response.text)
        assert not _ModelThatMustNotRun.asked

        atomspace_client = server.AtomSpaceClient(endpoint)
        assert atomspace_client.get_atom_count() == 42
        for query in (atomspace_client.get_active_goals,
                      atomspace_client.get_attention_allocation_summary,
                      atomspace_client.get_high_sti_atoms):
            try:
                query()
            except server.AtomSpaceQueryError:
                continue
            raise AssertionError(f"{query.__name__} returned a value for a failed query")
    finally:
        server.app.dependency_overrides.clear()
        atomspace.shutdown()


if __name__ == "__main__":
    test_failed_atomspace_query_is_an_error_not_empty_state()
    print("ok")
