# Domain Docs

How engineering skills should consume this repository's domain documentation.

## Project entry point

Start with `README.md`. It explains what textQuest is, how the game works, how to run it and how the main compatibility rules are understood.

Before exploring, also read these project documents:

- `ROADMAP.md` for planned and unfinished work.
- `CONTRIBUTING.md` for contribution, testing and pull request rules.
- `.github/copilot-instructions.md` for current repository-specific instructions.

For domain terms and decisions, read:

- `GLOSSARY.md` at the repository root, or `GLOSSARY-MAP.md` if it exists. A glossary map points to one `GLOSSARY.md` per context.
- `docs/adr/` for architecture decisions that touch the area being changed.
- In a multi-context repository, `src/<context>/docs/adr/` for context-specific decisions.

If these files do not exist, proceed silently. Do not create them upfront.

## File structure

Single-context repository:

```text
/
├── README.md
├── GLOSSARY.md
├── docs/
│   └── adr/
└── src/
```

Multi-context repository:

```text
/
├── README.md
├── GLOSSARY-MAP.md
├── docs/
│   └── adr/
└── src/
    ├── ordering/
    │   ├── GLOSSARY.md
    │   └── docs/
    │       └── adr/
    └── billing/
        ├── GLOSSARY.md
        └── docs/
            └── adr/
```

## Use the glossary's vocabulary

When output names a domain concept, use the term defined in `GLOSSARY.md`. Do not drift to synonyms the glossary explicitly avoids.

If a needed concept is absent, do not invent project language without checking. Record the gap for the `/domain-modeling` skill.

## Flag ADR conflicts

If a proposed change contradicts an existing ADR, surface the conflict explicitly instead of silently overriding it.
