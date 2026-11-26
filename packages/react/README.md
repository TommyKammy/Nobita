# @nobita/react

A React wrapper around the Nobita web component. React manages the host and its props. Nobita renders the editable blocks inside the shadow root. The wrapper depends on `@nobita/core` and `@nobita/element`, and requires the host to supply React 18 or later.

## Use a controlled document

```tsx
import { useRef, useState } from 'react';
import { createDoc } from '@nobita/core';
import { NobitaEditor, type NobitaReactHandle } from '@nobita/react';

export function Notes() {
  const [doc, setDoc] = useState(() => createDoc({ title: 'Notes' }));
  const editor = useRef<NobitaReactHandle>(null);

  return (
    <>
      <button onClick={() => editor.current?.focus()}>Focus notes</button>
      <NobitaEditor ref={editor} doc={doc} onChange={setDoc} theme="auto" />
    </>
  );
}
```

`onChange(doc, { source })` receives the current document. The ref also exposes `getDoc()`, `getMarkdown()`, `undo()` and `redo()`. Use the `readonly` prop for a read-only view. See the [public API](../../docs/public-api.md) for the remaining props and handle methods.
