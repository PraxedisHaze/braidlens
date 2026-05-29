# Braid Lens Safety Model

## Goal

Give browser-based AI sessions a useful local collaboration window without
giving them direct overwrite power over the workspace.

## Permissions

The browser controls filesystem access through the File System Access API.
Braid Lens cannot access files until the user clicks the bind button and selects
a folder.

## Read Policy

Reads may come from the selected bound folder. This is powerful. Sensitive
folders should be handled with care by the human operator and by the AI session.

## Write Policy

Writes are restricted to `QuAId/` inside the bound folder.

Allowed:

```text
QuAId/drafts/new-note.md
QuAId/patches/proposed-fix.diff
QuAId/outbox/summary.md
QuAId/tmp/scratch.txt
```

Blocked:

```text
../anything
/absolute/path
C:/absolute/path
MASTER DOCS/file.md
PRESERVATION/CODEX/file.md
Cici/source.py
```

## Audit Pattern

The AI writes drafts to `QuAId/`. A local operator reviews the draft and moves it
into the final project location if appropriate.

This preserves speed while preventing accidental or unauthorized mutation of
standing project files.

