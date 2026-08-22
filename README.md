# Dastak

Hands-free home-visit protocol companion for India's ASHA community health workers.

## Why this exists on glasses

Her hands are holding a newborn. It cannot be a phone. This is not a website that fits on glasses — it only works because the glasses exist.

## Designed from the restrictions

No camera, no microphone, no notifications. In a stranger's home near a newborn, a device that cannot see or hear the family is the only version anyone would allow through the door. Nothing interrupts a clinical moment.

## The multiplier

Nobody in an Indian village buys these glasses. The wearer is not the beneficiary — she is the multiplier. ~1 million ASHA workers, ~1000 people each, equipment bought by the programme.

## Glanceability

One question per frame. No scrolling, no menus, no lists. D-pad and pinch only. Prior-visit flags surface unprompted so she never navigates to find them.

## Scope boundary

Dastak navigates a protocol; it does not practise medicine. No diagnosis, no dosage, no risk scoring. Zero network calls in the glasses app — verifiable: `grep glasses.html for fetch/XMLHttpRequest` returns nothing. AI runs only on the phone (route planning before the visit, supervisor pattern summary after) and never sees a health field.

## Platform compliance

600×600 fixed, overflow hidden, additive-display palette, 16px minimum type, 88px tap targets, focus-driven input (pinch fires Enter on `document.activeElement`), PNG icon, service worker offline shell.

> Lighthouse flags `user-scalable=no` and contrast — both are correct to ignore. The viewport tag is Meta's own spec, and contrast ratios do not apply to an additive waveguide where black renders transparent.

## Run locally

```
npm install && npm start
# http://localhost:3000/glasses.html
```

Or open `public/index.html` directly — no server required.

## Architecture

```
public/
  index.html / glasses.html   Single-file MRBD app (600×600), protocol inlined
  record.html                 Phone: completed visit record (reads URL fragment)
  plan.html                   Phone: AI day planner with confidence display
  review.html                 Phone: supervisor pattern summary
  sw.js                       Service worker: offline shell (dastak-v3)
  icon-96.png                 96×96 PNG favicon
api/
  plan.js                     Vercel serverless: /api/plan endpoint
```

## Privacy

- No camera, no microphone — enforced by the platform.
- No name, no phone number, no address. Households keyed by opaque ID.
- No identifying data ever reaches an AI call. Fields stripped server-side.
- Visit records live in the URL fragment and device storage. Never on our servers.
- `localStorage` cleared on sync confirmation.

## Carry-forward

When the worker reaches a step where the previous visit recorded a flag, Dastak shows one muted line beneath the question:

```
⟩ flagged at the Day 3 visit
```

Verbatim recall of her own previously recorded answer. No interpretation, no inference, no generation. A lookup in localStorage, not an AI call.
