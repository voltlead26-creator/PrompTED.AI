# Local Ollama credit fallback

OpenAI remains primary. For new operations accepting the fallback policy, one
local Ollama attempt is permitted only after a durably recorded OpenAI 402/429
credit rejection with code insufficient_quota or credit_balance_exhausted.
Rate limiting, bad credentials, ambiguous timeouts and tool-enabled research
do not select Ollama. Existing accepted operations keep their original policy.

The installed local model is gpt-oss:20b, pinned by its actual model digest.
Local inference was exercised without an Ollama API key. No cloud key or paid
Ollama service is configured. OpenAI credentials are never sent to Ollama.

## Saved local server settings

These settings are in the ignored supabase/.env.local, readable only by its
owner. Existing OpenAI settings were preserved. They belong on the backend,
not in apps/web/.env.local or any NEXT_PUBLIC variable.

```dotenv
PROMPTED_DEPLOYMENT_ENV=local
OLLAMA_CREDIT_FALLBACK_ENABLED=true
OLLAMA_BASE_URL=http://host.docker.internal:11434
OLLAMA_MODEL=gpt-oss:20b
OLLAMA_MODEL_DIGEST=17052f91a42e97930aa6e28a6c6c06a983e6a58dbb00434885a0cf5313e376f7
OLLAMA_CONFIGURATION_VERSION=ollama-local.1
OLLAMA_CONTEXT_TOKENS=32768
```

host.docker.internal addresses the Mac from local Supabase Docker workers. A
backend process running directly on the Mac uses http://127.0.0.1:11434 instead.
The Mac and Ollama must remain running. Changing the model/digest requires a
new configuration version and verification; accepted operations fail closed
if their pinned configuration is unavailable.

## Local activation prerequisites

The local database must include 20260907053000_ollama_credit_fallback.sql and
its preceding migrations. Existing capacity admission must also be configured;
fallback does not bypass admission, user deletion fences or request budgets.
The acceptance tests used a newly created disposable local database with
explicit synthetic capacity settings. They did not modify an existing stack.

A local Supabase Edge Functions service must load supabase/.env.local using its
--env-file option. The web app must separately target that same local Supabase
project with the local public URL/key. The current web dotenv still points to
the hosted project, so the running hosted app has not been switched to Ollama.
Do not reset an existing database to activate this feature.

## Failure, replay and deployment

Actual provider, model and token usage are stored per attempt. The upload review
UI shows when local Ollama classified a file. A persisted upload replay does
not call either model again. Malformed output, unavailable models and ambiguous
dispatch outcomes remain explicit failures or reconciliation states.

Disable selection for new operations by setting OLLAMA_CREDIT_FALLBACK_ENABLED
back to false and restarting the local service. Previously accepted fallback
operations then require their pinned configuration to resume; saved completed
upload responses remain replayable.

No hosted migration, function deployment, Netlify change, GitHub secret or
production activation occurred. Hosted activation is currently rejected in
code. A hosted rollout needs a separately authorised, backend-reachable and
authenticated Ollama endpoint, an explicitly reviewed hosted policy, measured
capacity/quality evidence, and the normal release gates. Never upload the local
server dotenv to GitHub or load it as production configuration.
