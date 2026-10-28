;
; Self-awareness scheme module for the Eva robot.
; Allows the self-awareness code to be imported as a module.

(define-module (opencog eva-model)
	#:use-module (opencog)
	#:use-module (opencog nlp)
	#:use-module (opencog exec)
)

; Load various parts....
(load "eva-model/llm.scm")
(load "eva-model/prompts.scm")
(load "eva-model/faces.scm")
(load "eva-model/self-model.scm")
(load "eva-model/face-choice.scm")
(load "eva-model/time-map.scm")
(load "eva-model/utilities.scm")
