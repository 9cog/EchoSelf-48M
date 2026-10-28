;
; prompts.scm
;
; Prompt templates for everything Eva says.
;
; Eva used to answer with fixed lines ("You made a Declarative
; SpeechAct", "Sorry I didn't understand the question.", "I don't know
; how to do that.", "whoa!", ...).  Those reply structures are kept
; here, one per situation, but each entry is now a PROMPT TEMPLATE: it
; tells the language model (see `llm.scm`) what the line is for, with
; slots such as {user}, {utterance}, {facts} or {actions} filled from
; what actually happened.  The model's reply is what Eva says.
;
; The language-analysis code (speech-act detection, self-model queries,
; imperative grounding) acts as a router that picks the template and
; fills its slots; the words always come from the model.
;
; Example:
;    (eva-template-utterance 'declarative
;        '((user . "Alice") (utterance . "It is raining outside")))
;
; --------------------------------------------------------

(use-modules (srfi srfi-1))

; What Eva can physically do; model INPUT, used to explain failures.
(define-public eva-capabilities
"look or turn left, right, up or down; look at a person; show facial
expressions (such as happy, sad, surprised, amused, afraid, bored,
irritated, comprehending); make gestures (such as nod, shake, blink,
yawn)")

(define-public eva-prompt-templates
`(
	; ---- Replies to what someone said, by speech-act type ----

	; Yes/no question.  Old line: "You asked a Truth Query ...
	; I can't process truth query for now".
	(truth-query .
"{user} asks you a yes/no question: \"{utterance}\"
You have no grounded facts that settle whether it is true. Answer
honestly in your own words: say what you can, and that you cannot
confirm the rest.")

	; Wh-question answered from the self-model.
	(interrogative-answered .
"{user} asks you: \"{utterance}\"
Facts from your own self-model that answer it:
{facts}
Answer the question using these facts, in the first person.")

	; Wh-question with no answer.  Old line: "Sorry I didn't
	; understand the question."
	(interrogative-not-understood .
"{user} asks you: \"{utterance}\"
You looked in your self-model and found nothing that answers this
question ({reason}). Tell them, in character, that you did not
understand or cannot answer it, and invite them to rephrase or ask you
something about yourself.")

	; Statement.  Old line: "You made a Declarative SpeechAct".
	(declarative .
"{user} tells you: \"{utterance}\"
Acknowledge what they said and respond naturally, as in a
conversation.")

	; Command that was carried out.
	(imperative-performed .
"{user} asks you: \"{utterance}\"
You understood it as a command and have just performed these actions:
{actions}
Say briefly, in your own words, what you are doing.")

	; Command that could not be carried out.  Old line: "I don't know
	; how to do that."
	(imperative-cannot-do .
"{user} asks you: \"{utterance}\"
You understood it as a command, but you could not do it: {reason}.
Explain in character that you don't know how to do that. The things
you can do are: {capabilities}.")

	; Unidentified speech act.  Old line: "Sorry, I can't identify the
	; speech act type".
	(unknown-speech-act .
"{user} says to you: \"{utterance}\"
You could not tell whether this was a question, a statement or a
request. Respond in character and ask them what they meant.")

	; ---- Behaviour-tree reactions ----

	; Loud sound.  Old line: "whoa!".
	(loud-sound .
"You just heard a sudden, very loud sound. {visible-faces}
React out loud the way you spontaneously would: a short exclamation.")

	; A person arrives in a room that was empty.
	(greet-new-arrival .
"A person has just come into view; until now nobody was in front of
you. {visible-faces} It is {time-of-day}. Greet them out loud, briefly
and warmly.")
))

; --------------------------------------------------------
;
; eva-fill-template TEMPLATE SLOTS -- replace every {name} in the
; string TEMPLATE with the value of name in the alist SLOTS (keys are
; symbols; values are strings or anything `display`able).  An unknown
; slot is an error: a template is never sent half-filled.
;
(define-public (eva-fill-template template slots)
	(let loop ((pos 0) (acc '()))
		(let ((open (string-index template #\{ pos)))
			(if (not open)
				(string-concatenate-reverse acc (substring template pos))
				(let* ((close (or (string-index template #\} open)
							(throw 'eva-model-error
								(format #f "unterminated slot in template: ~a" template))))
						(name (string->symbol (substring template (+ open 1) close)))
						(val (assq name slots)))
					(if (not val)
						(throw 'eva-model-error
							(format #f "template slot {~a} has no value" name)))
					(loop (+ close 1)
						(cons (if (string? (cdr val)) (cdr val)
								(format #f "~a" (cdr val)))
							(cons (substring template pos open) acc))))))))

(define-public (eva-prompt-template name)
	(or (assq-ref eva-prompt-templates name)
		(throw 'eva-model-error (format #f "no prompt template named ~a" name))))

;
; eva-template-utterance NAME SLOTS -- fill the prompt template NAME
; with SLOTS (plus `capabilities`), ask the model, and return what Eva
; says.  Throws 'eva-model-error on failure.
;
(define-public (eva-template-utterance name slots)
	(eva-model-utterance
		(eva-fill-template (eva-prompt-template name)
			(append slots `((capabilities . ,eva-capabilities))))))
