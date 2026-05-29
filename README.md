# Braid Lens

Braid Lens is a Tampermonkey bridge for browser-based AI sessions that need a
local, user-approved filesystem window.

Current install target:

- Gemini: `install/gemini.user.js`

The bridge supports:

- `READ_FILE`: read a file inside the bound folder.
- `READ_FILE_CHUNK`: read a later chunk of a large file.
- `LIST_DIR`: list a directory inside the bound folder.
- `WRITE_FILE`: write only inside `QuAId/` under the bound folder.

The write rule is intentional. Browser AIs may draft freely inside `QuAId/`,
but they cannot overwrite source, Master Docs, Preservation, Cici, or any other
project file directly. A local operator reviews and moves accepted work.

## Install

1. Open Tampermonkey.
2. Create a new userscript.
3. Paste the contents of `install/gemini.user.js`.
4. Save it.
5. Open Gemini.
6. Click `Bind QuAId Directory`.
7. Choose the folder that contains or should contain `QuAId/`.

## Recommended Folder Shape

Inside the bound folder:

```text
QuAId/
  drafts/
  patches/
  outbox/
  tmp/
```

If these folders do not exist, `WRITE_FILE` can create them as needed.

## Trust Boundary

Braid Lens is not autonomous. It only acts when:

1. the user grants a folder handle through the browser picker, and
2. the AI emits a recognized command in the chat.

Read access comes from the selected bound folder. Write access is restricted to
`QuAId/`.

