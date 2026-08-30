# Outcome API integrations

This workstream places external data behind Supabase Edge Functions so no provider credential is shipped to the browser or mobile bundle.

## Product placement and implementation order

1. **Adzuna** — Find a Role search and market data. PrompTED remains responsible for match scoring and explanations.
2. **Geoapify/OpenCage** — shared location normalisation for Find a Role, commute checks, nearby services and document addresses.
3. **OCR.Space fallback** — upload parsing only after native PDF/text extraction fails. Sensitive files require explicit external-processing consent.
4. **Nager.Date** — business-day and public-holiday calculations inside action plans and deadlines.
5. **Australian/Victorian government open data** — evidence gathering with source, authority, retrieval date and freshness metadata.
6. **Email validation** — final pre-send contact check, not identity verification.
7. **Document conversion** — export/package utility after native generation paths.
8. **Calendar** — action-plan deadlines and reminders.
9. **Electronic signature** — later completion workflow.

## Public transport placement

The PTV Timetable API belongs in the shared location/commute layer and is consumed by:

- Find a Role commute feasibility
- location-aware action plans
- interview and appointment travel planning
- live departure and disruption summaries

Implemented Edge Function: `transport-victoria`

Supported actions:

- `route-types`
- `search`
- `nearby`
- `departures`
- `disruptions`

## Required Supabase secrets

```text
PTV_DEVELOPER_ID
PTV_TIMETABLE_KEY
```

Never add their values to `.env.example`, Netlify browser variables, source files, test fixtures or PR descriptions.

## Client contract

Call the Edge Function with an authenticated Supabase session:

```ts
const { data, error } = await supabase.functions.invoke("transport-victoria", {
  body: {
    action: "departures",
    routeType: 0,
    stopId: 1071,
    maxResults: 10,
  },
});
```

The UI should translate provider failures into a neutral fallback and must not expose raw upstream errors or credentials.

## Deployment gate

Before enabling the transport feature:

1. Set both secrets in the production Supabase project.
2. Run the PTV signing unit tests.
3. Run `deno check` on the new function and shared client.
4. Deploy `transport-victoria`.
5. Smoke-test search, nearby stops, departures and disruptions with real Victorian locations.
6. Add rate limiting and cache short-lived read requests before broad public launch.
