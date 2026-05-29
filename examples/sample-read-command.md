# Sample Read Command

Paste into Gemini after binding the folder:

```text
[READ_FILE: README.md]
```

If the file is larger than the chunk limit, Gemini can request the next chunk:

```text
[READ_FILE_CHUNK: README.md | offset: 25000]
```

