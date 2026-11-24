import {
  createElement,
  forwardRef,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
} from 'react';
import type { CSSProperties } from 'react';
import {
  NobitaEditorElement,
  defineNobitaEditor,
  type ImageUploadHandler,
  type MentionProvider,
  type NobitaChangeDetail,
  type NobitaTheme,
} from '@nobita/element';
import type { Doc, EditorSelection } from '@nobita/core';

export interface NobitaReactHandle {
  readonly element: NobitaEditorElement | null;
  focus(): void;
  getDoc(): Doc | null;
  getMarkdown(): string;
  getJSON(): string;
  setDoc(doc: Doc | string): void;
  undo(): boolean;
  redo(): boolean;
}

export interface NobitaEditorProps {
  doc?: Doc | string;
  readonly?: boolean;
  theme?: NobitaTheme;
  placeholder?: string;
  minHeight?: string;
  className?: string;
  style?: CSSProperties;
  onChange?: (doc: Doc, meta: { source: string }) => void;
  onSelectionChange?: (selection: EditorSelection | null) => void;
  mentionProvider?: MentionProvider;
  uploadImage?: ImageUploadHandler;
}

/**
 * Thin React wrapper around `<nobita-editor>`. It intentionally keeps React
 * out of the editing path: React owns the host element, Nobita owns the DOM and
 * state inside its shadow root.
 */
export const NobitaEditor = forwardRef<NobitaReactHandle, NobitaEditorProps>(
  function NobitaEditor(props, ref) {
    const hostRef = useRef<NobitaEditorElement | null>(null);

    useLayoutEffect(() => {
      defineNobitaEditor();
    }, []);

    useLayoutEffect(() => {
      const element = hostRef.current;
      if (element && props.doc !== undefined) element.doc = props.doc;
    }, [props.doc]);

    useLayoutEffect(() => {
      const element = hostRef.current;
      if (!element) return;
      element.setTheme(props.theme ?? 'light');
    }, [props.theme]);

    useLayoutEffect(() => {
      const element = hostRef.current;
      if (!element) return;
      element.setReadonly(props.readonly ?? false);
    }, [props.readonly]);

    useLayoutEffect(() => {
      const element = hostRef.current;
      if (!element) return;
      element.mentionProvider = props.mentionProvider;
    }, [props.mentionProvider]);

    useLayoutEffect(() => {
      const element = hostRef.current;
      if (!element) return;
      element.uploadImage = props.uploadImage;
    }, [props.uploadImage]);

    useLayoutEffect(() => {
      const element = hostRef.current;
      if (!element) return;
      const handleChange = (event: Event): void => {
        const detail = (event as CustomEvent<NobitaChangeDetail>).detail;
        props.onChange?.(detail.doc, { source: detail.source });
      };
      const handleSelection = (event: Event): void => {
        const detail = (event as CustomEvent<{ selection: EditorSelection | null }>).detail;
        props.onSelectionChange?.(detail.selection);
      };
      element.addEventListener('nobita-change', handleChange);
      element.addEventListener('nobita-selection', handleSelection);
      return () => {
        element.removeEventListener('nobita-change', handleChange);
        element.removeEventListener('nobita-selection', handleSelection);
      };
    }, [props.onChange, props.onSelectionChange]);

    useImperativeHandle(
      ref,
      () => ({
        get element() {
          return hostRef.current;
        },
        focus: () => hostRef.current?.focus(),
        getDoc: () => hostRef.current?.doc ?? null,
        getMarkdown: () => hostRef.current?.getMarkdown() ?? '',
        getJSON: () => hostRef.current?.getJSON() ?? '',
        setDoc: (doc: Doc | string) => {
          if (hostRef.current) hostRef.current.doc = doc;
        },
        undo: () => hostRef.current?.undo() ?? false,
        redo: () => hostRef.current?.redo() ?? false,
      }),
      []
    );

    const style = {
      display: 'block',
      ...(props.minHeight ? { '--nb-min-height': props.minHeight } : {}),
      ...(props.style ?? {}),
    } as CSSProperties;

    return createElement('nobita-editor', {
      ref: hostRef,
      ...(props.className ? { class: props.className } : {}),
      ...(props.placeholder ? { placeholder: props.placeholder } : {}),
      style,
    });
  }
);
