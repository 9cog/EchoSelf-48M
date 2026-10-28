;
; express.scm
;
; Generate facial expressions and gestures, based on the "personality
; configuration" paramaters in the `cfg-*.scm` files.
;
; The configuration lists, for each emotional-expression class (for
; example "positive", "bored", "new-arrival"), the facial expressions
; and gestures that are allowed in that class, together with the
; allowed ranges of intensity, duration, repetition and speed.  That
; table is given to the language model (see `eva-model/llm.scm`) as its
; allowed vocabulary; the model chooses which expression or gesture Eva shows,
; and how strongly and for how long.  The model's choice is validated
; against the table and then sent to the action orchestrator.
;
; If the model is not configured, is unreachable, or makes an invalid
; choice, nothing is shown and the error is logged.  The behavior tree
; itself continues (the defined predicates below always evaluate to
; true), so that non-expressive bookkeeping (state changes, timestamps)
; is not disturbed.
;
; --------------------------------------------------------

(use-modules (srfi srfi-1))

; Look up a configuration number stored as
;    (State (List (Concept EMO) (Concept NAME) (Schema PARAM)) (Number x))
(define (cfg-number emo name param)
	(let* ((key (ListLink (ConceptNode emo) (ConceptNode name)
				(SchemaNode param)))
			(states (cog-incoming-by-type key 'StateLink)))
		(if (null? states)
			#f
			(string->number (cog-name (cog-outgoing-atom (car states) 1))))))

; Return the names (strings) of the expressions (or gestures) that the
; configuration allows for the emotional-expression class EMO.
(define (cfg-choices pred-name emo)
	(filter-map
		(lambda (ev)
			(let ((args (cog-outgoing-atom ev 1)))
				(and (eq? 'ListLink (cog-type args))
					(equal? (cog-name (cog-outgoing-atom args 0)) emo)
					(cog-name (cog-outgoing-atom args 1)))))
		(cog-incoming-by-type (PredicateNode pred-name) 'EvaluationLink)))

; Per-kind description: the configuration predicate, the parameters
; that the model must pick (JSON key, config min name, config max
; name), and the prior-weight parameter name.
(define expression-kind
	(list "Emotion-expression" "probability"
		(list (list "intensity" "intensity-min" "intensity-max")
			(list "duration" "duration-min" "duration-max"))))

(define gesture-kind
	(list "Emotion-gesture" "gest probability"
		(list (list "intensity" "gest intensity-min" "gest intensity-max")
			(list "repeat" "repeat-min" "repeat-max")
			(list "speed" "speed-min" "speed-max"))))

(define (kind-pred kind) (car kind))
(define (kind-prob kind) (cadr kind))
(define (kind-params kind) (caddr kind))

; Describe one allowed choice to the model.
(define (describe-choice kind emo name)
	(format #f "- ~s (usual weight ~a): ~a" name
		(or (cfg-number emo name (kind-prob kind)) "?")
		(string-join
			(map (lambda (p)
					(format #f "~a between ~a and ~a" (car p)
						(cfg-number emo name (cadr p))
						(cfg-number emo name (caddr p))))
				(kind-params kind))
			", ")))

; Ask the model to choose. Returns (name . alist-of-param-values),
; with every value validated against the configuration.
; FIXED-NAME, if not #f, is an expression the caller already decided
; on (e.g. a spoken command "smile"); the model then chooses only the
; parameters.  CONTEXT, if not #f, is an extra description of the
; situation for the model.  Throws 'eva-model-error on any failure.
(define (model-choose kind what emo fixed-name context)
	(let* ((names (if fixed-name (list fixed-name)
				(cfg-choices (kind-pred kind) emo)))
			(param-keys (map car (kind-params kind))))
		(if (null? names)
			(throw 'eva-model-error
				(format #f "no ~a configured for class ~s" what emo)))
		(let* ((prompt (string-append
					(if context
						(string-append context "\n")
						(format #f "Situation / emotional state: ~s.\n" emo))
					(format #f "Choose the ~a you show right now. "
						what)
					"Allowed choices, with their allowed parameter ranges:\n"
					(string-join
						(map (lambda (n) (describe-choice kind emo n)) names)
						"\n")
					"\n\nAnswer with only a JSON object with the keys "
					(string-join
						(map (lambda (k) (format #f "~s" k))
							(cons "name" param-keys))
						", ")
					"."))
				(obj (eva-model-complete-json eva-persona prompt))
				(name (assoc-ref obj "name")))
			(if (not (and (string? name) (member name names)))
				(throw 'eva-model-error
					(format #f "model chose ~s, not one of ~s" name names)))
			(cons name
				(map (lambda (p)
						(let ((v (assoc-ref obj (car p)))
								(lo (cfg-number emo name (cadr p)))
								(hi (cfg-number emo name (caddr p))))
							(if (not (real? v))
								(throw 'eva-model-error
									(format #f "model gave no numeric ~s for ~s"
										(car p) name)))
							(if (not (and lo hi))
								(throw 'eva-model-error
									(format #f "no ~s range configured for ~s/~s"
										(car p) emo name)))
							; Keep the model's value inside the allowed range.
							(cons (car p)
								(max (min lo hi) (min (max lo hi) v)))))
					(kind-params kind))))))

; Choose with the model and perform; return #t, or log and return #f.
(define (model-express kind what emo fixed-name context perform)
	(catch #t
		(lambda ()
			(let ((choice (model-choose kind what emo fixed-name context)))
				(perform (car choice) (cdr choice))
				#t))
		(lambda (key . args)
			(eva-model-log-error
				(format #f "choosing ~a for ~s" what emo) key args)
			#f)))

(define (perform-expression name vals)
	(cog-evaluate!
		(Put (DefinedPredicate "Show facial expression")
			(ListLink
				(Concept name)
				(Number (assoc-ref vals "duration"))
				(Number (assoc-ref vals "intensity"))))))

(define (perform-gesture name vals)
	(cog-evaluate!
		(Put (DefinedPredicate "Show gesture")
			(ListLink
				(Concept name)
				(Number (assoc-ref vals "intensity"))
				(Number (round (assoc-ref vals "repeat")))
				(Number (assoc-ref vals "speed"))))))

(define (bool->tv b) (if b (stv 1 1) (stv 0 1)))

; --------------------------------------------------------
; Scheme entry points.  These are define-public, because otherwise
; `(GroundedPredicate "scm: ...")` cannot find them.
;
; model-show-expression EMO -- the model picks an expression from the
;    class EMO (a ConceptNode), with intensity and duration.
; model-show-class-expression EMO EXPR -- the expression EXPR was
;    already decided on (e.g. by a spoken command); the model picks the
;    intensity and duration from the ranges for EMO/EXPR.
; model-show-gesture, model-show-class-gesture -- likewise, gestures.

(define-public (model-show-expression emo)
	(bool->tv (model-express expression-kind "facial expression"
		(cog-name emo) #f #f perform-expression)))

(define-public (model-show-class-expression emo expr)
	(bool->tv (model-express expression-kind "facial expression"
		(cog-name emo) (cog-name expr) #f perform-expression)))

(define-public (model-show-gesture emo)
	(bool->tv (model-express gesture-kind "gesture"
		(cog-name emo) #f #f perform-gesture)))

(define-public (model-show-class-gesture emo gest)
	(bool->tv (model-express gesture-kind "gesture"
		(cog-name emo) (cog-name gest) #f perform-gesture)))

; model-show-expression-in-context EMO CONTEXT -- as
;    model-show-expression, but EMO is a class name (string) and
;    CONTEXT is a string describing the situation to the model.
;    Returns #t if an expression was shown, else #f (error logged).
(define-public (model-show-expression-in-context emo context)
	(model-express expression-kind "facial expression"
		emo #f context perform-expression))

; --------------------------------------------------------
; Show a facial expression from a given emotional class, with the
; intensity and duration chosen by the model.
;
; Example usage:
;    (cog-evaluate!
;        (PutLink (DefinedPredicateNode "Show class expression")
;           (ListLink (ConceptNode "positive") (ConceptNode "engaged"))))
;
(DefineLink
	(DefinedPredicateNode "Show class expression")
	(LambdaLink
		(VariableList (VariableNode "$emo") (VariableNode "$expr"))
		(TrueLink (EvaluationLink
			(GroundedPredicate "scm: model-show-class-expression")
			(ListLink (VariableNode "$emo") (VariableNode "$expr"))))
	))

; Show a gesture for a given emotional-expression class, with the
; intensity, repetition and speed chosen by the model.
;
; Example usage:
;    (cog-evaluate!
;        (PutLink (DefinedPredicateNode "Show class gesture")
;           (ListLink (ConceptNode "positive") (ConceptNode "nod-1"))))
;
(DefineLink
	(DefinedPredicateNode "Show class gesture")
	(LambdaLink
		(VariableList (VariableNode "$emo") (VariableNode "$gest"))
		(TrueLink (EvaluationLink
			(GroundedPredicate "scm: model-show-class-gesture")
			(ListLink (VariableNode "$emo") (VariableNode "$gest"))))
	))

;
; Ask the model to pick a facial expression out of the given
; emotional-expression class (and its strength and duration), and send
; it to the action orchestrator for display.
;
; Example usage:
;    (cog-evaluate!
;       (PutLink (DefinedPredicateNode "Show model expression")
;          (ConceptNode "positive")))
;
(DefineLink
	(DefinedPredicateNode "Show model expression")
	(LambdaLink
		(VariableNode "$emo")
		(TrueLink (EvaluationLink
			(GroundedPredicate "scm: model-show-expression")
			(ListLink (VariableNode "$emo"))))
	))

;; Like the above, but for gestures
(DefineLink
	(DefinedPredicate "Show model gesture")
	(LambdaLink
		(Variable "$emo")
		(TrueLink (EvaluationLink
			(GroundedPredicate "scm: model-show-gesture")
			(ListLink (Variable "$emo"))))
	))

; --------------------------------------------------------
; Show facial expressions and gestures suitable for a given emotional
; state, as chosen by the model.

(DefineLink
	(DefinedPredicateNode "Show positive expression")
	(PutLink (DefinedPredicateNode "Show model expression")
		(ConceptNode "positive")))

;; line 840 -- show_frustrated_expression()
(DefineLink
	(DefinedPredicateNode "Show frustrated expression")
	(PutLink (DefinedPredicateNode "Show model expression")
		(ConceptNode "frustrated")))

(DefineLink
	(DefinedPredicateNode "Show positive gesture")
	(PutLink (DefinedPredicateNode "Show model gesture")
		(ConceptNode "positive")))

;
; --------------------------------------------------------
;
; Spoken reactions.  Each reaction is a prompt template (see
; `eva-model/prompts.scm`), filled with the current situation; the
; model writes what Eva says, and it is then said.  On model failure
; nothing is said, the error is logged, and false is returned.

; Slot values describing what Eva currently perceives.
(define (situation-slots)
	(let* ((n (catch #t
				(lambda ()
					(inexact->exact (round (string->number (cog-name
						(cog-execute! (DefinedSchema "Num visible faces")))))))
				(lambda _ #f)))
			(hour (tm:hour (localtime (current-time)))))
		`((visible-faces .
			,(cond
				((not n) "")
				((= n 0) "You cannot see anyone in front of you.")
				((= n 1) "You can see one person in front of you.")
				(else (format #f "You can see ~a people in front of you." n))))
		  (time-of-day .
			,(cond ((< hour 5) "night") ((< hour 12) "morning")
				((< hour 18) "afternoon") (else "evening"))))))

(define (say-model-utterance where thunk)
	(catch #t
		(lambda ()
			(let ((utterance (thunk)))
				(cog-evaluate! (Put (DefinedPredicate "Say") (Node utterance)))
				(stv 1 1)))
		(lambda (key . args)
			(eva-model-log-error where key args)
			(stv 0 1))))

;
; model-say-template TEMPLATE -- TEMPLATE is a ConceptNode naming a
; prompt template (for example "loud-sound" or "greet-new-arrival").
; Ask the model what Eva says in that situation, and say it.
;
(define-public (model-say-template template)
	(say-model-utterance
		(string-append "spoken reaction: " (cog-name template))
		(lambda ()
			(eva-template-utterance (string->symbol (cog-name template))
				(situation-slots)))))

;
; model-say-reaction SITUATION -- ask the model what Eva says in the
; situation described by the name of the SITUATION atom, and say it.
;
(define-public (model-say-reaction situation)
	(say-model-utterance "spoken reaction"
		(lambda () (eva-model-utterance (cog-name situation)))))

;; ------------------------------------------------------------------
