# Resume upload generation regression

## Symptom

Creating a Resume document after uploading an existing resume left every workspace section blank.

## Production evidence

- Upload ingestion and recommendation completed successfully.
- The following `generate-document` request returned HTTP 400 before document generation began.
- Recent affected Resume outcomes contained approximately 23,000 characters of `conversation_context` and 7,600 characters of `upload_context`.
- The shared authentication guard capped every string at 20,000 characters even though the generation endpoint's documented context contract is 30,000 characters.
- The web flow copied the same extracted resume into upload context, the initial situation, and the conversation transcript, causing the request to cross the lower limit.

No uploaded document text was read during the production-data check; only status, template identifiers, and string lengths were inspected.

## Correction

- Preserve the existing 20,000-character default for ordinary request fields while allowing the two document context fields up to their explicit 30,000-character endpoint contract.
- Keep uploaded text in the dedicated upload context and pass it separately to intent interpretation instead of copying it into conversation context.
- Retain the complete extracted document in the upload record. The browser receives a bounded inline context excerpt plus the upload ID; generation reloads the complete extraction from the authenticated upload record instead of silently discarding text beyond the excerpt.
- Align the Resume information-contract section keys with the generation template (`summary` and `experience`) and include the missing `contact_details` fallback section.
- Remove the global first-person instruction that conflicted with the Resume profile's pronoun-free writing standard.

## Regression coverage

- A production-shaped 23,315-character conversation context plus 7,595-character upload context is accepted.
- Ordinary fields still reject payloads over 20,000 characters, and document context rejects payloads over 30,000 characters.
- The Home upload workflow persists extracted resume text in upload context without copying it into conversation context.
- A document longer than the inline context budget is retained in full, and generation carries its authenticated upload ID so the complete source can be reloaded server-side.
- Resume information-contract keys exactly match the resolved generation template.
- The assembled Resume prompt uses conventional pronoun-free resume voice.

## Release and rollback

The web and `generate-document` Edge Function changes must be released together. Before release, repeat the uploaded-resume workflow against the deployment and confirm that the stream emits populated sections. Roll back by reverting the change as one unit if generation requests or upload-backed intent interpretation regress.

PrompTED does not impose a product word-count limit on the uploaded or generated document. Bounded request excerpts and provider context windows remain technical transport constraints; they must not silently truncate the retained source.

Live end-to-end generation remains a deployment verification step; local checks do not call the production model provider or mutate customer outcomes.
