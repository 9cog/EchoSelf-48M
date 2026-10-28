;
; llm.scm
;
; Language-model client for Eva.  Every character response -- spoken
; replies, spoken reactions, greetings, and the choice of facial
; expressions and gestures -- is produced by a model reached through
; this file.  The wording of each kind of response is described by a
; prompt template (see `prompts.scm`); the model writes the words.
;
; The model is any OpenAI-compatible "chat completions" endpoint: a
; hosted API or a model served on this machine.  It is resolved as
; follows (and the result is cached):
;
; 1. Explicit configuration:
;      ECHO_MODEL_BASE_URL  -- e.g. "https://api.openai.com/v1" or
;                              "http://127.0.0.1:11434/v1"
;      ECHO_MODEL_NAME      -- model name (optional: if unset, the
;                              first model listed by BASE_URL/models)
;      ECHO_MODEL_API_KEY   -- bearer token (optional)
;
; 2. Otherwise a LOCAL model server is discovered and verified: it must
;    answer and list at least one model (and list ECHO_MODEL_NAME, if
;    that is set).  Candidates, in order:
;      - each base URL in ECHO_MODEL_LOCAL_URLS (comma separated),
;        probed as OpenAI-compatible (URL/models, URL/v1/models) and as
;        Ollama (URL/api/tags);
;      - Ollama on 127.0.0.1:11434 (GET /api/tags);
;      - OpenAI-compatible servers on 127.0.0.1 ports 8080 (llama.cpp),
;        1234 (LM Studio), 8000 (vLLM; also EchoSelf's NanEcho
;        server.py), 5000 (text-generation-webui) and 8081 (EchoSelf's
;        NanEcho neserver.py) (GET /v1/models).
;    ECHO_MODEL_LOCAL_HOST overrides 127.0.0.1.
;
; 3. After a connection failure the cached endpoint is dropped and the
;    model is resolved again (once) before the request is retried.
;
; Other settings: ECHO_MODEL_TIMEOUT (request timeout, seconds, default
; 60), ECHO_MODEL_PROBE_TIMEOUT (discovery timeout, default 2).
;
; There is no fallback: if no model is configured or served locally,
; or the model returns an unusable reply, `eva-model-complete` throws
; 'eva-model-error with an explanation, and callers then produce no
; character output (they log the error with `eva-model-log-error`).
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

(define (env-value name)
	(let ((v (getenv name)))
		(and v (not (string-null? (string-trim-both v)))
			(string-trim-both v))))

(define (strip-slash url) (string-trim-right url #\/))

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

; --------------------------------------------------------
;
; http-call URL BODY API-KEY TIMEOUT -- run curl against URL; POST the
; JSON string BODY, or GET when BODY is #f.  Returns a pair
; (HTTP-CODE . RESPONSE-BODY).  If the server cannot be reached at all
; (curl fails), throws 'eva-model-unreachable with a message.
;
(define (http-call url body api-key timeout)
	(let ((body-file (and body (write-temp-file body)))
			(hdr-file (and api-key
				(write-temp-file
					(string-append "Authorization: Bearer " api-key "\n")))))
		(dynamic-wind
			(lambda () #t)
			(lambda ()
				(let* ((args (append
							(list "curl" "-s" "--max-time" timeout
								"--connect-timeout" timeout
								"-w" "\n%{http_code}")
							(if body
								(list "-X" "POST"
									"-H" "Content-Type: application/json"
									"--data-binary" (string-append "@" body-file))
								'())
							(if hdr-file (list "-H" (string-append "@" hdr-file)) '())
							(list url)))
						(pipe (apply open-pipe* OPEN_READ args))
						(out (get-string-all pipe))
						(status (status:exit-val (close-pipe pipe)))
						(nl (string-rindex out #\newline))
						(code (if nl (string->number (substring out (+ nl 1))) #f))
						(resp (if nl (substring out 0 nl) out)))
					(if (or (not (eqv? status 0)) (not code) (= code 0))
						(throw 'eva-model-unreachable
							(format #f "cannot reach ~a (curl exit status ~a)"
								url status)))
					(cons code resp)))
			(lambda ()
				(if body-file (false-if-exception (delete-file body-file)))
				(if hdr-file (false-if-exception (delete-file hdr-file)))))))

(define (json-ref obj . keys)
	(fold (lambda (k o)
			(cond
				((and (integer? k) (vector? o) (< k (vector-length o)))
					(vector-ref o k))
				((and (string? k) (list? o) (every pair? o) (assoc k o)) => cdr)
				(else #f)))
		obj keys))

(define (parse-json-or-false str)
	(catch #t (lambda () (json-string->scm str)) (lambda _ #f)))

; GET URL and parse the JSON reply.  Returns the parsed JSON, or #f
; if the server is unreachable, answers with a non-2xx status, or the
; body is not JSON.
(define (http-get-json url api-key timeout)
	(catch 'eva-model-unreachable
		(lambda ()
			(let ((r (http-call url #f api-key timeout)))
				(and (<= 200 (car r) 299) (parse-json-or-false (cdr r)))))
		(lambda _ #f)))

; --------------------------------------------------------
; Model discovery.

; Names of the models listed by an OpenAI-compatible BASE (GET
; BASE/models: {"data": [{"id": ...}, ...]}), or #f if BASE does not
; answer that way.
(define (openai-model-ids base api-key timeout)
	(let* ((obj (http-get-json (string-append base "/models") api-key timeout))
			(data (and obj (json-ref obj "data"))))
		(and (vector? data)
			(filter-map
				(lambda (m) (let ((id (json-ref m "id"))) (and (string? id) id)))
				(vector->list data)))))

; Names of the models pulled into an Ollama server at ROOT (GET
; ROOT/api/tags: {"models": [{"name": ...}, ...]}), or #f.
(define (ollama-model-names root timeout)
	(let* ((obj (http-get-json (string-append root "/api/tags") #f timeout))
			(models (and obj (json-ref obj "models"))))
		(and (vector? models)
			(filter-map
				(lambda (m)
					(let ((n (or (json-ref m "name") (json-ref m "model"))))
						(and (string? n) n)))
				(vector->list models)))))

; Pick the model to use from NAMES: the configured WANTED name if it
; is listed (Ollama's ":latest" tag may be omitted), else the first
; listed model when no name is configured.  #f if none fits.
(define (pick-model names wanted)
	(cond
		((or (not names) (null? names)) #f)
		((not wanted) (car names))
		((member wanted names) wanted)
		((member (string-append wanted ":latest") names) wanted)
		(else #f)))

; A candidate is (LABEL KIND URL): KIND is 'openai (URL is a base URL
; whose /models lists models) or 'ollama (URL is the server root).
(define (local-candidates)
	(let* ((host (or (env-value "ECHO_MODEL_LOCAL_HOST") "127.0.0.1"))
			(local (lambda (port) (format #f "http://~a:~a" host port)))
			(extra (let ((v (env-value "ECHO_MODEL_LOCAL_URLS")))
				(if v
					(filter (lambda (s) (not (string-null? s)))
						(map (lambda (s) (strip-slash (string-trim-both s)))
							(string-split v #\,)))
					'()))))
		(append
			(append-map
				(lambda (u)
					(let ((root (if (string-suffix? "/v1" u)
								(substring u 0 (- (string-length u) 3)) u)))
						(delete-duplicates
							(list
								(list u 'openai u)
								(list u 'openai (string-append root "/v1"))
								(list u 'ollama root)))))
				extra)
			(list (list "Ollama" 'ollama (local 11434)))
			(map (lambda (p)
					(list (format #f "OpenAI-compatible server on port ~a" (car p))
						'openai (string-append (local (car p)) "/v1")))
				'((8080) (1234) (8000) (5000) (8081))))))

; Probe one candidate.  Returns (values ENDPOINT NOTE): ENDPOINT is
; the resolved endpoint alist, or #f with NOTE explaining why the
; candidate was not verified (NOTE is #f when nothing answered).
(define (probe-candidate cand wanted timeout)
	(let* ((label (car cand)) (kind (cadr cand)) (url (caddr cand))
			(names (if (eq? kind 'ollama)
						(ollama-model-names url timeout)
						(openai-model-ids url #f timeout)))
			(base (if (eq? kind 'ollama) (string-append url "/v1") url))
			(model (pick-model names wanted)))
		(cond
			((not names) (values #f #f))
			((null? names)
				(values #f (format #f "~a at ~a answers but serves no model" label url)))
			((not model)
				(values #f (format #f "~a at ~a does not serve ECHO_MODEL_NAME=~a (it serves: ~a)"
					label url wanted (string-join names ", "))))
			(else
				(values
					`((base . ,base) (model . ,model) (api-key . #f)
					  (source . ,(format #f "local ~a at ~a" label url)))
					#f)))))

(define (discover-local-model wanted timeout)
	(let loop ((cands (local-candidates)) (notes '()))
		(if (null? cands)
			(model-error
				(string-append
					"no language model is available for Eva. "
					"Set ECHO_MODEL_BASE_URL (and optionally ECHO_MODEL_NAME, "
					"ECHO_MODEL_API_KEY) for a hosted or remote OpenAI-compatible "
					"API, or serve a model locally, e.g. `ollama serve` and "
					"`ollama pull <model>`, or a llama.cpp / LM Studio / vLLM / "
					"NanEcho server (extra local URLs: ECHO_MODEL_LOCAL_URLS).~a")
				(if (null? notes) " No local model server answered."
					(string-append " Local servers found but not usable: "
						(string-join (reverse notes) "; ") ".")))
			(call-with-values
				(lambda () (probe-candidate (car cands) wanted timeout))
				(lambda (ep note)
					(if ep ep
						(loop (cdr cands)
							(if (and note (not (member note notes)))
								(cons note notes) notes))))))))

(define (resolve-model-endpoint)
	(let ((base (env-value "ECHO_MODEL_BASE_URL"))
			(wanted (env-value "ECHO_MODEL_NAME"))
			(key (env-value "ECHO_MODEL_API_KEY"))
			(probe-timeout (or (env-value "ECHO_MODEL_PROBE_TIMEOUT") "2")))
		(if base
			(let* ((base (strip-slash base))
					(model (or wanted
						(let ((ids (openai-model-ids base key probe-timeout)))
							(cond
								((not ids)
									(model-error
										"ECHO_MODEL_NAME is not set and ~a/models did not list models"
										base))
								((null? ids)
									(model-error
										"ECHO_MODEL_NAME is not set and ~a/models lists no model"
										base))
								(else (car ids)))))))
				`((base . ,base) (model . ,model) (api-key . ,key)
				  (source . "ECHO_MODEL_BASE_URL")))
			(discover-local-model wanted probe-timeout))))

(define cached-endpoint #f)

;
; eva-model-endpoint -- the resolved model endpoint, an alist with
; keys base, model, api-key and source.  Throws 'eva-model-error if
; no model is available.
;
(define-public (eva-model-endpoint)
	(or cached-endpoint
		(let ((ep (resolve-model-endpoint)))
			(format (current-error-port) "[eva-model] using model ~a at ~a (~a)\n"
				(assq-ref ep 'model) (assq-ref ep 'base) (assq-ref ep 'source))
			(set! cached-endpoint ep)
			ep)))

; Forget the resolved endpoint; the next request resolves it again.
(define-public (eva-model-reset!) (set! cached-endpoint #f))

; --------------------------------------------------------

(define (chat-completion ep system-prompt user-prompt)
	(let* ((url (string-append (assq-ref ep 'base) "/chat/completions"))
			(timeout (or (env-value "ECHO_MODEL_TIMEOUT") "60"))
			(body (scm->json-string
				`(("model" . ,(assq-ref ep 'model))
				  ("stream" . #f)
				  ("messages" .
					#((("role" . "system") ("content" . ,system-prompt))
					  (("role" . "user") ("content" . ,user-prompt)))))))
			(r (http-call url body (assq-ref ep 'api-key) timeout))
			(code (car r)) (resp (cdr r)))
		(if (not (<= 200 code 299))
			(model-error "HTTP ~a from ~a: ~a" code url resp))
		(let* ((parsed (or (parse-json-or-false resp)
						(model-error "unparsable response: ~a" resp)))
				(text (json-ref parsed "choices" 0 "message" "content")))
			(if (and (string? text) (not (string-null? (string-trim-both text))))
				(string-trim-both text)
				(model-error "response has no message content: ~a" resp)))))

;
; eva-model-complete SYSTEM USER -- send a system prompt and a user
; prompt to the model; return the reply text (a string).
; Throws 'eva-model-error on any failure.
;
(define-public (eva-model-complete system-prompt user-prompt)
	(catch 'eva-model-unreachable
		(lambda ()
			(chat-completion (eva-model-endpoint) system-prompt user-prompt))
		(lambda (key msg)
			; The server went away: resolve the model again and retry once.
			(format (current-error-port) "[eva-model] ~a; resolving the model again\n" msg)
			(eva-model-reset!)
			(catch 'eva-model-unreachable
				(lambda ()
					(chat-completion (eva-model-endpoint) system-prompt user-prompt))
				(lambda (key msg)
					(eva-model-reset!)
					(model-error "~a" msg))))))

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
