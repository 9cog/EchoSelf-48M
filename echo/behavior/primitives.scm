;
; primitives.scm
;
; Behavior tree primitives.
;
; Defines a set of primitive behaviors from which behavior trees can be
; constructed.  Mostly a collection of odds and ends that don't have a
; home somewhere else (but probably should).
;
; --------------------------------------------------------

(use-modules (opencog) (opencog exec))
(use-modules (opencog nlp))
(use-modules (opencog logger))
(use-modules (opencog eva-model))

; --------------------------------------------------------
; Some debug prints.
; The are define-public, because otherwise the
; `(GroundedPredicate "scm: print-msg")` won't work.
(define eva-logger (eva-get-logger))

(define-public (print-msg node)
	(cog-logger-info eva-logger "~a\n" (cog-name node))
	(stv 1 1))

; Print message, and print the current interaction face-id
(define-public (print-msg-face node)
	(cog-logger-info eva-logger "~a with face id: ~a"
		(cog-name node)
		(cog-name (cog-outgoing-atom (cog-execute!
			(DefinedSchemaNode "Current interaction target")) 0)))
	(stv 1 1))

; Print message, then print elapsed time
(define-public (print-msg-time node time)
	(cog-logger-info eva-logger "~a Elapsed: ~a seconds"
		(cog-name node)
		(cog-name time))
	(stv 1 1))

;; ------------------------------------------------------------------
;; Personality-related timeouts.
;;
;; According to her personality parameters, she will get bored after
;; a while, fall asleep, etc. The code immediately below defines a
;; a bunch of predicates that give yes/no answers to questions such
;; as "have I been bored for too long?".  These depend on having
;; timestamps being correctly defined and recorded at various points
;; during behavior script execution.  They also depend on the config
;; files specifying a min and max timeout value.
;
; ----------------
; change-template - utility to create timeout predicates.
;
; Define a predicate that evaluates to true or false, if it is time
; to do something. PRED-NAME is the name given to the predicate,
; TS-NAME is the name given to the timestamp that holds the start-time;
; MIN-NAME and MAX-NAME are the string names of the configurable
; min and max bounds for the time interval.  If the elapsed time since
; the timestamp is less than MIN, return false (a refractory period).
; Past MIN, the model decides whether now is the moment, given the
; elapsed time and the configured range as Eva's disposition (see
; `model-decides-timing` in cfg-tools.scm); no random number decides.
(define (change-template pred-name ts-name min-name max-name)
	(define get-ts (string-append "get " ts-name " timestamp"))
	(DefineLink
		(DefinedPredicate pred-name)
		(SequentialAnd
			; If elapsed time less than min, then false.
			(GreaterThan
				; Minus computes number of seconds since interaction start.
				(Minus (TimeLink) (DefinedSchema get-ts))
				(Get
					(TypedVariable (Variable "$min") (Type "NumberNode"))
					(State (Schema min-name) (Variable "$min"))))
			(Evaluation (GroundedPredicate "scm: model-decides-timing")
				(ListLink
					(Concept pred-name)
					(Concept get-ts)
					(Concept min-name)
					(Concept max-name))))))

; Return true if it is time to interact with someone else.
(change-template "Time to change interaction" "interaction"
	"time_to_change_face_target_min" "time_to_change_face_target_max")

; Return true if we've been sleeping for long enough (i.e. longer than
; the time_to_wake_up parameter).
(change-template "Time to wake up" "sleep"
	"time_sleeping_min" "time_sleeping_max")

; Return true if we've been bored for a long time (i.e. longer than
; the time_bored_to_sleep parameter).
(change-template "Bored too long" "bored"
	"time_boredom_min" "time_boredom_max")

; Return true, if we have not heard anything in a while.
(change-template "Silent too long" "heard-something"
	"silence_min" "silence_max")

;; Evaluate to true, if an expression should be shown.
;; (if it is OK to show a new expression). Prevents system from
;; showing new facial expressions too frequently.
(change-template "Time to change expression" "expression"
	"time_since_last_expr_min" "time_since_last_expr_max")

(change-template "Time to make gesture" "gesture"
	"time_since_last_gesture_min" "time_since_last_gesture_max")

(change-template "Time to change gaze" "attn-search"
	"time_search_attn_min" "time_search_attn_max")

  (change-template "Time to reset glance" "glance"
  	"time_search_glance_min" "time_search_glance_max")
; ----------------------------------------------------------------------
; Sigh. Perform manual garbage collection. This really should be
; automated. XXX TODO. (Can we get ECAN to do this for us?)
(define-public (run-behavior-tree-gc)
	(define (free-stuff)
		(sleep 1)
		(cog-map-type (lambda (a) (cog-extract! a) #f) 'SetLink)
		(cog-map-type (lambda (a) (cog-extract! a) #f) 'ListLink)
		(cog-map-type (lambda (a) (cog-extract! a) #f) 'NumberNode)
		(cog-map-type (lambda (a) (cog-extract! a) #f) 'ConceptNode)
		(free-stuff)
	)
	(call-with-new-thread free-stuff)
)
; ----------------------------------------------------------------------
