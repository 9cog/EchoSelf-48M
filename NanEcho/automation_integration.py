#!/usr/bin/env python3
"""
NanEcho Automation Integration
Connects evaluation results to continuous training improvement.

This script implements the next steps of NANECHO training automation by:
1. Analyzing evaluation results
2. Determining training quality and next steps
3. Generating feedback for continuous improvement
4. Triggering next training cycles when needed
"""

import os
import sys
import json
import argparse
import time
from datetime import datetime, timedelta
from typing import Dict, Any, List, Optional
from pathlib import Path

# Add NanEcho to path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

# Import the real evaluation implementations. Anything that fails to import is
# recorded in IMPORT_ERRORS; the corresponding evaluation is then reported as
# not run - no stand-in classes or synthetic scores are used.
TORCH_AVAILABLE = False
ECHO_FIDELITY_AVAILABLE = False
AUTOMATED_LOOP_AVAILABLE = False
NANOCOG_EVALUATOR_AVAILABLE = False
ECHO_MODEL_AVAILABLE = False
IMPORT_ERRORS: Dict[str, str] = {}

try:
    import torch
    TORCH_AVAILABLE = True
except ImportError as e:
    IMPORT_ERRORS["torch"] = str(e)
    print(f"⚠️ PyTorch not available - model evaluation cannot run: {e}")

# echo_fidelity and netalk require torch at import time
if TORCH_AVAILABLE:
    try:
        from evaluation.echo_fidelity import EchoFidelityEvaluator, EchoFidelityMetrics
        ECHO_FIDELITY_AVAILABLE = True
    except ImportError as e:
        IMPORT_ERRORS["echo_fidelity"] = str(e)
        print(f"⚠️ Echo fidelity evaluation not available: {e}")

    try:
        from netalk import EchoModelConfig
        ECHO_MODEL_AVAILABLE = True
    except ImportError as e:
        IMPORT_ERRORS["netalk"] = str(e)
        print(f"⚠️ Echo model config not available: {e}")

try:
    from evaluation.automated_loop import AutomatedEvaluationLoop
    AUTOMATED_LOOP_AVAILABLE = True
except ImportError as e:
    IMPORT_ERRORS["automated_loop"] = str(e)
    print(f"⚠️ Automated evaluation loop not available: {e}")

try:
    from evaluation.metrics import NanoCogEvaluator
    NANOCOG_EVALUATOR_AVAILABLE = True
except ImportError as e:
    IMPORT_ERRORS["metrics"] = str(e)
    print(f"⚠️ NanoCog evaluator not available: {e}")

# Report statuses that mark a report as not containing real model evaluation
NON_EVALUATED_REPORT_STATUSES = {
    "not_evaluated", "test_mode", "fallback_synthetic_data", "fallback_evaluation"
}


class EvaluationNotRun(RuntimeError):
    """Raised when the model could not actually be evaluated."""


class NanEchoAutomationIntegrator:
    """
    Integrates NanEcho evaluation results with automated training workflows.
    
    Implements the continuous improvement loop for NANECHO training automation.
    """
    
    #: Default path used to persist improvement history across process restarts.
    DEFAULT_HISTORY_FILE = ".training-progress/improvement_history.json"

    def __init__(self, config_path: Optional[str] = None,
                 history_file: Optional[str] = None):
        """Initialize the automation integrator.
        
        Args:
            config_path:  Optional path to a JSON configuration file.
            history_file: Optional path where improvement history is persisted.
                          Defaults to ``DEFAULT_HISTORY_FILE``.
        """
        self.config = self._load_config(config_path)
        self.results_cache: Dict[str, Any] = {}
        self.history_file = history_file or self.DEFAULT_HISTORY_FILE
        self.improvement_history: List[Dict[str, Any]] = self._load_improvement_history()

    # ─── Persistent history helpers ─────────────────────────────────────────────

    def _load_improvement_history(self) -> List[Dict[str, Any]]:
        """Load improvement history from disk, returning an empty list on failure."""
        try:
            if os.path.exists(self.history_file):
                with open(self.history_file, 'r') as f:
                    data = json.load(f)
                if isinstance(data, list):
                    print(f"📂 Loaded {len(data)} historical cycle(s) from {self.history_file}")
                    return data
                else:
                    print(f"⚠️ Improvement history file has unexpected type "
                          f"({type(data).__name__}); ignoring and starting fresh.")
        except Exception as e:
            print(f"⚠️ Could not load improvement history: {e}")
        return []

    def _save_improvement_history(self) -> None:
        """Persist improvement history to disk so it survives process restarts."""
        try:
            os.makedirs(os.path.dirname(self.history_file) or ".", exist_ok=True)
            with open(self.history_file, 'w') as f:
                json.dump(self.improvement_history, f, indent=2)
        except Exception as e:
            print(f"⚠️ Could not save improvement history: {e}")

    def get_cycle_improvement_summary(self) -> Dict[str, Any]:
        """Return a summary of cross-cycle improvement trends.
        
        Compares the most-recent third of recorded cycles against the earliest
        third so that a meaningful trend can be reported even when the number
        of cycles is small.

        Returns:
            A dictionary containing:
            - ``total_cycles``     – number of recorded evaluation cycles.
            - ``trend``            – "improving" | "stable" | "declining".
            - ``delta``            – change in overall fidelity (recent vs baseline).
            - ``baseline_fidelity`` – average fidelity of the earliest cycle group.
            - ``recent_fidelity``  – average fidelity of the most-recent cycle group.
            - ``best_fidelity``    – highest fidelity ever recorded.
            - ``worst_fidelity``   – lowest fidelity ever recorded.
        """
        if not self.improvement_history:
            return {
                "total_cycles": 0,
                "trend": "no_data",
                "delta": 0.0,
                "baseline_fidelity": 0.0,
                "recent_fidelity": 0.0,
                "best_fidelity": 0.0,
                "worst_fidelity": 0.0,
            }

        fidelity_values = [
            entry.get("fidelity_metrics", {}).get("overall_fidelity", 0.0)
            for entry in self.improvement_history
        ]

        # Divide the history into thirds so that the comparison is robust even with
        # a small number of cycles: "baseline" = earliest third, "recent" = latest
        # third.  max(1, ...) prevents a zero-division when fewer than 3 cycles exist.
        third = max(1, len(fidelity_values) // 3)
        baseline_avg = sum(fidelity_values[:third]) / third
        recent_avg = sum(fidelity_values[-third:]) / third
        delta = recent_avg - baseline_avg

        improvement_threshold = self.config["training_triggers"]["performance_improvement_threshold"]
        decline_threshold = -self.config["quality_gates"]["max_performance_decline"]

        if delta > improvement_threshold:
            trend = "improving"
        elif delta < decline_threshold:
            trend = "declining"
        else:
            trend = "stable"

        return {
            "total_cycles": len(self.improvement_history),
            "trend": trend,
            "delta": round(delta, 4),
            "baseline_fidelity": round(baseline_avg, 4),
            "recent_fidelity": round(recent_avg, 4),
            "best_fidelity": round(max(fidelity_values), 4),
            "worst_fidelity": round(min(fidelity_values), 4),
        }
        
    def _load_config(self, config_path: Optional[str]) -> Dict[str, Any]:
        """Load automation integration configuration."""
        default_config = {
            "quality_gates": {
                "min_fidelity_production": 0.85,
                "min_fidelity_development": 0.70,
                "min_identity_recognition": 0.80,
                "min_persona_consistency": 0.75,
                "max_performance_decline": 0.10
            },
            "training_triggers": {
                "auto_retrain_on_failure": True,
                "relentless_training_interval_hours": 4,
                "max_consecutive_failures": 3,
                "performance_improvement_threshold": 0.05
            },
            "feedback_integration": {
                "enable_hyperparameter_adjustment": True,
                "enable_dataset_enhancement": True,
                "enable_curriculum_adaptation": True,
                "max_training_iterations_increase": 2.0
            },
            "deployment": {
                "enable_automated_deployment": False,  # Safety first
                "require_manual_approval": True,
                "staging_environment_tests": True
            }
        }
        
        if config_path and os.path.exists(config_path):
            with open(config_path, 'r') as f:
                user_config = json.load(f)
                self._deep_update(default_config, user_config)
        
        return default_config
    
    def _run_real_evaluation(self, model_path: str, training_mode: str) -> Dict[str, Any]:
        """
        Run real Echo Self fidelity evaluation using the actual model.
        
        Args:
            model_path: Path to the trained model
            training_mode: Current training mode
            
        Returns:
            Evaluation data dictionary measured from the model's generations
        
        Raises:
            EvaluationNotRun: If the dependencies are missing, the model cannot be
                loaded, or the evaluation fails.
        """
        if not (TORCH_AVAILABLE and ECHO_FIDELITY_AVAILABLE and ECHO_MODEL_AVAILABLE):
            raise EvaluationNotRun(f"Evaluation dependencies unavailable: {IMPORT_ERRORS}")
        
        try:
            device = "cuda" if torch.cuda.is_available() else "cpu"
            model_config = EchoModelConfig(model_path, device)
            model_config.load_model()
        except Exception as e:
            raise EvaluationNotRun(f"Failed to load model from {model_path}: {e}") from e
        
        try:
            evaluator = EchoFidelityEvaluator(model_config)
            metrics = evaluator.run_full_evaluation()
            
            report_path = f"echo_fidelity_report_{int(time.time())}.json"
            evaluator.generate_report(metrics, report_path)
        except Exception as e:
            raise EvaluationNotRun(f"Evaluation of {model_path} failed: {e}") from e
        
        evaluation_data = {
            'fidelity_metrics': {
                'identity_recognition': metrics.identity_recognition,
                'persona_consistency': metrics.persona_consistency,
                'adaptive_attention_understanding': metrics.adaptive_attention_understanding,
                'recursive_reasoning_capability': metrics.recursive_reasoning_capability,
                'hypergraph_comprehension': metrics.hypergraph_comprehension,
                'cognitive_synergy_demonstration': metrics.cognitive_synergy_demonstration,
                'overall_fidelity': metrics.overall_fidelity
            },
            'evaluation_timestamp': time.time(),
            'status': 'evaluated',
            'training_mode': training_mode,
            'model_path': model_path,
            'report_path': report_path
        }
        
        print(f"✅ Evaluation completed - Overall fidelity: {metrics.overall_fidelity:.3f}")
        return evaluation_data
    
    def _deep_update(self, base_dict: Dict, update_dict: Dict):
        """Recursively update nested dictionaries."""
        for key, value in update_dict.items():
            if isinstance(value, dict) and key in base_dict and isinstance(base_dict[key], dict):
                self._deep_update(base_dict[key], value)
            else:
                base_dict[key] = value
    
    def analyze_training_results(self, 
                               model_path: str,
                               evaluation_report_path: str,
                               training_mode: str = "standard") -> Dict[str, Any]:
        """
        Analyze training results and generate comprehensive feedback.
        
        Args:
            model_path: Path to trained model
            evaluation_report_path: Path to evaluation report
            training_mode: Training mode (standard, relentless, ci)
            
        Returns:
            Analysis results with recommendations
        """
        print("🔍 Analyzing training results...")
        
        # Load or generate evaluation report
        evaluation_data = {}
        if os.path.exists(evaluation_report_path):
            with open(evaluation_report_path, 'r') as f:
                evaluation_data = json.load(f)
            status = evaluation_data.get('status')
            if status in NON_EVALUATED_REPORT_STATUSES or evaluation_data.get('fallback_report'):
                raise EvaluationNotRun(
                    f"Evaluation report {evaluation_report_path} does not contain a real "
                    f"model evaluation (status: {status})"
                )
        else:
            # Run real evaluation if report not found
            print(f"⚠️ Evaluation report not found: {evaluation_report_path}")
            print("Running real Echo Self fidelity evaluation...")
            evaluation_data = self._run_real_evaluation(model_path, training_mode)
        
        # Extract key metrics
        fidelity_metrics = evaluation_data.get('fidelity_metrics', {})
        if 'overall_fidelity' not in fidelity_metrics:
            raise EvaluationNotRun(
                f"Evaluation report {evaluation_report_path} has no fidelity metrics"
            )
        overall_fidelity = fidelity_metrics['overall_fidelity']
        
        # Determine quality gate status
        quality_status = self._evaluate_quality_gates(fidelity_metrics, training_mode)
        
        # Generate performance analysis
        performance_analysis = self._analyze_performance_trends(fidelity_metrics)
        
        # Create improvement recommendations
        recommendations = self._generate_improvement_recommendations(
            fidelity_metrics, training_mode, quality_status
        )
        
        # Determine next actions
        next_actions = self._determine_next_actions(quality_status, recommendations, training_mode)
        
        analysis_results = {
            "timestamp": datetime.now().isoformat(),
            "status": "evaluated",
            "model_path": model_path,
            "training_mode": training_mode,
            "overall_fidelity": overall_fidelity,
            "quality_gate_status": quality_status,
            "performance_analysis": performance_analysis,
            "recommendations": recommendations,
            "next_actions": next_actions,
            "automation_triggers": self._generate_automation_triggers(quality_status, training_mode)
        }
        
        # Cache results for trend analysis
        self.results_cache[datetime.now().isoformat()] = analysis_results
        
        print(f"📊 Analysis complete: Overall fidelity {overall_fidelity:.3f}")
        print(f"🎯 Quality gate: {quality_status['status']}")
        
        return analysis_results
    
    def _evaluate_quality_gates(self, fidelity_metrics: Dict[str, float], training_mode: str) -> Dict[str, Any]:
        """Evaluate quality gates based on fidelity metrics."""
        gates = self.config["quality_gates"]
        
        # Select appropriate thresholds based on training mode
        if training_mode == "relentless":
            min_fidelity = gates["min_fidelity_production"]  
        elif training_mode == "ci":
            min_fidelity = gates["min_fidelity_development"] * 0.8  # Lower for CI
        else:
            min_fidelity = gates["min_fidelity_development"]
        
        overall_fidelity = fidelity_metrics.get('overall_fidelity', 0.0)
        identity_recognition = fidelity_metrics.get('identity_recognition', 0.0)
        persona_consistency = fidelity_metrics.get('persona_consistency', 0.0)
        
        # Check individual gates
        gates_status = {
            "overall_fidelity": {
                "passed": overall_fidelity >= min_fidelity,
                "score": overall_fidelity,
                "threshold": min_fidelity
            },
            "identity_recognition": {
                "passed": identity_recognition >= gates["min_identity_recognition"],
                "score": identity_recognition,
                "threshold": gates["min_identity_recognition"]
            },
            "persona_consistency": {
                "passed": persona_consistency >= gates["min_persona_consistency"],
                "score": persona_consistency,
                "threshold": gates["min_persona_consistency"]
            }
        }
        
        # Overall status
        all_passed = all(gate["passed"] for gate in gates_status.values())
        
        return {
            "status": "passed" if all_passed else "failed",
            "overall_passed": all_passed,
            "individual_gates": gates_status,
            "min_required_fidelity": min_fidelity,
            "deployment_ready": all_passed and overall_fidelity >= gates["min_fidelity_production"]
        }
    
    def _analyze_performance_trends(self, current_metrics: Dict[str, float]) -> Dict[str, Any]:
        """Analyze performance trends compared to previous runs."""
        if not self.improvement_history:
            return {
                "trend": "initial",
                "change": 0.0,
                "status": "baseline"
            }
        
        # Compare with most recent previous run
        previous_metrics = self.improvement_history[-1].get('fidelity_metrics', {})
        previous_fidelity = previous_metrics.get('overall_fidelity', 0.0)
        current_fidelity = current_metrics.get('overall_fidelity', 0.0)
        
        change = current_fidelity - previous_fidelity
        threshold = self.config["training_triggers"]["performance_improvement_threshold"]
        
        if change > threshold:
            trend = "improving"
            status = "good"
        elif change < -self.config["quality_gates"]["max_performance_decline"]:
            trend = "declining"
            status = "concerning"
        else:
            trend = "stable"
            status = "neutral"
        
        return {
            "trend": trend,
            "change": change,
            "status": status,
            "previous_fidelity": previous_fidelity,
            "current_fidelity": current_fidelity
        }
    
    def _generate_improvement_recommendations(self, 
                                            fidelity_metrics: Dict[str, float],
                                            training_mode: str,
                                            quality_status: Dict[str, Any]) -> Dict[str, List[str]]:
        """Generate specific improvement recommendations."""
        recommendations = {
            "immediate": [],
            "next_training_cycle": [],
            "long_term": [],
            "hyperparameter_adjustments": []
        }
        
        overall_fidelity = fidelity_metrics.get('overall_fidelity', 0.0)
        
        # Immediate recommendations based on failed quality gates
        failed_gates = [name for name, gate in quality_status["individual_gates"].items() 
                       if not gate["passed"]]
        
        for gate in failed_gates:
            if gate == "identity_recognition":
                recommendations["immediate"].append("Increase Echo Self identity training examples")
                recommendations["hyperparameter_adjustments"].append("increase_identity_weight")
            elif gate == "persona_consistency":
                recommendations["immediate"].append("Balance training across all persona dimensions")
                recommendations["hyperparameter_adjustments"].append("balance_persona_weights")
            elif gate == "overall_fidelity":
                recommendations["immediate"].append("Review overall training approach")
                recommendations["hyperparameter_adjustments"].append("extend_training_duration")
        
        # Training cycle recommendations based on performance level
        if overall_fidelity < 0.6:
            recommendations["next_training_cycle"].extend([
                "Increase training iterations significantly",
                "Enhance data quality and diversity",
                "Review model architecture parameters"
            ])
        elif overall_fidelity < 0.8:
            recommendations["next_training_cycle"].extend([
                "Fine-tune with targeted examples",
                "Adjust attention mechanism parameters"
            ])
        
        # Mode-specific recommendations
        if training_mode == "relentless":
            if overall_fidelity < 0.85:
                recommendations["next_training_cycle"].append("Increase relentless training frequency")
            recommendations["long_term"].append("Monitor continuous improvement trends")
        else:
            if overall_fidelity > 0.75:
                recommendations["next_training_cycle"].append("Consider enabling relentless training mode")
        
        return recommendations
    
    def _determine_next_actions(self, 
                              quality_status: Dict[str, Any],
                              recommendations: Dict[str, List[str]],
                              training_mode: str) -> Dict[str, Any]:
        """Determine specific next actions based on analysis."""
        actions = {
            "continue_training": False,
            "deploy_model": False,
            "retrain_required": False,
            "enable_relentless_mode": False,
            "schedule_next_cycle": False,
            "manual_review_needed": False
        }
        
        if quality_status["deployment_ready"]:
            actions["deploy_model"] = True
            if training_mode != "relentless":
                actions["enable_relentless_mode"] = True
                actions["schedule_next_cycle"] = True
        elif quality_status["status"] == "passed":
            actions["continue_training"] = True
            actions["schedule_next_cycle"] = True
        else:
            # Quality gates failed
            if quality_status["individual_gates"]["overall_fidelity"]["score"] < 0.5:
                actions["retrain_required"] = True
                actions["manual_review_needed"] = True
            else:
                actions["continue_training"] = True
                actions["schedule_next_cycle"] = True
        
        # Automatic scheduling for relentless mode
        if training_mode == "relentless" and not quality_status["deployment_ready"]:
            actions["schedule_next_cycle"] = True
        
        return actions
    
    def _generate_automation_triggers(self, 
                                    quality_status: Dict[str, Any],
                                    training_mode: str) -> Dict[str, Any]:
        """Generate automation triggers for CI/CD system."""
        triggers = {
            "trigger_next_training": False,
            "training_delay_hours": 0,
            "hyperparameter_adjustments": {},
            "dataset_enhancements": [],
            "notification_required": False
        }
        
        config = self.config["training_triggers"]
        
        if not quality_status["overall_passed"] and config["auto_retrain_on_failure"]:
            triggers["trigger_next_training"] = True
            triggers["training_delay_hours"] = 1  # Quick retry
            triggers["notification_required"] = True
        
        if training_mode == "relentless":
            triggers["trigger_next_training"] = True
            triggers["training_delay_hours"] = config["relentless_training_interval_hours"]
        
        # Hyperparameter adjustments based on performance
        overall_fidelity = quality_status["individual_gates"]["overall_fidelity"]["score"]
        if overall_fidelity < 0.7:
            triggers["hyperparameter_adjustments"]["learning_rate"] = "increase"
            triggers["hyperparameter_adjustments"]["max_iters"] = "increase"
        
        return triggers
    
    def integrate_with_evaluation_loop(self, config_path: Optional[str] = None) -> "AutomatedEvaluationLoop":
        """
        Create and configure an AutomatedEvaluationLoop instance for continuous evaluation.
        
        Args:
            config_path: Optional path to evaluation loop configuration
            
        Returns:
            Configured AutomatedEvaluationLoop instance
        
        Raises:
            EvaluationNotRun: If the evaluation loop is not available.
        """
        if not AUTOMATED_LOOP_AVAILABLE:
            raise EvaluationNotRun(
                f"AutomatedEvaluationLoop not available: {IMPORT_ERRORS.get('automated_loop')}"
            )
        eval_loop = AutomatedEvaluationLoop(config_path)
        print("✅ Integrated with automated evaluation loop")
        return eval_loop
    
    def run_comprehensive_nanocog_evaluation(self, 
                                           generated_samples: List[str], 
                                           reference_corpus: Optional[List[str]] = None,
                                           atomspace_state: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """
        Run comprehensive NanoCog evaluation using the real metrics system.
        
        Args:
            generated_samples: List of model-generated samples to evaluate
            reference_corpus: Optional reference corpus for comparison
            atomspace_state: Optional live AtomSpace state for diagnostic alignment
            
        Returns:
            Comprehensive evaluation results
        
        Raises:
            EvaluationNotRun: If the evaluator is unavailable or there are no samples.
        """
        if not NANOCOG_EVALUATOR_AVAILABLE:
            raise EvaluationNotRun(f"NanoCog evaluator not available: {IMPORT_ERRORS.get('metrics')}")
        if not generated_samples:
            raise EvaluationNotRun("No generated samples to evaluate")
        
        evaluator = NanoCogEvaluator(self.config.get('nanocog_evaluation', {}))
        results = evaluator.evaluate_model_generation(
            generated_samples, 
            reference_corpus, 
            atomspace_state
        )
        
        print(f"✅ Comprehensive NanoCog evaluation completed")
        print(f"   Overall Score: {results.get('overall_performance', {}).get('overall_score', 0):.3f}")
        
        return results

    def generate_model_samples(self, model_path: str, prompts: List[str],
                               max_new_tokens: int = 200) -> List[str]:
        """Generate one completion per prompt with the trained model.

        Raises:
            EvaluationNotRun: If the model cannot be loaded or generation fails.
        """
        if not (TORCH_AVAILABLE and ECHO_MODEL_AVAILABLE):
            raise EvaluationNotRun(f"Model generation dependencies unavailable: {IMPORT_ERRORS}")
        try:
            device = "cuda" if torch.cuda.is_available() else "cpu"
            model_config = EchoModelConfig(model_path, device)
            model_config.load_model()
            return [
                f"{prompt}\n{model_config.generate(prompt, max_new_tokens=max_new_tokens, temperature=0.8, top_k=40)}"
                for prompt in prompts
            ]
        except Exception as e:
            raise EvaluationNotRun(f"Sample generation with {model_path} failed: {e}") from e

    def save_analysis_results(self, results: Dict[str, Any], output_path: str):
        """Save analysis results to file and persist cross-cycle improvement history."""
        # Add to improvement history
        self.improvement_history.append({
            "timestamp": results["timestamp"],
            "fidelity_metrics": {
                "overall_fidelity": results["overall_fidelity"]
            },
            "quality_status": results["quality_gate_status"]["status"],
            "training_mode": results["training_mode"]
        })

        # Persist improvement history so future runs can compare against it
        self._save_improvement_history()
        
        # Save complete results
        with open(output_path, 'w') as f:
            json.dump(results, f, indent=2)
        
        print(f"💾 Analysis results saved to: {output_path}")

        # Log cross-cycle improvement summary
        summary = self.get_cycle_improvement_summary()
        print(f"📈 Cross-cycle trend: {summary['trend']} "
              f"(Δ{summary['delta']:+.3f} over {summary['total_cycles']} cycle(s))")
    
    def generate_automation_report(self, results: Dict[str, Any]) -> str:
        """Generate human-readable automation report."""
        report_lines = [
            "# NANECHO Training Automation Report",
            f"**Generated:** {results['timestamp']}",
            f"**Training Mode:** {results['training_mode']}",
            "",
            "## Performance Summary",
            f"- Overall Fidelity: {results['overall_fidelity']:.3f}",
            f"- Quality Gate Status: {results['quality_gate_status']['status'].upper()}",
            f"- Deployment Ready: {'✅' if results['quality_gate_status']['deployment_ready'] else '❌'}",
            ""
        ]

        # Add cross-cycle improvement trend
        summary = self.get_cycle_improvement_summary()
        report_lines.append("## Cross-Cycle Improvement Trend")
        trend_emoji = {"improving": "📈", "stable": "➡️", "declining": "📉", "no_data": "❓"}
        report_lines.append(
            f"- Trend: {trend_emoji.get(summary['trend'], '')} **{summary['trend'].upper()}**"
        )
        report_lines.append(f"- Cycles Recorded: {summary['total_cycles']}")
        if summary['total_cycles'] >= 2:
            report_lines.append(f"- Baseline Fidelity: {summary['baseline_fidelity']:.3f}")
            report_lines.append(f"- Recent Fidelity:   {summary['recent_fidelity']:.3f}")
            report_lines.append(f"- Δ Improvement:     {summary['delta']:+.3f}")
            report_lines.append(f"- Best Ever:         {summary['best_fidelity']:.3f}")
        report_lines.append("")
        
        # Add quality gate details
        report_lines.append("## Quality Gate Details")
        for gate_name, gate_info in results['quality_gate_status']['individual_gates'].items():
            status = "✅ PASS" if gate_info['passed'] else "❌ FAIL"
            report_lines.append(f"- {gate_name}: {gate_info['score']:.3f} (threshold: {gate_info['threshold']:.3f}) {status}")
        report_lines.append("")
        
        # Add recommendations
        if results['recommendations']['immediate']:
            report_lines.append("## Immediate Actions Required")
            for rec in results['recommendations']['immediate']:
                report_lines.append(f"- {rec}")
            report_lines.append("")
        
        # Add next steps
        report_lines.append("## Next Steps")
        next_actions = results['next_actions']
        for action, should_do in next_actions.items():
            if should_do:
                report_lines.append(f"- {action.replace('_', ' ').title()}")
        
        # Add automation triggers
        triggers = results['automation_triggers']
        if triggers['trigger_next_training']:
            report_lines.append("")
            report_lines.append("## Automation Schedule")
            report_lines.append(f"- Next training cycle: +{triggers['training_delay_hours']} hours")
            if triggers['hyperparameter_adjustments']:
                report_lines.append("- Hyperparameter adjustments scheduled")
        
        return "\n".join(report_lines)

def main():
    """Command-line interface for automation integration."""
    parser = argparse.ArgumentParser(description="NanEcho Automation Integration")
    parser.add_argument("--model_path", type=str, required=True,
                       help="Path to trained model")
    parser.add_argument("--evaluation_report", type=str, required=True,
                       help="Path to evaluation report")
    parser.add_argument("--training_mode", type=str, default="standard",
                       choices=["standard", "relentless", "ci"],
                       help="Training mode")
    parser.add_argument("--output_path", type=str, default="automation_analysis.json",
                       help="Output path for analysis results")
    parser.add_argument("--config", type=str, help="Path to configuration file")
    parser.add_argument("--generate_report", action="store_true",
                       help="Generate human-readable report")
    parser.add_argument("--run_comprehensive", action="store_true",
                       help="Run comprehensive NanoCog evaluation")
    parser.add_argument("--start_continuous", action="store_true",
                       help="Start continuous evaluation loop")
    parser.add_argument("--reference_corpus", type=str, default=None,
                       help="Reference corpus file (one sample per line) for --run_comprehensive")
    
    args = parser.parse_args()
    
    print("🤖 NANECHO Training Automation Integration")
    print(f"Model: {args.model_path}")
    print(f"Evaluation Report: {args.evaluation_report}")
    print(f"Training Mode: {args.training_mode}")
    print(f"PyTorch Available: {'✅' if TORCH_AVAILABLE else '❌'}")
    print(f"Echo Fidelity Available: {'✅' if ECHO_FIDELITY_AVAILABLE else '❌'}")
    print(f"Automated Loop Available: {'✅' if AUTOMATED_LOOP_AVAILABLE else '❌'}")
    print(f"NanoCog Evaluator Available: {'✅' if NANOCOG_EVALUATOR_AVAILABLE else '❌'}")
    
    # Create integrator
    integrator = NanEchoAutomationIntegrator(args.config)
    
    # Analyze results with real evaluation
    try:
        results = integrator.analyze_training_results(
            args.model_path,
            args.evaluation_report,
            args.training_mode
        )
    except EvaluationNotRun as e:
        print(f"❌ Model not evaluated: {e}")
        with open(args.output_path, 'w') as f:
            json.dump({
                "timestamp": datetime.now().isoformat(),
                "status": "not_evaluated",
                "error": str(e),
                "model_path": args.model_path,
                "training_mode": args.training_mode
            }, f, indent=2)
        print(f"💾 Not-evaluated status written to: {args.output_path}")
        sys.exit(1)
    
    # Save results
    integrator.save_analysis_results(results, args.output_path)
    
    # Run comprehensive NanoCog evaluation if requested
    if args.run_comprehensive:
        print("\n🔬 Running comprehensive NanoCog evaluation...")
        
        sample_prompts = [
            "Explain the CogPrime cognitive architecture:",
            "Generate Atomese code for goal-oriented behavior:",
            "Analyze attention allocation bottlenecks:",
            "Create a cognitive schematic for learning:",
            "Describe ECAN attention dynamics:"
        ]
        reference_corpus = None
        if args.reference_corpus:
            with open(args.reference_corpus, 'r', encoding='utf-8') as f:
                reference_corpus = [line.strip() for line in f if line.strip()]
        
        try:
            generated_samples = integrator.generate_model_samples(args.model_path, sample_prompts)
            comprehensive_results = integrator.run_comprehensive_nanocog_evaluation(
                generated_samples,
                reference_corpus=reference_corpus
            )
        except EvaluationNotRun as e:
            print(f"❌ Comprehensive evaluation not run: {e}")
            comprehensive_results = {
                "timestamp": datetime.now().isoformat(),
                "status": "not_evaluated",
                "error": str(e)
            }
        
        # Save comprehensive results
        comprehensive_path = args.output_path.replace('.json', '_comprehensive.json')
        with open(comprehensive_path, 'w') as f:
            json.dump(comprehensive_results, f, indent=2)
        print(f"📊 Comprehensive results saved to: {comprehensive_path}")
    
    # Start continuous evaluation loop if requested
    if args.start_continuous:
        print("\n🔄 Starting continuous evaluation loop...")
        try:
            eval_loop = integrator.integrate_with_evaluation_loop(args.config)
        except EvaluationNotRun as e:
            print(f"❌ Continuous evaluation not started: {e}")
            sys.exit(1)
        
        try:
            eval_loop.start_evaluation_loop()
        except KeyboardInterrupt:
            print("\n⏹️ Stopping continuous evaluation...")
            eval_loop.stop_evaluation_loop()
    
    # Generate report if requested
    if args.generate_report:
        report = integrator.generate_automation_report(results)
        report_path = args.output_path.replace('.json', '_report.md')
        with open(report_path, 'w') as f:
            f.write(report)
        print(f"📄 Human-readable report saved to: {report_path}")
    
    # Output key results for CI/CD
    print(f"\n🎯 Quality Gate: {results['quality_gate_status']['status'].upper()}")
    print(f"📊 Overall Fidelity: {results['overall_fidelity']:.3f}")
    print(f"🚀 Deployment Ready: {results['quality_gate_status']['deployment_ready']}")
    print(f"📈 Evaluation Status: {results.get('status')}")
    
    if results['automation_triggers']['trigger_next_training']:
        print(f"⏰ Next Training: +{results['automation_triggers']['training_delay_hours']} hours")
    
    print("✅ Automation integration complete!")

if __name__ == "__main__":
    main()