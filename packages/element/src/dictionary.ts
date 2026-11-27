import type { ja } from './locales/ja.js';

/** English UI messages are the stable keys. Omitted messages keep their English wording. */
export type NobitaDictionary = Readonly<Partial<Record<keyof typeof ja, string>>>;
export type Translate = (message: string, value?: string | number) => string;

export function createTranslator(dictionary?: NobitaDictionary): Translate {
  const messages: Readonly<Record<string, string | undefined>> | undefined =
    dictionary && Object.assign(Object.create(null), dictionary);
  return (key, value) => {
    const message = messages?.[key] ?? key;
    return value === undefined ? message : message.replace(/\{(?:name|count)\}/gu, () => String(value));
  };
}
