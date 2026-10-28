#!/usr/bin/env python3
"""
NETalk - NanEcho Talk Interface

Command-line interface for interacting with the NanEcho model that represents
Echo Self cognitive architecture and persona dimensions.

Extended from nctalk.py with Echo Self specific capabilities.
"""

import os
import sys
import argparse
import json
import time
from typing import List, Dict, Any, Optional, Callable

# Try to import the dependencies
try:
    import torch
    from rich.console import Console
    from rich.panel import Panel
    from rich.text import Text
    from rich.prompt import Prompt
    from rich.table import Table
except ImportError as e:
    print(f"Missing required dependency: {e}")
    print("Please install: pip install torch tiktoken rich")
    sys.exit(1)

# Make sibling modules importable regardless of the working directory
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from echo_model import EchoModel

console = Console()

PERSONA_DIMENSIONS = [
    'cognitive', 'introspective', 'adaptive', 'recursive',
    'synergistic', 'holographic', 'neural_symbolic', 'dynamic'
]


class EchoModelConfig(EchoModel):
    """NanEcho model wrapper used by the Echo Self CLI, server and evaluators.

    Loads the real trained nanoGPT checkpoint (see ``echo_model.EchoModel``) and
    generates every response with it. ``load_model`` raises if the checkpoint is
    missing or invalid.
    """

    def __init__(self, model_path: str, device: str = "cpu", max_tokens: int = 2048,
                 system_prompt: Optional[str] = None):
        super().__init__(model_path, device, max_tokens)
        # Persona dimensions are a description used as model input/config, not measurements.
        self.persona_dimensions = list(PERSONA_DIMENSIONS)
        self.echo_depth = 3
        self.system_prompt = system_prompt
        self.no_system_prompt = False
        self.deep_tree_echo_mode = False

    def load_model(self) -> bool:
        """Load the NanEcho checkpoint. Raises on failure."""
        super().load_model()
        echo_depth = self.model_info["model_args"].get('echo_depth')
        if echo_depth is not None:
            self.echo_depth = int(echo_depth)
        return True

    def _apply_system_prompt(self, prompt: str) -> str:
        """Prepend the optional system prompt unless running without one."""
        if self.no_system_prompt:
            # Relentless persona test: the raw prompt goes to the model unchanged
            return prompt
        if self.system_prompt:
            return f"{self.system_prompt}\n\n{prompt}"
        return prompt

    def stream_tokens(self, prompt: str, max_new_tokens: int = 500,
                      temperature: float = 0.7, top_k: int = 200):
        return super().stream_tokens(self._apply_system_prompt(prompt),
                                     max_new_tokens, temperature, top_k)

    def generate(self, prompt: str, max_new_tokens: int = 500, temperature: float = 0.7,
                 top_k: int = 200, stream: bool = False,
                 callback: Optional[Callable[[str], bool]] = None) -> str:
        """Generate an Echo Self response with the trained model.

        When ``callback`` is given, each real model token is passed to it as it is
        sampled (``stream`` is accepted for backwards compatibility).
        """
        return self.complete(prompt, max_new_tokens, temperature, top_k, callback)[0]

    def introspect(self, text: str) -> Dict[str, Any]:
        """Introspection data measured from the model itself for ``text``:
        checkpoint metadata plus statistics of the actual forward pass."""
        return {
            "checkpoint": {
                "path": self.model_path,
                "iter_num": self.model_info.get("iter_num"),
                "best_val_loss": self.model_info.get("best_val_loss"),
                "n_params": self.model_info.get("n_params"),
                "model_args": self.model_info.get("model_args"),
            },
            "forward_pass": self.analyze_text(text),
            "attention": self.attention_stats(text),
            "timestamp": time.time(),
        }

class EchoConversationHistory:
    """Enhanced conversation history for Echo Self interactions."""
    
    def __init__(self, max_history: int = 20):
        self.messages: List[Dict[str, str]] = []
        self.max_history = max_history
        self.echo_context = {
            "interaction_count": 0,
            "persona_patterns": set(),
            "attention_adjustments": [],
            "recursive_depth_used": []
        }
    
    def add_message(self, role: str, content: str):
        """Add message with Echo Self context tracking."""
        self.messages.append({
            "role": role,
            "content": content,
            "timestamp": time.time()
        })
        
        # Track Echo Self patterns
        if role == "assistant":
            self._analyze_echo_patterns(content)
        
        # Maintain history limit
        if len(self.messages) > self.max_history:
            self.messages = self.messages[-self.max_history:]
        
        self.echo_context["interaction_count"] += 1
    
    def _analyze_echo_patterns(self, content: str):
        """Analyze content for Echo Self patterns."""
        echo_patterns = [
            "adaptive attention", "hypergraph", "recursive", "introspection",
            "persona dimension", "cognitive synergy", "neural-symbolic"
        ]
        
        for pattern in echo_patterns:
            if pattern.lower() in content.lower():
                self.echo_context["persona_patterns"].add(pattern)
    
    def get_messages(self) -> List[Dict[str, str]]:
        return self.messages
    
    def clear(self):
        self.messages = []
        self.echo_context = {
            "interaction_count": 0,
            "persona_patterns": set(),
            "attention_adjustments": [],
            "recursive_depth_used": []
        }
    
    def format_for_prompt(self) -> str:
        """Format conversation history for Echo Self prompt."""
        if not self.messages:
            return "Echo: "
        
        formatted = []
        for msg in self.messages[-10:]:  # Last 10 messages for context
            role = "User" if msg["role"] == "user" else "Echo"
            formatted.append(f"{role}: {msg['content']}")
        
        formatted.append("Echo: ")
        return "\n".join(formatted)
    
    def get_echo_context_summary(self) -> str:
        """Get summary of Echo Self interaction context."""
        patterns = ", ".join(sorted(self.echo_context["persona_patterns"]))
        return f"""Echo Context: {self.echo_context['interaction_count']} interactions, 
Patterns discussed: {patterns or 'none'}"""

class EchoIntrospectionMode:
    """Introspection built on measurements of the loaded model."""

    def __init__(self):
        self.introspection_history = []

    def format_echo_introspection_prompt(self, introspection_data: Dict[str, Any]) -> str:
        """Format measured introspection data as a prompt for the model to analyze."""
        ckpt = introspection_data.get("checkpoint", {})
        fwd = introspection_data.get("forward_pass", {})
        attn = introspection_data.get("attention", {})
        prompt_parts = [
            "Echo Self Introspective Analysis:",
            "",
            "=== Model State (measured) ===",
            f"Training iteration: {ckpt.get('iter_num')}",
            f"Best validation loss: {ckpt.get('best_val_loss')}",
            f"Context tokens analyzed: {fwd.get('token_count')}",
            f"Perplexity on context: {fwd.get('perplexity')}",
            f"Mean next-token entropy: {fwd.get('mean_next_token_entropy')}",
            "",
            "=== Attention (measured) ===",
        ]
        for layer in attn.get("layers", []):
            prompt_parts.append(
                f"Layer {layer['layer']}: mean attention entropy {layer['mean_attention_entropy']:.3f}"
            )
        prompt_parts.extend([
            "",
            "=== Raw Introspection Data ===",
            "```json",
            json.dumps({"checkpoint": ckpt, "forward_pass": fwd}, indent=2, default=str),
            "```",
            "",
            "Echo (Introspective Analysis): "
        ])
        return "\n".join(prompt_parts)

    def perform_introspection(self, model_config: EchoModelConfig, text: str,
                              depth: int = 3) -> Dict[str, Any]:
        """Measure the model on ``text`` and have the model analyze the measurements."""
        console.print(f"[yellow]🔍 Performing Echo Self introspection at depth {depth}...[/yellow]")

        introspection_data = model_config.introspect(text)
        prompt = self.format_echo_introspection_prompt(introspection_data)
        analysis = model_config.generate(prompt, max_new_tokens=300, temperature=0.6)

        result = {
            "introspection_data": introspection_data,
            "analysis": analysis,
            "depth": depth,
            "timestamp": time.time()
        }
        self.introspection_history.append(result)
        return result

def create_echo_interface():
    """Create the main Echo Self interface."""
    console.print(Panel.fit(
        "[bold cyan]NETalk - NanEcho Talk Interface[/bold cyan]\n"
        "[blue]Echo Self Cognitive Architecture Interaction System[/blue]",
        title="🌟 Echo Self",
        border_style="cyan"
    ))

def main():
    parser = argparse.ArgumentParser(description="NETalk - NanEcho Talk Interface")
    parser.add_argument("--model_path", type=str, required=True,
                       help="Path to the NanEcho model checkpoint")
    parser.add_argument("--device", type=str, default="cpu",
                       help="Device to use (cpu/cuda)")
    parser.add_argument("--max_tokens", type=int, default=2048,
                       help="Maximum tokens for generation")
    parser.add_argument("--temperature", type=float, default=0.7,
                       help="Sampling temperature")
    parser.add_argument("--top_k", type=int, default=200,
                       help="Top-k sampling parameter")
    parser.add_argument("--echo_depth", type=int, default=3,
                       help="Echo Self recursive reasoning depth")
    parser.add_argument("--system_prompt", type=str, default=None,
                       help="Optional system prompt prepended to every model prompt")
    
    args = parser.parse_args()
    
    create_echo_interface()
    
    # Initialize Echo Self model
    console.print("[yellow]Loading Echo Self model...[/yellow]")
    model_config = EchoModelConfig(args.model_path, args.device, args.max_tokens,
                                   system_prompt=args.system_prompt)
    
    try:
        model_config.load_model()
    except Exception as e:
        console.print(f"[red]Failed to load model: {e}[/red]")
        sys.exit(1)
    console.print(f"[green]✓ Loaded NanEcho model from {args.model_path}[/green]")
    console.print(f"[blue]Iteration: {model_config.model_info.get('iter_num')}, "
                  f"best val loss: {model_config.model_info.get('best_val_loss')}[/blue]")
    
    # Initialize conversation components
    history = EchoConversationHistory()
    introspection_mode = EchoIntrospectionMode()
    
    console.print("[green]✓ Echo Self interface ready![/green]")
    console.print("[dim]Type 'help' for commands, 'quit' to exit, '/introspect' for introspection mode[/dim]")
    
    try:
        while True:
            # Get user input
            user_input = Prompt.ask("[bold blue]You[/bold blue]")
            
            if user_input.lower() in ['quit', 'exit', 'q']:
                break
            elif user_input.lower() == 'help':
                show_help()
                continue
            elif user_input.lower() == '/clear':
                history.clear()
                console.print("[yellow]Conversation history cleared.[/yellow]")
                continue
            elif user_input.lower() == '/history':
                show_history(history)
                continue
            elif user_input.lower().startswith('/introspect'):
                # Introspection mode
                depth = 3
                if len(user_input.split()) > 1:
                    try:
                        depth = int(user_input.split()[1])
                    except ValueError:
                        pass
                
                if not history.get_messages():
                    console.print("[yellow]Nothing to introspect yet: start a conversation first.[/yellow]")
                    continue
                try:
                    result = introspection_mode.perform_introspection(
                        model_config, history.format_for_prompt(), depth)
                except Exception as e:
                    console.print(f"[red][system] Introspection failed: {e}[/red]")
                    continue
                
                console.print(Panel(
                    Text(result["analysis"]),
                    title=f"🔍 Echo Self Introspection (Depth {depth})",
                    border_style="yellow"
                ))
                continue
            elif user_input.lower() == '/context':
                console.print(history.get_echo_context_summary())
                continue
            
            # Add user message to history
            history.add_message("user", user_input)
            
            # Format prompt with conversation history
            prompt = history.format_for_prompt()
            
            # Generate response with streaming
            console.print("[bold green]Echo:[/bold green] ", end="")
            
            response_text = ""
            def stream_callback(token):
                nonlocal response_text
                console.print(token, end="", markup=False, highlight=False)
                response_text += token
                return True
            
            try:
                full_response = model_config.generate(
                    prompt,
                    max_new_tokens=300,
                    temperature=args.temperature,
                    top_k=args.top_k,
                    callback=stream_callback
                )
            except Exception as e:
                console.print()
                console.print(f"[red][system] Generation failed: {e}[/red]")
                history.messages.pop()  # drop the unanswered user turn
                continue
            
            console.print()  # New line after streaming
            
            # Add response to history
            history.add_message("assistant", full_response)
            
    except KeyboardInterrupt:
        console.print("\n[yellow]Goodbye![/yellow]")
    except Exception as e:
        console.print(f"\n[red]Error: {e}[/red]")

def show_help():
    """Show help information."""
    help_table = Table(title="Echo Self Commands")
    help_table.add_column("Command", style="cyan")
    help_table.add_column("Description", style="white")
    
    help_table.add_row("/introspect [depth]", "Perform Echo Self introspection")
    help_table.add_row("/clear", "Clear conversation history")
    help_table.add_row("/history", "Show conversation history")
    help_table.add_row("/context", "Show Echo Self interaction context")
    help_table.add_row("help", "Show this help")
    help_table.add_row("quit", "Exit the interface")
    
    console.print(help_table)

def show_history(history: EchoConversationHistory):
    """Show conversation history."""
    messages = history.get_messages()
    if not messages:
        console.print("[yellow]No conversation history.[/yellow]")
        return
    
    for i, msg in enumerate(messages[-10:]):  # Show last 10 messages
        role = "[bold blue]You[/bold blue]" if msg["role"] == "user" else "[bold green]Echo[/bold green]"
        console.print(f"{role}: {msg['content']}")

if __name__ == "__main__":
    main()