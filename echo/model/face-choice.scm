;
; face-choice.scm
;
; Model-chosen gaze targets.  Who Eva looks at (which face to glance
; at, which face to interact with, where to look while searching an
; empty room) is a visible behavior of the character, so it is decided
; by the language model (see `llm.scm`), not by random choice.
;
; The candidates (face ids, and the configured gaze bounds) come from
; the self-model; the model's answer is validated against them.  If
; the model is not configured, unreachable, or gives an invalid answer,
; the error is logged and Eva looks at nobody new: the current gaze and
; interaction target are kept.
;
; When there is exactly one candidate face, there is nothing to
; choose, and that face is used directly (this was never random).
;
; --------------------------------------------------------

(use-modules (srfi srfi-1))

(define (face-number face) (string->number (cog-name face)))

(define (state-of anchor)
	(let ((st (cog-incoming-by-type anchor 'StateLink)))
		(if (null? st) #f (cog-outgoing-atom (car st) 1))))

(define (faces-of schema-name)
	(cog-outgoing-set (cog-execute! (DefinedSchema schema-name))))

; Short English description of a face, for the model.
(define (describe-face face role)
	(let ((eye (state-of eye-contact-state)))
		(format #f "- face_id ~a: ~a~a" (face-number face) role
			(if (and eye (equal? eye face))
				" (you are making eye contact with this person now)" ""))))

;
; model-pick-face PURPOSE CANDIDATES DESCRIBE -- ask the model which
; of the CANDIDATES (a list of NumberNode face ids) to look at.
; PURPOSE is a string explaining what the look is for; DESCRIBE maps a
; candidate to a one-line description.  Returns the chosen face atom,
; or #f (error logged) if there is nothing to pick or the model fails.
;
(define-public (model-pick-face purpose candidates describe)
	(cond
		((null? candidates) #f)
		((null? (cdr candidates)) (car candidates))
		(else
			(catch #t
				(lambda ()
					(let* ((prompt (string-append
								purpose
								"\nThe people you can see:\n"
								(string-join (map describe candidates) "\n")
								"\n\nAnswer with only a JSON object "
								"{\"face_id\": <one of the face_id values above>}."))
							(obj (eva-model-complete-json eva-persona prompt))
							(v (assoc-ref obj "face_id"))
							(n (cond ((real? v) v)
									((string? v) (string->number v))
									(else #f)))
							(pick (and n (find (lambda (f) (= n (face-number f)))
									candidates))))
						(if (not pick)
							(throw 'eva-model-error
								(format #f "model chose face_id ~s, not one of ~s"
									v (map face-number candidates))))
						pick))
				(lambda (key . args)
					(eva-model-log-error (string-append "choosing a face: " purpose)
						key args)
					#f)))))

(define (bool->tv b) (if b (stv 1 1) (stv 0 1)))

; --------------------------------------------------------
; Entry points for `(GroundedPredicate "scm: ...")`.

; Glance at some other acknowledged face (not the eye-contact face).
(define-public (model-glance-at-face)
	(let* ((eye (state-of eye-contact-state))
			(faces (remove (lambda (f) (and eye (equal? f eye)))
				(faces-of "Get acknowledged faces")))
			(pick (model-pick-face
				"You are talking with someone in a group. Choose another person to glance at briefly."
				faces (lambda (f) (describe-face f "in the group")))))
		(if pick
			(begin
				(State glance-state pick)
				(cog-evaluate! (Put (DefinedPredicate "glance and ack") pick))))
		(bool->tv pick)))

; Glance at one of the newly-arrived faces.
(define-public (model-glance-at-new-person)
	(let ((pick (model-pick-face
				"While you are interacting with someone, new people have arrived. Choose which newcomer to glance at."
				(faces-of "New arrivals")
				(lambda (f) (describe-face f "just arrived")))))
		(if pick
			(cog-evaluate! (Put (DefinedPredicate "glance and ack") pick)))
		(bool->tv pick)))

; Glance at the last known location of a face that left.
(define-public (model-glance-at-lost-face)
	(let ((pick (model-pick-face
				"Some people have just left. Choose whose last location to glance at."
				(faces-of "New departures")
				(lambda (f) (describe-face f "just left, no longer visible")))))
		(if pick
			(cog-evaluate! (Put (DefinedPredicate "glance at departure") pick)))
		(bool->tv pick)))

; Choose the (next) person to interact with, among acknowledged faces.
(define-public (model-change-interaction)
	(let ((pick (model-pick-face
				"It is time to choose who to interact with now (you may keep the current person)."
				(faces-of "Get acknowledged faces")
				(lambda (f) (describe-face f "present")))))
		(if pick
			(cog-evaluate! (Put (DefinedPredicate "Set interaction target") pick)))
		(bool->tv pick)))

; Start interacting with one of the newly-visible faces.
(define-public (model-interact-with-new-person)
	(let ((pick (model-pick-face
				"The room was empty and people have just arrived. Choose who to start interacting with."
				(faces-of "New arrivals")
				(lambda (f) (describe-face f "just arrived")))))
		(if pick
			(cog-evaluate! (Put (DefinedPredicate "Set interaction target") pick)))
		(bool->tv pick)))

; Start interacting with one of the recognized persons.
(define-public (model-interact-with-recognized-person)
	; Each entry of "Get recognized faces" is (List face-concept recog-id).
	(let* ((pairs (map (lambda (l) (cons (get-face-id (cog-outgoing-atom l 0))
					(cog-name (cog-outgoing-atom l 1))))
				(faces-of "Get recognized faces")))
			(pick (model-pick-face
				"You have recognized people you know. Choose who to interact with."
				(map car pairs)
				(lambda (f) (describe-face f
					(format #f "recognized as person ~s" (assoc-ref pairs f)))))))
		(if pick
			(cog-evaluate! (Put (DefinedPredicate "Set interaction target") pick)))
		(bool->tv pick)))

; --------------------------------------------------------
; Search for attention: the model picks the horizontal gaze direction,
; within the configured bounds (DefinedSchema "gaze right max" and
; "gaze left max").  On failure the current gaze is kept.

(define (defined-number name)
	(let ((d (cog-incoming-by-type (DefinedSchema name) 'DefineLink)))
		(and (pair? d) (string->number (cog-name (cog-outgoing-atom (car d) 1))))))

(define-public (model-search-gaze)
	(catch #t
		(lambda ()
			(let* ((right (defined-number "gaze right max"))
					(left (defined-number "gaze left max")))
				(if (not (and right left))
					(throw 'eva-model-error "gaze bounds are not configured"))
				(let* ((lo (min right left)) (hi (max right left))
						(obj (eva-model-complete-json eva-persona
							(format #f "Nobody is around and you are looking around the room for someone to interact with. Choose where to turn your head: a horizontal direction y between ~a (your far right) and ~a (your far left); 0 is straight ahead.\n\nAnswer with only a JSON object {\"y\": <number>}." right left)))
						(y (assoc-ref obj "y")))
					(if (not (real? y))
						(throw 'eva-model-error
							(format #f "model gave no numeric y: ~s" obj)))
					(cog-evaluate!
						(Evaluation (DefinedPredicate "Look at point")
							(ListLink (Number 1) (Number (max lo (min hi y))) (Number 0))))
					(stv 1 1))))
		(lambda (key . args)
			(eva-model-log-error "choosing search gaze" key args)
			(stv 0 1))))
