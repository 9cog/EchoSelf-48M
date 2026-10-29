#!/usr/bin/env python3
"""
Shared NanEcho model loader and generator.

Loads a trained nanoGPT checkpoint (``model_args`` + ``model`` state dict, as
written by nanoGPT's train.py) together with the GPT-2 tiktoken tokenizer, and
provides:

- ``stream_tokens``: real token-by-token sampling from the model
- ``generate``: full completion (optionally with a per-token callback)
- ``analyze_text``: statistics of an actual forward pass over a text
  (perplexity, next-token entropy, top next-token predictions)
- ``attention_stats``: per-layer attention statistics computed from the
  model's own query/key projections for a text

Every method raises when the model is not loaded or the checkpoint is missing;
nothing here produces placeholder output.
"""

import os
import sys
import math
import dataclasses
from contextlib import nullcontext
from typing import Any, Callable, Dict, Iterator, List, Optional, Tuple

import torch
import torch.nn.functional as F
import tiktoken

_NANECHO_DIR = os.path.dirname(os.path.abspath(__file__))
_REPO_ROOT = os.path.dirname(_NANECHO_DIR)


def _import_gpt():
    """Import nanoGPT's ``GPT``/``GPTConfig``, searching the usual checkout locations."""
    try:
        from model import GPTConfig, GPT  # type: ignore
        return GPTConfig, GPT
    except ImportError:
        pass
    candidates = [
        os.path.join(_REPO_ROOT, "nanoGPT"),
        os.path.join(os.path.dirname(_REPO_ROOT), "nanoGPT"),
        _REPO_ROOT,
    ]
    for path in candidates:
        if os.path.isfile(os.path.join(path, "model.py")) and path not in sys.path:
            sys.path.insert(0, path)
            try:
                from model import GPTConfig, GPT  # type: ignore
                return GPTConfig, GPT
            except ImportError:
                sys.path.remove(path)
    raise ImportError(
        "Could not import nanoGPT model definition (model.py). "
        f"Searched: {', '.join(candidates)}"
    )


class EchoModel:
    """A loaded NanEcho (nanoGPT) checkpoint plus tokenizer."""

    def __init__(self, model_path: str, device: str = "cpu", max_tokens: int = 2048):
        self.model_path = model_path
        self.device = device
        self.max_tokens = max_tokens
        self.model = None
        self.tokenizer = None
        self.model_info: Dict[str, Any] = {}

    # ------------------------------------------------------------------ loading
    def load_model(self) -> bool:
        """Load the checkpoint. Raises on any failure; returns True on success."""
        if not os.path.isfile(self.model_path):
            raise FileNotFoundError(f"Model checkpoint not found: {self.model_path}")

        GPTConfig, GPT = _import_gpt()
        checkpoint = torch.load(self.model_path, map_location=self.device, weights_only=False)
        if "model_args" not in checkpoint or "model" not in checkpoint:
            raise RuntimeError(
                f"{self.model_path} is not a nanoGPT checkpoint (missing 'model_args' or 'model')"
            )
        state_dict = checkpoint["model"]
        if not state_dict:
            raise RuntimeError(f"{self.model_path} contains an empty model state dict")

        model_args = dict(checkpoint["model_args"])
        known_fields = {f.name for f in dataclasses.fields(GPTConfig)}
        gptconf = GPTConfig(**{k: v for k, v in model_args.items() if k in known_fields})
        model = GPT(gptconf)

        unwanted_prefix = "_orig_mod."
        for k in list(state_dict.keys()):
            if k.startswith(unwanted_prefix):
                state_dict[k[len(unwanted_prefix):]] = state_dict.pop(k)
        model.load_state_dict(state_dict)
        model.eval()
        model.to(self.device)

        self.model = model
        self.tokenizer = tiktoken.get_encoding("gpt2")
        self.model_info = {
            "model_args": model_args,
            "config": checkpoint.get("config", {}),
            "iter_num": checkpoint.get("iter_num"),
            "best_val_loss": _to_float(checkpoint.get("best_val_loss")),
            "checkpoint_path": self.model_path,
            "n_params": sum(p.numel() for p in model.parameters()),
        }
        return True

    @property
    def loaded(self) -> bool:
        return self.model is not None and self.tokenizer is not None

    def _require_loaded(self):
        if not self.loaded:
            raise RuntimeError("Model not loaded. Call load_model() first.")

    def _ctx(self):
        if "cuda" in str(self.device):
            return torch.amp.autocast(device_type="cuda")
        return nullcontext()

    # --------------------------------------------------------------- tokenizing
    def encode(self, text: str) -> List[int]:
        self._require_loaded()
        return self.tokenizer.encode(text, allowed_special={"<|endoftext|>"})

    def decode(self, ids: List[int]) -> str:
        self._require_loaded()
        return self.tokenizer.decode(ids)

    def _prompt_tensor(self, prompt: str, max_new_tokens: int) -> torch.Tensor:
        ids = self.encode(prompt)
        limit = max(1, self.max_tokens - max_new_tokens)
        if len(ids) > limit:
            ids = ids[-limit:]
        if not ids:
            ids = [self.tokenizer.eot_token]
        return torch.tensor(ids, dtype=torch.long, device=self.device)[None, ...]

    # --------------------------------------------------------------- generation
    def stream_tokens(self, prompt: str, max_new_tokens: int = 500,
                      temperature: float = 0.7, top_k: int = 200) -> Iterator[str]:
        """Sample from the model one token at a time, yielding each decoded token."""
        self._require_loaded()
        x = self._prompt_tensor(prompt, max_new_tokens)
        block_size = self.model.config.block_size
        n_vocab = self.tokenizer.n_vocab
        eot = self.tokenizer.eot_token
        with torch.no_grad(), self._ctx():
            for _ in range(max_new_tokens):
                idx_cond = x if x.size(1) <= block_size else x[:, -block_size:]
                logits, _ = self.model(idx_cond)
                logits = logits[:, -1, :].float().clone()
                # padded vocabulary entries have no tokenizer mapping
                if logits.size(-1) > n_vocab:
                    logits[:, n_vocab:] = float("-inf")
                if temperature and temperature > 0:
                    logits = logits / temperature
                    if top_k and top_k > 0:
                        v, _ = torch.topk(logits, min(top_k, logits.size(-1)))
                        logits[logits < v[:, [-1]]] = float("-inf")
                    probs = F.softmax(logits, dim=-1)
                    next_token = torch.multinomial(probs, num_samples=1)
                else:
                    next_token = torch.argmax(logits, dim=-1, keepdim=True)
                token_id = int(next_token[0].item())
                if token_id == eot:
                    break
                x = torch.cat((x, next_token), dim=1)
                yield self.tokenizer.decode([token_id])

    def complete(self, prompt: str, max_new_tokens: int = 500, temperature: float = 0.7,
                 top_k: int = 200, callback: Optional[Callable[[str], bool]] = None) -> Tuple[str, int]:
        """Generate a completion. Returns (text, number_of_generated_tokens).

        If ``callback`` is given it receives every token as it is sampled; returning
        False stops generation early.
        """
        pieces: List[str] = []
        for token in self.stream_tokens(prompt, max_new_tokens, temperature, top_k):
            pieces.append(token)
            if callback is not None and callback(token) is False:
                break
        return "".join(pieces), len(pieces)

    def generate(self, prompt: str, max_new_tokens: int = 500, temperature: float = 0.7,
                 top_k: int = 200, callback: Optional[Callable[[str], bool]] = None) -> str:
        return self.complete(prompt, max_new_tokens, temperature, top_k, callback)[0]

    # ------------------------------------------------------------ introspection
    def _context_ids(self, text: str) -> List[int]:
        ids = self.encode(text)
        block_size = self.model.config.block_size
        return ids[-block_size:]

    def analyze_text(self, text: str, top_n: int = 5) -> Dict[str, Any]:
        """Statistics from an actual forward pass of the model over ``text``."""
        self._require_loaded()
        ids = self._context_ids(text)
        if not ids:
            raise ValueError("Cannot analyze empty text")
        n_vocab = self.tokenizer.n_vocab
        result: Dict[str, Any] = {"token_count": len(ids)}
        with torch.no_grad(), self._ctx():
            if len(ids) >= 2:
                inp = torch.tensor(ids[:-1], dtype=torch.long, device=self.device)[None, ...]
                tgt = torch.tensor(ids[1:], dtype=torch.long, device=self.device)[None, ...]
                logits, loss = self.model(inp, tgt)
                logits = logits.float()[0, :, :n_vocab]
                probs = F.softmax(logits, dim=-1)
                entropy = -(probs * torch.log(probs.clamp_min(1e-12))).sum(-1)
                loss_val = float(loss.item())
                result["mean_token_loss"] = loss_val
                result["perplexity"] = math.exp(min(loss_val, 50.0))
                result["mean_next_token_entropy"] = float(entropy.mean().item())
                result["max_next_token_entropy"] = float(entropy.max().item())
            full = torch.tensor(ids, dtype=torch.long, device=self.device)[None, ...]
            last_logits, _ = self.model(full)
            last_probs = F.softmax(last_logits.float()[0, -1, :n_vocab], dim=-1)
            top = torch.topk(last_probs, min(top_n, last_probs.size(-1)))
            result["top_next_tokens"] = [
                {"token": self.tokenizer.decode([int(i)]), "probability": float(p)}
                for p, i in zip(top.values.tolist(), top.indices.tolist())
            ]
        return result

    def attention_stats(self, text: str, top_n: int = 5) -> Dict[str, Any]:
        """Per-layer attention statistics for ``text``, computed from the model's own
        query/key projections (the same weights used in the forward pass)."""
        self._require_loaded()
        ids = self._context_ids(text)
        if not ids:
            raise ValueError("Cannot analyze empty text")
        captured: List[torch.Tensor] = []
        hooks = [
            block.attn.register_forward_pre_hook(lambda _m, inputs: captured.append(inputs[0].detach()))
            for block in self.model.transformer.h
        ]
        try:
            with torch.no_grad(), self._ctx():
                x = torch.tensor(ids, dtype=torch.long, device=self.device)[None, ...]
                self.model(x)
                layers = []
                for layer_idx, (block, h) in enumerate(zip(self.model.transformer.h, captured)):
                    attn = block.attn
                    B, T, C = h.size()
                    q, k, _ = attn.c_attn(h).float().split(attn.n_embd, dim=2)
                    hs = C // attn.n_head
                    q = q.view(B, T, attn.n_head, hs).transpose(1, 2)
                    k = k.view(B, T, attn.n_head, hs).transpose(1, 2)
                    att = (q @ k.transpose(-2, -1)) * (1.0 / math.sqrt(hs))
                    mask = torch.tril(torch.ones(T, T, device=att.device, dtype=torch.bool))
                    att = att.masked_fill(~mask, float("-inf"))
                    att = F.softmax(att, dim=-1)  # (B, nh, T, T)
                    ent = -(att * torch.log(att.clamp_min(1e-12))).sum(-1)  # (B, nh, T)
                    last = att[0, :, -1, :].mean(0)  # attention of last position, head-averaged
                    top = torch.topk(last, min(top_n, T))
                    layers.append({
                        "layer": layer_idx,
                        "mean_attention_entropy": float(ent.mean().item()),
                        "per_head_mean_entropy": [float(v) for v in ent[0].mean(-1).tolist()],
                        "last_position_top_attended": [
                            {"position": int(i), "token": self.tokenizer.decode([ids[int(i)]]),
                             "weight": float(w)}
                            for w, i in zip(top.values.tolist(), top.indices.tolist())
                        ],
                    })
        finally:
            for hook in hooks:
                hook.remove()
        return {"token_count": len(ids), "n_layer": len(layers), "layers": layers}


def _to_float(value: Any) -> Optional[float]:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None
