;
; imperative.scm
;
; Scaffolding for converting English-language imperatives into
; robot actions.  This implements the full end-to-end pipeline,
; of converting English sentences to an intermediate form, matching
; the intermediate form to a grounded-knowledge base, and then
; performing the resulting action, if any.
;
; This handles imperative sentences, such as:
;
;     Eva, look to the right.
;     Look up!
;     Eva, turn to the right.
;     turn left
;     Look down.
;     look straight ahead
;     turn forward
;
;  ("looking" makes here move her eyes only; turning turns he whole head).
;
;     Smile!
;     frown
;     Look sad
;     Look happy
;     Look surprised
;     Look bored
;     Eva, express boredom
;     Eva, show happiness!
;
;
; This is a hard-coded, ad-hoc pipeline. Subject to change.
;

(use-modules (opencog) (opencog exec))

;--------------------------------------------------------------------
; State and state anchors. These should be thought of as work-arounds,
; to be replaced when a fine-tuned attention-allocation system is
; working.  The anchors serve to define the center of what the
; system is supposed to be "thinking about", right now -- the current
; sentence, the current action to be taken.

; Current action to be taken
(define current-action (AnchorNode "*-action-*"))
(StateLink current-action (WordNode "foobar"))

;--------------------------------------------------------------------
; Action schema
; This is temporary scaffolding, it simply returns the list
; of actions that were requested, and need to be performed.

; action-rule-ao uses the Action Orchestrator (in orchestrate.scm)
(define action-rule-ao
	(BindLink
		(VariableList
			(TypedVariable
				(Variable "$action")
				(Signature
					(EvaluationLink
						(Type "DefinedPredicateNode")
						(TypeChoice
						   (Type "ListLink") (Type "SetLink")
						   (Type "ConceptNode")))))
		)
		(AndLink
			(ListLink current-action (Variable "$action"))
		)
		; (StateLink current-action (Variable "$action"))
		(Variable "$action")
))

;--------------------------------------------------------------------
; Main, top-level imperative processing function.
;
; Stove-pipe hack to perform an action associated with an imperative.
; Its a "stove-pipe", because it hard-codes a sequence of steps that
; are performed every time an imperative command is received. A better
; design would be to replace the sequence of bind-links, below, by
; open-psi rules (and/or the forward chainer).  For now, the stove-pipe
; is OK, because there are so few rules that are used.
;
; Why the most recent imperative performed no action (a string), or #f.
; `grounded-talk` puts this into the "imperative-cannot-do" prompt
; template, so the model can explain in character what went wrong.
(define imperative-failure #f)
(define-public (imperative-failure-reason) imperative-failure)

(define-public (imperative-process imp)
"
  Process imperative IMP, which should be a SentenceNode.
  Returns the list of actions that were performed, as strings (possibly
  empty).  When it is empty, `(imperative-failure-reason)` says why.
  No reply is generated here; the caller asks the model for one.
"
	(define do-dbg-prt #t)
	(define performed '())
	(set! imperative-failure #f)

	; Make the current sentence visible to everyone.
	(StateLink current-sentence imp)

	; Apply rules that analyze sentences -- if the current sentence
	; is an imperative of some sort, it will pick it apart into a
	; simplfied form, and glue the simplified form to an anchor.
	(cog-execute! look-rule-1)
	(cog-execute! look-rule-2)
	(cog-execute! single-word-express-rule)
	(cog-execute! single-word-gesture-rule)
	(cog-execute! show-rule-1)
	(cog-execute! show-rule-2)
	(cog-execute! demo-rule)

	(if do-dbg-prt (begin
		(display "The current-imperative is\n")
		(display (cog-execute! (Get (State current-imperative (Variable "$x")))))
	))

	; Apply semantics-rule-1 -- if the current-imperative
	; anchor is a word we understand in a physical grounded
	; sense, then attach that sense to the current-action anchor.
	(cog-execute! obj-semantics-rule-1-ao)

	(if do-dbg-prt (begin
		(display "The current-action is\n")
		(display (cog-execute! (Get (List current-action (Variable "$x")))))
	))

	(cog-execute! obj-semantic-model-rule-1)
	(cog-execute! obj-semantic-model-rule-2)

	; Perform the action.
	(let* ((act-do-do (cog-execute! action-rule-ao))
			(action-list (cog-outgoing-set act-do-do))
		)
		(if do-dbg-prt (begin
			(display "The set of actions to be performed are:\n")
			(display act-do-do) (newline)
		))

		; Evaluate can throw if we give it bad args. Which happens during
		; development. So report any errors.
		(catch #t
			(lambda ()
				(for-each cog-evaluate! action-list)
				; Record what was actually done (as text, for the model).
				(set! performed
					(map (lambda (a) (format #f "~a" a)) action-list)))
			(lambda (key . args)
				(set! imperative-failure
					(format #f "the action failed while being performed (~a: ~s)"
						key args))
				(display "Exception: ") (display key) (newline)
				(display args) (newline)
				(display "Bad eval: ") (display act-do-do) (newline)))

		; At this time, a ListLink is used to anchor suggested
		; actions to the current-action anchor. Wipe these out.
		; (because we have already performed the actions).
		; XXX FIXME we need a better way of marking actions as having
		; been performed, already.
		(for-each (lambda (x)
			(cog-extract-recursive! (ListLink current-action x)))
				action-list)

		(if (null? action-list)
			(begin
				(set! imperative-failure
					"none of the words matched an action you know how to perform")
				(State (Anchor "Chatbot: ChatbotEvaAction")
					(Concept "Chatbot: NoResult"))))

		(State (Anchor "Chatbot: ChatbotEva")
			(Concept "Chatbot: ProcessFinished"))
	)

	; Reset the current-imperative state, as otherwise, any subsequent
	; nonsense will get re-interpreted as the same action as before.
	(StateLink current-imperative (WordNode "foobar"))
	(StateLink current-action (WordNode "foobar"))

	performed
)

;--------------------------------------------------------------------
