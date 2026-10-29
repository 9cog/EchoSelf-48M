;
; cfg-tools.scm
;
; Behavior Tree configuration parameters utilities.
;
; Provide handy wrappers that simplify the declaration of configuration
; parameters. Required by `cfg-sophia.scm` and `cfg-eva.scm`.
;
; --------------------------------------------------------
; Emotional-state to expression mapping. For a given emotional state
; (for example, happy, bored, excited), this specifies a range of
; expressions to display for that emotional state, as well as the
; intensities and durations.  `emo-set` adds an expression to an
; emotional state, while `emo-map` is used to set parameters.
(define (emo-expr-set emo-state expression)
	(EvaluationLink
		(PredicateNode "Emotion-expression")
		(ListLink (ConceptNode emo-state) (ConceptNode expression))))

(define (emo-expr-map emo-state expression param value)
	(StateLink (ListLink
		(ConceptNode emo-state) (ConceptNode expression) (SchemaNode param))
		(NumberNode value)))

; Shorthand utility, takes probability, intensity min and max, duration min
; and max.
(define-public (emo-expr-spec emo-state expression
		prob int-min int-max dur-min dur-max)
	(emo-expr-set emo-state expression)
	(emo-expr-map emo-state expression "probability" prob)
	(emo-expr-map emo-state expression "intensity-min" int-min)
	(emo-expr-map emo-state expression "intensity-max" int-max)
	(emo-expr-map emo-state expression "duration-min" dur-min)
	(emo-expr-map emo-state expression "duration-max" dur-max))

; --------------------------------------------------------
; Emotional-state to gesture mapping. For a given emotional state
; (for example, happy, bored, excited), this specifies a range of
; gestures to display for that emotional state, as well as the
; intensities and durations.  `ges-set` adds a gesture to an
; emotional state, while `ges-map` is used to set parameters.
(define (emo-gest-set emo-state gesture)
	(EvaluationLink
		(PredicateNode "Emotion-gesture")
		(ListLink (ConceptNode emo-state) (ConceptNode gesture))))

(define (emo-gest-map emo-state gesture param value)
	(StateLink (ListLink
		(ConceptNode emo-state) (ConceptNode gesture) (SchemaNode param))
		(NumberNode value)))

; Shorthand utility, takes probability, intensity min and max, duration min
; and max, repeat min and max.
(define-public (emo-gest-spec emo-state gesture prob
		int-min int-max rep-min rep-max spd-min spd-max)
	(emo-gest-set emo-state gesture)
	(emo-gest-map emo-state gesture "gest probability" prob)
	(emo-gest-map emo-state gesture "gest intensity-min" int-min)
	(emo-gest-map emo-state gesture "gest intensity-max" int-max)
	(emo-gest-map emo-state gesture "repeat-min" rep-min)
	(emo-gest-map emo-state gesture "repeat-max" rep-max)
	(emo-gest-map emo-state gesture "speed-min" spd-min)
	(emo-gest-map emo-state gesture "speed-max" spd-max))

; --------------------------------------------------------
;
; Model decisions.  Whether Eva performs a discretionary action at some
; moment (glance at a newcomer, study a face, fall asleep, wake up, ...)
; is decided by the model, never by a random number.  The model is told
; what the action is, what Eva currently perceives, and her configured
; disposition (a probability, or a typical time range), and answers in
; JSON.  If the model cannot be reached or replies invalidly, the error
; is logged and the action is not performed.

(use-modules (srfi srfi-1))

; Plain-English descriptions of the discretionary actions, keyed by
; the dice-roll action name or the timing predicate name.
(define model-decision-actions
	'(("wake on disturbance" .
		"wake up, because someone has arrived, spoken to you or made a sound while you were asleep")
	  ("glance new face" .
		"briefly glance at a person who has just arrived, while you keep interacting with the person you are with")
	  ("glance lost face" .
		"glance at the spot where a person who just left was last seen")
	  ("group interaction" .
		"glance at another person in the group in front of you")
	  ("face study" .
		"study the face of the person you are with, letting your eyes move over their features")
	  ("Time to change interaction" .
		"turn your attention to a different person in front of you")
	  ("Time to wake up" .
		"wake up from sleep")
	  ("Bored too long" .
		"fall asleep, because nothing has been happening")
	  ("Silent too long" .
		"react to the long silence")
	  ("Time to change expression" .
		"change your facial expression")
	  ("Time to make gesture" .
		"make a gesture")
	  ("Time to change gaze" .
		"look around the room for someone's attention")
	  ("Time to reset glance" .
		"end your glance and look back")))

(define (model-decision-action name)
	(or (assoc-ref model-decision-actions name) name))

; Current number held by the configuration StateLink named NAME, or #f.
(define (state-number name)
	(catch #t
		(lambda ()
			(let ((r (cog-execute!
					(Get (TypedVariable (Variable "$x") (Type "NumberNode"))
						(State (Schema name) (Variable "$x"))))))
				(string->number (cog-name
					(if (cog-link? r) (car (cog-outgoing-set r)) r)))))
		(lambda _ #f)))

(define (perceived-faces)
	(catch #t
		(lambda ()
			(let ((n (inexact->exact (round (string->number (cog-name
					(cog-execute! (DefinedSchema "Num visible faces"))))))))
				(cond
					((= n 0) "You cannot see anyone in front of you.")
					((= n 1) "You can see one person in front of you.")
					(else (format #f "You can see ~a people in front of you." n)))))
		(lambda _ "")))

; Ask the model a yes/no question about ACTION; DISPOSITION and EXTRA
; are sentences given to it as context.  Returns the parsed reply alist.
(define (model-decision action disposition extra)
	(let ((obj (eva-model-complete-json eva-persona
			(string-append
				"Decide, in character, whether you " action " right now.\n"
				(perceived-faces) "\n"
				disposition "\n"
				extra
				"\nAnswer with only a JSON object with the keys \"now\" (true or false)"
				" and \"recheck_seconds\" (how many seconds until you would"
				" reconsider, if not now)."))))
		(if (not (boolean? (assoc-ref obj "now")))
			(throw 'eva-model-error
				(format #f "model gave no boolean \"now\" for ~s" action)))
		obj))

(define (bool->stv b) (if b (stv 1 1) (stv 0 1)))

; model-decides-now ACTION -- ACTION is a ConceptNode naming a
; dice-roll action.  The model decides whether Eva does it now.
(define-public (model-decides-now action-atom)
	(define name (cog-name action-atom))
	(define p (state-number (string-append name " probability")))
	(catch #t
		(lambda ()
			(bool->stv (assoc-ref
				(model-decision (model-decision-action name)
					(if p
						(format #f "Your disposition: in situations like this you do it about ~a% of the time."
							(inexact->exact (round (* 100 p))))
						"")
					"")
				"now")))
		(lambda (key . args)
			(eva-model-log-error
				(format #f "deciding whether to ~a" name) key args)
			(stv 0 1))))

; Earliest time (seconds) at which each timing decision is reconsidered;
; the model sets this when it decides "not yet".
(define model-recheck-at (make-hash-table))

; model-decides-timing PRED ELAPSED MIN MAX -- the timing predicate
; PRED (a ConceptNode) has been running for ELAPSED seconds, past its
; configured minimum.  The model decides whether now is the moment.
(define-public (model-decides-timing pred-atom ts-atom min-atom max-atom)
	(define name (cog-name pred-atom))
	(define now (current-time))
	(define recheck (hash-ref model-recheck-at name 0))
	(if (< now recheck)
		(stv 0 1)
		(catch #t
			(lambda ()
				(let* ((elapsed (string->number (cog-name (cog-execute!
							(Minus (TimeLink)
								(DefinedSchema (cog-name ts-atom)))))))
						(lo (state-number (cog-name min-atom)))
						(hi (state-number (cog-name max-atom)))
						(obj (model-decision (model-decision-action name)
							(if (and lo hi)
								(format #f "Your disposition: you usually do this after ~a to ~a seconds."
									lo hi)
								"")
							(format #f "It has been ~a seconds." (round elapsed))))
						(wait (assoc-ref obj "recheck_seconds")))
					(if (not (assoc-ref obj "now"))
						(hash-set! model-recheck-at name
							(+ now (inexact->exact (round
								(max 1 (min (if (real? wait) wait 1)
									(if (and lo hi) (max 1 (- hi lo)) 60))))))))
					(bool->stv (assoc-ref obj "now"))))
			(lambda (key . args)
				(eva-model-log-error
					(format #f "deciding whether to ~a" name) key args)
				; Do not retry the failing model on every behavior tick.
				(hash-set! model-recheck-at name (+ now 5))
				(stv 0 1)))))

; model-blink-rate CONTEXT MEAN VAR -- Eva's blink rhythm as part of her
; reaction in the situation named by CONTEXT (a ConceptNode).  MEAN and
; VAR (schemas or numbers) are her configured baseline for that
; situation; the model chooses the actual mean interval and variance,
; kept within a physiological band around the baseline.  On model
; failure the blink rate is left unchanged and the error is logged.
(define-public (model-blink-rate context mean-atom var-atom)
	(define (num a)
		(string->number (cog-name
			(if (cog-node? a) a (cog-execute! a)))))
	(catch #t
		(lambda ()
			(let* ((m0 (num mean-atom)) (v0 (num var-atom))
					(obj (eva-model-complete-json eva-persona
						(format #f "Choose your blink rhythm, in character, now that you are ~a.
~a
Your usual rhythm in this situation: a blink every ~a seconds on average, variance ~a.
Answer with only a JSON object with the keys \"mean\" (seconds between blinks) and \"var\" (variance)."
							(cog-name context) (perceived-faces) m0 v0)))
					(m (assoc-ref obj "mean"))
					(v (assoc-ref obj "var"))
					(band (lambda (x base)
						(max (/ base 4) (min (* base 4) x)))))
				(if (not (and (real? m) (real? v)))
					(throw 'eva-model-error
						(format #f "model gave no numeric blink mean/var for ~s"
							(cog-name context))))
				(cog-evaluate!
					(Evaluation (DefinedPredicate "Blink rate")
						(ListLink (Number (band m m0)) (Number (band v v0)))))
				(stv 1 1)))
		(lambda (key . args)
			(eva-model-log-error
				(format #f "choosing the blink rate while ~a" (cog-name context))
				key args)
			(stv 0 1))))

; --------------------------------------------------------
;
; Model-decided conditionals.  `dice-roll` keeps its historical name:
; it declares a discretionary action and Eva's disposition towards it
; (a probability, stored in a StateLink so it can be changed at
; run-time), but whether the action happens is decided by the model
; (see `model-decides-now`), not by a random number.
;
; Two strings are auto-generated: the action defnition, by pre-pending
; "dice-roll: " to the action name, and the disposition state name,
; by appending " probability" to the action name.
;
; line 588 -- dice_roll("glance_new_face") etc.
(define-public (dice-roll action probability)
	(define prob-name (string-append action " probability"))
	(State (Schema prob-name) (Number probability))
	(DefineLink
		(DefinedPredicateNode (string-append "dice-roll: " action))
		(Evaluation (GroundedPredicate "scm: model-decides-now")
			(ListLink (Concept action)))))

; --------------------------------------------------------
