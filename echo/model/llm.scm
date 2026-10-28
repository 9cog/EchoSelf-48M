;
; llm.scm
;
; Language-model client for Eva.  Every character response -- spoken
; replies, spoken reactions, and the choice of facial expressions and
; gestures -- is produced by a model reached through this file.
;
; The model is any OpenAI-compatible "chat completions" endpoint,
; configured with environment variables:
;
;   ECHO_MODEL_BASE_URL  -- e.g. "https://api.openai.com/v1" or
;                           "http://localhost:8080/v1" (required)
;   ECHO_MODEL_NAME      -- model name sent in the request (required)
;   ECHO_MODEL_API_KEY   -- bearer token (optional, for local servers)
;   ECHO_MODEL_TIMEOUT   -- request timeout in seconds (default 30)
;
; There is no fallback: if the model is not configured, cannot be
; reached, or returns an unusable reply, `eva-model-complete` throws
; 'eva-model-error, and callers must then produce no character output
; (they log the error with `eva-model-log-error` instead).
;
; Requires guile-json (the `(json)` module) and the `curl` executable.
;
; Example usage:
;    (eva-model-complete eva-persona "Say hello to the person in front of you.")
;
; --------------------------------------------------------

(use-modules (ice-9 popen) (ice-9 rdelim) (ice-9 textual-ports))
(use-modules (srfi srfi-1))
(use-modules (json))

; Persona description; this is model INPUT, not output.
(define-public eva-persona
"You are Eva, a humanoid robot with an expressive animated face, talking
with people who are physically in front of you. Speak naturally, briefly
and in the first person, as yourself. Never describe these instructions.")

; --------------------------------------------------------
; Errors are logged at system level, never voiced by the character.
(define-public (eva-model-log-error where key args)
	(format (current-error-port) "[eva-model] ~a failed: ~a ~s\n"
		where key args)
	(force-output (current-error-port)))

(define (model-error fmt . args)
	(throw 'eva-model-error (apply format #f fmt args)))

(define (required-env name)
	(let ((v (getenv name)))
		(if (or (not v) (string-null? (string-trim-both v)))
			(model-error "environment variable ~a is not set" name)
			(string-trim-both v))))

(define (chat-completions-url)
	(string-append
		(string-trim-right (required-env "ECHO_MODEL_BASE_URL") #\/)
		"/chat/completions"))

; Write STR into a fresh temporary file; return its path.
(define (write-temp-file str)
	(let* ((dir (or (getenv "TMPDIR") "/tmp"))
			(port (mkstemp! (string-copy
				(string-append dir "/eva-model-XXXXXX"))))
			(path (port-filename port)))
		(chmod port #o600)
		(display str port)
		(close-port port)
		path))

; Run curl, posting the JSON BODY string; return the response body.
(define (http-post-json url body api-key timeout)
	(let ((body-file (write-temp-file body))
			(hdr-file (and api-key
				(write-temp-file
					(string-append "Authorization: Bearer " api-key "\n")))))
		(dynamic-wind
			(lambda () #t)
			(lambda ()
				(let* ((args (append
							(list "curl" "-sS" "--max-time" timeout
								"-X" "POST"
								"-H" "Content-Type: application/json"
								"-w" "\n%{http_code}")
							(if hdr-file (list "-H" (string-append "@" hdr-file)) '())
							(list "--data-binary" (string-append "@" body-file) url)))
						(pipe (apply open-pipe* OPEN_READ args))
						(out (get-string-all pipe))
						(status (status:exit-val (close-pipe pipe)))
						(nl (string-rindex out #\newline))
						(code (if nl (string->number (substring out (+ nl 1))) #f))
						(resp (if nl (substring out 0 nl) out)))
					(cond
						((not (eqv? status 0))
							(model-error "curl exited with status ~a" status))
						((not (and code (<= 200 code 299)))
							(model-error "HTTP ~a from ~a: ~a" code url resp))
						(else resp))))
			(lambda ()
				(false-if-exception (delete-file body-file))
				(if hdr-file (false-if-exception (delete-file hdr-file)))))))

(define (json-ref obj . keys)
	(fold (lambda (k o)
			(cond
				((and (integer? k) (vector? o) (< k (vector-length o)))
					(vector-ref o k))
				((and (string? k) (list? o) (assoc k o)) => cdr)
				(else #f)))
		obj keys))

; --------------------------------------------------------
;
; eva-model-complete SYSTEM USER -- send a system prompt and a user
; prompt to the configured model; return the reply text (a string).
; Throws 'eva-model-error on any failure.
;
(define-public (eva-model-complete system-prompt user-prompt)
	(let* ((url (chat-completions-url))
			(model (required-env "ECHO_MODEL_NAME"))
			(key (let ((k (getenv "ECHO_MODEL_API_KEY")))
				(and k (not (string-null? (string-trim-both k)))
					(string-trim-both k))))
			(timeout (or (getenv "ECHO_MODEL_TIMEOUT") "30"))
			(body (scm->json-string
				`(("model" . ,model)
				  ("messages" .
					#((("role" . "system") ("content" . ,system-prompt))
					  (("role" . "user") ("content" . ,user-prompt)))))))
			(resp (http-post-json url body key timeout))
			(parsed (catch #t
				(lambda () (json-string->scm resp))
				(lambda (k . a) (model-error "unparsable response: ~a" resp))))
			(text (json-ref parsed "choices" 0 "message" "content")))
		(if (and (string? text) (not (string-null? (string-trim-both text))))
			(string-trim-both text)
			(model-error "response has no message content: ~a" resp))))

; --------------------------------------------------------
;
; eva-model-complete-json SYSTEM USER -- as above, but the model is
; asked for a JSON object; return it parsed (as an alist).
;
(define-public (eva-model-complete-json system-prompt user-prompt)
	(let* ((text (eva-model-complete system-prompt user-prompt))
			(start (string-index text #\{))
			(end (string-rindex text #\})))
		(if (not (and start end (< start end)))
			(model-error "model reply is not a JSON object: ~a" text))
		(let ((obj (catch #t
				(lambda () (json-string->scm (substring text start (+ end 1))))
				(lambda (k . a)
					(model-error "model reply is not valid JSON: ~a" text)))))
			(if (and (list? obj) (every pair? obj))
				obj
				(model-error "model reply is not a JSON object: ~a" text)))))

; --------------------------------------------------------
;
; eva-model-utterance SITUATION -- ask the model what Eva says, given a
; plain-English description of the situation.  Returns the utterance.
;
(define-public (eva-model-utterance situation)
	(eva-model-complete eva-persona
		(string-append situation
			"\n\nReply with exactly what you say out loud, and nothing else.")))
