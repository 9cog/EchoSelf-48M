"""
Echo Self Client

Client for interacting with Echo Self cognitive architecture and introspection capabilities.
Extends the basic AtomSpace client with Echo Self specific functionality.
"""

import requests
from typing import Dict, List, Any, Optional
from .atomspace_client import AtomSpaceClient


class EchoSelfClientError(RuntimeError):
    """Raised when the Echo Self server cannot provide the requested data."""


class EchoSelfClient(AtomSpaceClient):
    """
    Client for the Echo Self server (neserver.py).

    Every method returns the server's real response or raises
    ``EchoSelfClientError``; no data is synthesized on failure.
    """
    
    def __init__(self, base_url: str = "http://localhost:8081", timeout: int = 30):
        super().__init__(base_url, timeout=timeout)
        self.base_url = self.endpoint
        self.echo_depth = 3
        self.persona_dimensions = [
            'cognitive', 'introspective', 'adaptive', 'recursive',
            'synergistic', 'holographic', 'neural_symbolic', 'dynamic'
        ]
    
    def get_echo_state(self) -> Dict[str, Any]:
        """Get the current Echo Self cognitive state."""
        try:
            response = self.session.get(
                f"{self.base_url}/echo/state",
                headers=self.headers,
                timeout=self.timeout
            )
            response.raise_for_status()
            return response.json()
        except requests.exceptions.RequestException as e:
            raise EchoSelfClientError(f"Error getting Echo Self state: {e}") from e
    
    def trigger_introspection(self, depth: int = 3) -> Dict[str, Any]:
        """Trigger Echo Self introspection at specified depth."""
        try:
            payload = {"depth": depth, "enable_recursion": True}
            response = self.session.post(
                f"{self.base_url}/introspect",
                json=payload,
                headers=self.headers,
                timeout=self.timeout
            )
            response.raise_for_status()
            return response.json()
        except requests.exceptions.RequestException as e:
            raise EchoSelfClientError(f"Error triggering introspection: {e}") from e
    
    def get_adaptive_attention_state(self) -> Dict[str, Any]:
        """Get the current adaptive attention allocation state."""
        try:
            response = self.session.get(
                f"{self.base_url}/echo/attention",
                headers=self.headers,
                timeout=self.timeout
            )
            response.raise_for_status()
            return response.json()
        except requests.exceptions.RequestException as e:
            raise EchoSelfClientError(f"Error getting attention state: {e}") from e
    
    def update_cognitive_load(self, load: float, activity: float) -> Dict[str, Any]:
        """Update cognitive load and recent activity for attention calculation."""
        try:
            payload = {
                "cognitive_load": load,
                "recent_activity": activity,
                "recalculate_threshold": True
            }
            response = self.session.post(
                f"{self.base_url}/echo/attention/update",
                json=payload,
                headers=self.headers,
                timeout=self.timeout
            )
            response.raise_for_status()
            return response.json()
        except requests.exceptions.RequestException as e:
            raise EchoSelfClientError(f"Error updating cognitive load: {e}") from e
    
    def get_persona_dimension_state(self, dimension: str) -> Dict[str, Any]:
        """Get the state of a specific persona dimension."""
        if dimension not in self.persona_dimensions:
            raise ValueError(f"Unknown persona dimension: {dimension}")
        
        try:
            response = self.session.get(
                f"{self.base_url}/echo/persona/{dimension}",
                headers=self.headers,
                timeout=self.timeout
            )
            response.raise_for_status()
            return response.json()
        except requests.exceptions.RequestException as e:
            raise EchoSelfClientError(f"Error getting persona dimension {dimension}: {e}") from e
    
    def get_hypergraph_patterns(self, limit: int = 50) -> Dict[str, Any]:
        """Get current hypergraph pattern encoding state."""
        try:
            params = {"limit": limit, "include_semantic_links": True}
            response = self.session.get(
                f"{self.base_url}/echo/hypergraph",
                params=params,
                headers=self.headers,
                timeout=self.timeout
            )
            response.raise_for_status()
            return response.json()
        except requests.exceptions.RequestException as e:
            raise EchoSelfClientError(f"Error getting hypergraph patterns: {e}") from e
    
    def evaluate_cognitive_synergy(self) -> Dict[str, Any]:
        """Evaluate the current level of cognitive synergy."""
        try:
            response = self.session.post(
                f"{self.base_url}/echo/synergy/evaluate",
                headers=self.headers,
                timeout=self.timeout
            )
            response.raise_for_status()
            return response.json()
        except requests.exceptions.RequestException as e:
            raise EchoSelfClientError(f"Error evaluating cognitive synergy: {e}") from e
