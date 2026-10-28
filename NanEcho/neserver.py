#!/usr/bin/env python3
"""
NanEcho Server

FastAPI server for the NanEcho model that represents Echo Self cognitive architecture.
Extended from server.py with Echo Self specific endpoints and capabilities.
"""

import os
import sys
import argparse
import json
import time
import uvicorn
from datetime import datetime
from typing import List, Dict, Any, Optional, AsyncGenerator
from pydantic import BaseModel, Field

# Add parent directory to path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

try:
    from fastapi import FastAPI, HTTPException, BackgroundTasks
    from fastapi.responses import StreamingResponse, JSONResponse
    from fastapi.middleware.cors import CORSMiddleware
    import torch
except ImportError as e:
    print(f"Missing required dependency: {e}")
    print("Please install: pip install fastapi uvicorn torch")
    sys.exit(1)

from netalk import EchoModelConfig

NOT_AVAILABLE_DETAIL = (
    "{feature} is not available: the NanEcho model has no {feature} state to report. "
    "Only data measured from the loaded checkpoint is served."
)

# Request/Response Models
class EchoChatMessage(BaseModel):
    role: str = Field(..., description="Message role (user/assistant)")
    content: str = Field(..., description="Message content")
    timestamp: Optional[float] = Field(default=None, description="Message timestamp")

class EchoChatRequest(BaseModel):
    messages: List[EchoChatMessage] = Field(..., description="Conversation messages")
    max_tokens: int = Field(default=500, description="Maximum tokens to generate")
    temperature: float = Field(default=0.7, description="Sampling temperature")
    top_k: int = Field(default=200, description="Top-k sampling")
    stream: bool = Field(default=False, description="Enable streaming response")
    echo_mode: bool = Field(default=True, description="Enable Echo Self mode")
    introspection_depth: int = Field(default=3, description="Echo Self introspection depth")

class EchoChatResponse(BaseModel):
    text: str = Field(..., description="Generated response")
    model: str = Field(..., description="Model name")
    created_at: float = Field(..., description="Response timestamp")
    tokens_generated: int = Field(..., description="Number of tokens generated")
    echo_metadata: Dict[str, Any] = Field(..., description="Generation metadata")

class EchoIntrospectionRequest(BaseModel):
    text: Optional[str] = Field(default=None, description="Text to introspect (defaults to the last chat prompt)")
    depth: int = Field(default=3, description="Introspection depth")
    enable_recursion: bool = Field(default=True, description="Enable recursive analysis")
    persona_focus: Optional[str] = Field(default=None, description="Focus on specific persona dimension")
    analyze: bool = Field(default=True, description="Have the model generate an analysis of the measurements")

class EchoStatusResponse(BaseModel):
    status: str = Field(..., description="Server status")
    model_loaded: bool = Field(..., description="Whether model is loaded")
    echo_depth: int = Field(..., description="Configured Echo Self depth")
    persona_dimensions: List[str] = Field(..., description="Configured persona dimensions")
    iter_num: Optional[int] = Field(default=None, description="Checkpoint training iteration")
    best_val_loss: Optional[float] = Field(default=None, description="Checkpoint best validation loss")
    uptime: float = Field(..., description="Server uptime in seconds")

class EchoAttentionUpdate(BaseModel):
    cognitive_load: float = Field(..., description="Current cognitive load (0.0-1.0)")
    recent_activity: float = Field(..., description="Recent activity level (0.0-1.0)")
    recalculate_threshold: bool = Field(default=True, description="Recalculate attention threshold")

# Global variables
model_config: Optional[EchoModelConfig] = None
server_start_time = time.time()
echo_state = {
    "chat_requests": 0,
    "stream_requests": 0,
    "tokens_generated": 0,
    "introspection_count": 0,
    "last_prompt": None,
    "last_introspection": None,
}

# FastAPI app
app = FastAPI(
    title="NanEcho Server",
    description="Echo Self Cognitive Architecture API",
    version="1.0.0"
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _require_model() -> EchoModelConfig:
    if model_config is None or not model_config.loaded:
        raise HTTPException(status_code=503, detail="Echo Self model not loaded")
    return model_config


def _format_prompt(messages: List[EchoChatMessage]) -> str:
    prompt_parts = []
    for msg in messages[-10:]:  # Last 10 messages for context
        role = "User" if msg.role == "user" else "Echo"
        prompt_parts.append(f"{role}: {msg.content}")
    prompt_parts.append("Echo: ")
    return "\n".join(prompt_parts)


@app.get("/", response_model=Dict[str, Any])
async def root():
    """Root endpoint with server information."""
    return {
        "name": "NanEcho - Echo Self Cognitive Architecture Server",
        "version": "1.0.0",
        "description": "API for chatting with the trained NanEcho model and inspecting its measured internals",
        "status": "active" if model_config is not None and model_config.loaded else "no_model",
        "endpoints": [
            "/chat", "/chat/stream", "/introspect", "/echo/state", "/echo/attention", "/health"
        ]
    }

@app.get("/status", response_model=EchoStatusResponse)
async def get_status():
    """Get Echo Self server status."""
    loaded = model_config is not None and model_config.loaded
    info = model_config.model_info if loaded else {}
    return EchoStatusResponse(
        status="active" if loaded else "no_model",
        model_loaded=loaded,
        echo_depth=model_config.echo_depth if model_config else 3,
        persona_dimensions=model_config.persona_dimensions if model_config else [],
        iter_num=info.get("iter_num"),
        best_val_loss=info.get("best_val_loss"),
        uptime=time.time() - server_start_time
    )

@app.post("/chat", response_model=EchoChatResponse)
def chat(request: EchoChatRequest):
    """Generate an Echo Self chat response with the trained model."""
    model = _require_model()
    prompt = _format_prompt(request.messages)

    try:
        start_time = time.time()
        response, tokens_generated = model.complete(
            prompt,
            max_new_tokens=request.max_tokens,
            temperature=request.temperature,
            top_k=request.top_k
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error generating response: {str(e)}")

    echo_state["chat_requests"] += 1
    echo_state["tokens_generated"] += tokens_generated
    echo_state["last_prompt"] = prompt

    return EchoChatResponse(
        text=response,
        model=os.path.basename(model.model_path),
        created_at=time.time(),
        tokens_generated=tokens_generated,
        echo_metadata={
            "echo_mode": request.echo_mode,
            "prompt_tokens": len(model.encode(prompt)),
            "generation_time": time.time() - start_time
        }
    )

@app.post("/chat/stream")
def chat_stream(request: EchoChatRequest):
    """Stream the model's tokens as they are sampled (server-sent events)."""
    model = _require_model()
    prompt = _format_prompt(request.messages)
    echo_state["stream_requests"] += 1
    echo_state["last_prompt"] = prompt

    def generate_stream():
        count = 0
        try:
            for token in model.stream_tokens(
                prompt,
                max_new_tokens=request.max_tokens,
                temperature=request.temperature,
                top_k=request.top_k
            ):
                yield f"data: {json.dumps({'text': token, 'index': count})}\n\n"
                count += 1
            echo_state["tokens_generated"] += count
            yield f"data: {json.dumps({'text': '', 'finished': True, 'tokens_generated': count})}\n\n"
        except Exception as e:
            echo_state["tokens_generated"] += count
            yield f"data: {json.dumps({'error': f'Generation failed: {e}', 'finished': True})}\n\n"

    return StreamingResponse(
        generate_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        }
    )

@app.post("/introspect")
def introspect(request: Optional[EchoIntrospectionRequest] = None):
    """Measure the model on a text (forward-pass and attention statistics) and
    optionally have the model generate an analysis of those measurements."""
    model = _require_model()
    if request is None:
        request = EchoIntrospectionRequest()

    text = request.text or echo_state["last_prompt"]
    if not text:
        raise HTTPException(
            status_code=400,
            detail="No text to introspect: pass 'text' or send a chat request first"
        )

    try:
        introspection_data = model.introspect(text)
        analysis = None
        if request.analyze:
            from netalk import EchoIntrospectionMode
            prompt = EchoIntrospectionMode().format_echo_introspection_prompt(introspection_data)
            analysis = model.generate(prompt, max_new_tokens=200, temperature=0.6)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error during introspection: {str(e)}")

    echo_state["introspection_count"] += 1
    echo_state["last_introspection"] = introspection_data

    result = {
        **introspection_data,
        "introspection_analysis": analysis,
        "introspection_count": echo_state["introspection_count"],
        "server_timestamp": time.time(),
        "request_parameters": {
            "depth": request.depth,
            "enable_recursion": request.enable_recursion,
            "persona_focus": request.persona_focus
        }
    }
    return JSONResponse(content=result)

@app.get("/echo/state")
async def get_echo_state():
    """Server run state and checkpoint metadata (all measured, nothing synthesized)."""
    model = _require_model()
    return JSONResponse(content={
        "checkpoint": {
            "path": model.model_path,
            "iter_num": model.model_info.get("iter_num"),
            "best_val_loss": model.model_info.get("best_val_loss"),
            "n_params": model.model_info.get("n_params"),
            "model_args": model.model_info.get("model_args"),
        },
        "server_echo_state": {
            k: v for k, v in echo_state.items() if k != "last_prompt"
        },
        "uptime": time.time() - server_start_time,
        "timestamp": time.time(),
    })

@app.get("/echo/attention")
def get_attention_state(text: Optional[str] = None):
    """Per-layer attention statistics of the model for ``text`` (or the last chat prompt)."""
    model = _require_model()
    text = text or echo_state["last_prompt"]
    if not text:
        raise HTTPException(
            status_code=400,
            detail="No text to analyze: pass ?text=... or send a chat request first"
        )
    try:
        return JSONResponse(content=model.attention_stats(text))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error computing attention statistics: {str(e)}")

@app.post("/echo/attention/update")
async def update_attention(request: EchoAttentionUpdate):
    """Not implemented: the model has no adjustable attention threshold."""
    raise HTTPException(status_code=501, detail=NOT_AVAILABLE_DETAIL.format(feature="adaptive attention threshold"))

@app.get("/echo/persona/{dimension}")
async def get_persona_dimension(dimension: str):
    """Not implemented: per-dimension persona state is not measured from the model."""
    raise HTTPException(status_code=501, detail=NOT_AVAILABLE_DETAIL.format(feature="persona dimension"))

@app.get("/echo/hypergraph")
async def get_hypergraph_patterns(limit: int = 50):
    """Not implemented: the model has no hypergraph store."""
    raise HTTPException(status_code=501, detail=NOT_AVAILABLE_DETAIL.format(feature="hypergraph"))

@app.post("/echo/synergy/evaluate")
async def evaluate_cognitive_synergy():
    """Not implemented: there is no measured cognitive synergy metric."""
    raise HTTPException(status_code=501, detail=NOT_AVAILABLE_DETAIL.format(feature="cognitive synergy"))

@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "timestamp": time.time(),
        "model_loaded": model_config is not None and model_config.loaded,
        "uptime": time.time() - server_start_time
    }

def load_model(model_path: str, device: str = "cpu") -> bool:
    """Load the NanEcho model. Raises on failure."""
    global model_config
    config = EchoModelConfig(model_path, device)
    config.load_model()
    model_config = config
    return True

def main():
    parser = argparse.ArgumentParser(description="NanEcho Server - Echo Self Cognitive Architecture API")
    parser.add_argument("--model_path", type=str, required=True,
                       help="Path to the NanEcho model checkpoint")
    parser.add_argument("--host", type=str, default="0.0.0.0",
                       help="Host to bind the server")
    parser.add_argument("--port", type=int, default=8081,
                       help="Port to bind the server")
    parser.add_argument("--device", type=str, default="cpu",
                       help="Device to use (cpu/cuda)")
    parser.add_argument("--echo_mode", action="store_true", default=True,
                       help="Enable Echo Self mode")
    
    args = parser.parse_args()
    
    print(f"🌟 Starting NanEcho Server - Echo Self Cognitive Architecture")
    print(f"Model: {args.model_path}")
    print(f"Server: http://{args.host}:{args.port}")
    print(f"Echo Mode: {args.echo_mode}")
    
    # Load the model
    try:
        load_model(args.model_path, args.device)
    except Exception as e:
        print(f"❌ Failed to load Echo Self model: {e}")
        sys.exit(1)
    
    print("✅ Echo Self model loaded successfully")
    print("🚀 Starting server...")
    
    # Run the server
    uvicorn.run(
        app,
        host=args.host,
        port=args.port,
        log_level="info"
    )

if __name__ == "__main__":
    main()