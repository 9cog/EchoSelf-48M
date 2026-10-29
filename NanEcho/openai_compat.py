#!/usr/bin/env python3
"""
OpenAI-compatible routes for the NanEcho servers.

``add_openai_routes`` adds

- ``GET  /v1/models``            -- lists the loaded checkpoint
- ``POST /v1/chat/completions``  -- generates with the loaded checkpoint
                                    (``stream: true`` streams the real sampled
                                    tokens as server-sent events)

to a FastAPI app, so that any OpenAI-compatible client -- including the local
model discovery in Eva (``echo/model/llm.scm``) and the other EchoSelf clients
-- can find and use a locally served NanEcho model. Both routes answer 503 when
no model is loaded, so discovery never mistakes an empty server for a model.
"""

import json
import time
import uuid
from dataclasses import dataclass
from typing import Any, AsyncIterator, Callable, Dict, Iterable, List, Optional, Tuple, Union

from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field


class OpenAIChatMessage(BaseModel):
    role: str
    content: str


class OpenAIChatRequest(BaseModel):
    model: Optional[str] = Field(default=None, description="Model id from /v1/models")
    messages: List[OpenAIChatMessage]
    max_tokens: Optional[int] = Field(default=None, description="Maximum tokens to generate")
    temperature: Optional[float] = Field(default=0.7)
    top_k: Optional[int] = Field(default=200, description="Top-k sampling (extension)")
    stream: bool = False


@dataclass
class ModelAdapter:
    """How the OpenAI routes reach a server's loaded model.

    get_model:    returns the loaded model object, or None when nothing is loaded
    model_id:     model -> id reported in /v1/models and responses
    build_prompt: (model, messages as dicts) -> prompt string for the checkpoint
    complete:     (model, prompt, max_tokens, temperature, top_k) -> (text, n_tokens)
    stream:       (model, prompt, max_tokens, temperature, top_k) -> iterable or
                  async iterable of real sampled tokens
    count_tokens: (model, text) -> number of tokens
    """
    get_model: Callable[[], Any]
    model_id: Callable[[Any], str]
    build_prompt: Callable[[Any, List[Dict[str, str]]], str]
    complete: Callable[[Any, str, int, float, int], Tuple[str, int]]
    stream: Callable[[Any, str, int, float, int], Union[Iterable[str], AsyncIterator[str]]]
    count_tokens: Callable[[Any, str], int]
    default_max_tokens: int = 256


def add_openai_routes(app: FastAPI, adapter: ModelAdapter) -> None:
    def require_model():
        model = adapter.get_model()
        if model is None:
            raise HTTPException(status_code=503, detail="No NanEcho model is loaded")
        return model

    @app.get("/v1/models")
    def list_models():
        model = require_model()
        return {
            "object": "list",
            "data": [{
                "id": adapter.model_id(model),
                "object": "model",
                "created": int(time.time()),
                "owned_by": "echoself-nanecho",
            }],
        }

    @app.post("/v1/chat/completions")
    def chat_completions(request: OpenAIChatRequest):
        model = require_model()
        model_id = adapter.model_id(model)
        if request.model and request.model != model_id:
            raise HTTPException(
                status_code=404,
                detail=f"Model {request.model!r} is not served here; this server serves {model_id!r}",
            )
        if not request.messages:
            raise HTTPException(status_code=400, detail="messages must not be empty")

        messages = [{"role": m.role, "content": m.content} for m in request.messages]
        prompt = adapter.build_prompt(model, messages)
        max_tokens = request.max_tokens or adapter.default_max_tokens
        temperature = 0.7 if request.temperature is None else request.temperature
        top_k = 200 if request.top_k is None else request.top_k
        completion_id = f"chatcmpl-{uuid.uuid4().hex}"
        created = int(time.time())

        if request.stream:
            def chunk(delta: Dict[str, Any], finish: Optional[str]) -> str:
                return "data: " + json.dumps({
                    "id": completion_id, "object": "chat.completion.chunk",
                    "created": created, "model": model_id,
                    "choices": [{"index": 0, "delta": delta, "finish_reason": finish}],
                }) + "\n\n"

            def failed(e: Exception) -> str:  # report the failure; never substitute text
                return "data: " + json.dumps({"error": {"message": f"Generation failed: {e}"}}) + "\n\n"

            def finished(count: int) -> List[str]:
                return [chunk({}, "length" if count >= max_tokens else "stop"), "data: [DONE]\n\n"]

            tokens = adapter.stream(model, prompt, max_tokens, temperature, top_k)
            if hasattr(tokens, "__aiter__"):
                async def event_stream():
                    yield chunk({"role": "assistant"}, None)
                    count = 0
                    try:
                        async for token in tokens:
                            count += 1
                            yield chunk({"content": token}, None)
                    except Exception as e:
                        yield failed(e)
                        return
                    for frame in finished(count):
                        yield frame
            else:
                # A synchronous token generator: Starlette iterates it in a
                # worker thread, so sampling does not block the event loop.
                def event_stream():
                    yield chunk({"role": "assistant"}, None)
                    count = 0
                    try:
                        for token in tokens:
                            count += 1
                            yield chunk({"content": token}, None)
                    except Exception as e:
                        yield failed(e)
                        return
                    yield from finished(count)

            return StreamingResponse(event_stream(), media_type="text/event-stream",
                                     headers={"Cache-Control": "no-cache"})

        try:
            text, n_tokens = adapter.complete(model, prompt, max_tokens, temperature, top_k)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Error generating response: {e}")
        prompt_tokens = adapter.count_tokens(model, prompt)
        return {
            "id": completion_id,
            "object": "chat.completion",
            "created": created,
            "model": model_id,
            "choices": [{
                "index": 0,
                "message": {"role": "assistant", "content": text},
                "finish_reason": "length" if n_tokens >= max_tokens else "stop",
            }],
            "usage": {
                "prompt_tokens": prompt_tokens,
                "completion_tokens": n_tokens,
                "total_tokens": prompt_tokens + n_tokens,
            },
        }
