# Claude Braid Lens bridge examples

This is a real fixture under applings/BraidLens/examples/ inside the bound apps folder.
The tags below are examples for Claude to emit; they are not executed merely because they appear in this document.

## Start at the root

~~~text
[LIST_DIR:]
~~~

The empty path after the colon means the selected folder itself. Do not write [LIST_DIR: .].

## Read from the root

~~~text
[READ_FILE: README.md]
~~~

## Read a nested file

~~~text
[READ_FILE: PRESERVATION/Timothy/Idioms of the Aletheari Anothen.md]
~~~

## Write, then append

~~~text
[WRITE_FILE: applings/BraidLens/examples/claude-bridge-test.md]
Hello from Claude through Braid Lens.
[/WRITE_FILE]
~~~

~~~text
[APPEND_FILE: applings/BraidLens/examples/claude-bridge-test.md]
Second line.
[/APPEND_FILE]
~~~

## The period

A single period is reserved for the optional five-minute boop. It is not a path, not a root-listing command, and not a replacement for [LIST_DIR:].