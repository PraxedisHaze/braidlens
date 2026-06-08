# Braid Lens Commands

Commands are written by the AI into the chat. The userscript detects them,
performs the local action, and posts a result back into the chat.

## Bind First

Click `Bind QuAId Directory` before issuing commands. Browser permission is lost
when the page refreshes.

## Read File

```text
[READ_FILE: path/to/file.md]
```

Reads from the currently bound folder. Large files are chunked.

## Read File Chunk

```text
[READ_FILE_CHUNK: path/to/file.md | offset: 25000]
```

Reads a later chunk of the same file.

## List Directory

```text
[LIST_DIR: path/to/folder]
```

Lists entries in a directory inside the bound folder. Use `.` for the bound
folder root.

## Write File

```text
[WRITE_FILE: QuAId/drafts/example.md]
File content goes here.
[/WRITE_FILE]
```

Writes are allowed only inside `QuAId/`. The script creates missing folders.

Forbidden examples:

```text
[WRITE_FILE: ../outside.md]
[WRITE_FILE: MASTER DOCS/something.md]
[WRITE_FILE: C:/Users/Praxillax/file.md]
```

## Append File

```text
[APPEND_FILE: QuAId/drafts/example.md]
Content to add to the end of the file goes here.
[/APPEND_FILE]
```

Adds content to the end of an existing file (creating it if missing) without
truncating what's already there. Same path rules as `WRITE_FILE`.

## Result Blocks

The bridge replies with blocks like:

```text
[FILE_CONTENTS: path | Offset: 0]
...
[/FILE_CONTENTS]
```

```text
[WRITE_RESULT: QuAId/drafts/example.md]
status: ok
bytes: 123
[/WRITE_RESULT]
```

These result blocks are stripped from future command parsing to prevent loops.

