# ScraperDesks — Turn Any Website Into Clean Leads

## Mission

Create implementation-ready, token-driven UI guidance for ScraperDesks — Turn Any Website Into Clean Leads that is optimized for consistency, accessibility, and fast delivery across marketing site.

## Brand

- Product/brand: ScraperDesks — Turn Any Website Into Clean Leads
- URL: https://scraperdesks.com/
- Audience: buyers, teams, and decision-makers
- Product surface: marketing site

## Style Foundations

- Visual style: structured, tokenized, content-first
- Main font style: `font.family.primary=Hanken Grotesk`, `font.family.stack=Hanken Grotesk, sans-serif`, `font.size.base=14.5px`, `font.weight.base=400`, `font.lineHeight.base=21.75px`
- Typography scale: `font.size.xs=12px`, `font.size.sm=12.5px`, `font.size.md=13px`, `font.size.lg=13.33px`, `font.size.xl=13.5px`, `font.size.2xl=14px`, `font.size.3xl=14.5px`, `font.size.4xl=15px`
- Color palette: `color.text.primary=#f2f5f1`, `color.text.secondary=#8e9892`, `color.text.tertiary=#f8fafc`, `color.text.inverse=#e2e8f0`, `color.surface.base=#000000`, `color.surface.muted=#111616`, `color.surface.raised=#c8ff2e`, `color.surface.strong=#14181a`, `color.border.strong=rgb(242, 245, 241) rgb(242, 245, 241) rgb(38, 44, 48)`
- Spacing scale: `space.1=4px`, `space.2=6px`, `space.3=7px`, `space.4=8px`, `space.5=9px`, `space.6=10px`, `space.7=11px`, `space.8=12px`
- Radius/shadow/motion tokens: `radius.xs=8px`, `radius.sm=9px`, `radius.md=10px`, `radius.lg=14px` | `shadow.1=rgba(200, 255, 46, 0.08) 0px 0px 0px 1px inset, rgba(200, 255, 46, 0.05) 0px 0px 18px 0px`, `shadow.2=rgba(200, 255, 46, 0) 0px 0px 0px 0px` | `motion.duration.instant=150ms`, `motion.duration.fast=180ms`, `motion.duration.normal=200ms`, `motion.duration.slow=700ms`

## Accessibility

- Target: WCAG 2.2 AA
- Keyboard-first interactions required.
- Focus-visible rules required.
- Contrast constraints required.

## Writing Tone

Concise, confident, implementation-focused.

## Rules: Do

- Use semantic tokens, not raw hex values, in component guidance.
- Every component must define states for default, hover, focus-visible, active, disabled, loading, and error.
- Component behavior should specify responsive and edge-case handling.
- Interactive components must document keyboard, pointer, and touch behavior.
- Accessibility acceptance criteria must be testable in implementation.

## Rules: Don't

- Do not allow low-contrast text or hidden focus indicators.
- Do not introduce one-off spacing or typography exceptions.
- Do not use ambiguous labels or non-descriptive actions.
- Do not ship component guidance without explicit state rules.

## Guideline Authoring Workflow

1. Restate design intent in one sentence.
2. Define foundations and semantic tokens.
3. Define component anatomy, variants, interactions, and state behavior.
4. Add accessibility acceptance criteria with pass/fail checks.
5. Add anti-patterns, migration notes, and edge-case handling.
6. End with a QA checklist.

## Required Output Structure

- Context and goals.
- Design tokens and foundations.
- Component-level rules (anatomy, variants, states, responsive behavior).
- Accessibility requirements and testable acceptance criteria.
- Content and tone standards with examples.
- Anti-patterns and prohibited implementations.
- QA checklist.

## Component Rule Expectations

- Include keyboard, pointer, and touch behavior.
- Include spacing and typography token requirements.
- Include long-content, overflow, and empty-state handling.
- Include known page component density: buttons (48), links (21), cards (9), lists (9), inputs (3), navigation (2), tables (1).

## Quality Gates

- Every non-negotiable rule must use "must".
- Every recommendation should use "should".
- Every accessibility rule must be testable in implementation.
- Teams should prefer system consistency over local visual exceptions.
