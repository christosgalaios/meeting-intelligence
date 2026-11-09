# Claude Design brief: Meeting Intelligence (v1, 2026-11-04)

Design a desktop-first web app called **Meeting Intelligence**. People upload meeting transcripts (text with speaker labels and timestamps) and ask questions about what was discussed, decided and assigned. Every answer cites the exact moment in the meeting, and the user can click straight to it. This is a take-home for a senior full-stack role, so it must look like a calm, credible product, not a template or a chatbot demo.

Use a fresh, neutral design system. Do not use any existing brand or the Socialise design system. Define colours, type, spacing and radii as tokens, with light and dark themes.

## Taste references (patterns, not pixels)
- Granola: quiet, editorial meeting notes; typography doing the work.
- Linear: density, keyboard feel, restrained colour, crisp states.
- Fathom / Otter: transcript with speaker colour, clickable timestamps.
- Perplexity: answers with inline numbered sources you can open.

## Screens
1. **Library (home).** Upload area (drag a .txt file or paste text). Meeting cards: title, date, duration, speakers (avatars or initials), counts of decisions and action items. A search/ask bar across all meetings sits at the top.
2. **Ask workspace (the hero screen).** Left: the conversation. Answers stream in and carry inline citation chips like `12:04 · Priya` that link to the source turn. Right: the transcript panel. Clicking a chip scrolls to that turn and highlights it. A scope picker chooses which meetings to search (all, or selected ones).
3. **"Why this answer" panel.** Opens from any answer. Shows the retrieved transcript chunks in rank order, each with its score split into semantic and keyword parts, plus tokens used, latency and estimated cost. This shows the RAG pipeline is transparent; make it feel like a developer tool, not an afterthought.
4. **Meeting detail.** Summary card at the top: decisions, and action items with owner, due date and a link to the source timestamp. Talk-time per speaker as a simple bar. The full transcript below, with speaker colour and timestamps.

## States to design (as important as the happy path)
- **Retrieval-only mode** (no API key): a clear but calm banner, e.g. "Showing the best-matching moments. Add your own Anthropic key for written answers." Answers show ranked transcript moments instead of prose.
- **Thinking**: a short pause before streaming starts.
- **Refusal**: "This wasn't discussed in these meetings", with the closest moments offered.
- **Empty library**, with a "load sample meetings" action.
- **Upload error**: which lines could not be parsed and why.
- **Extraction needs a key**: the decisions and action-items card in a locked state.
- **Cost hint** on the ask button (for example "~$0.03"), because every AI call is user-triggered and costs money.

## Constraints
- Desktop first (1440 wide), must still work at tablet width.
- Accessible: WCAG AA contrast, visible focus, keyboard navigable.
- Built with React + Tailwind, styled through CSS variables, so keep components simple and reusable: buttons, chips, cards, panels, banner, input, tabs.
- Give two distinct visual directions for the Ask workspace, then apply the stronger one to the other screens.
