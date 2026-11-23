let counter = 0;

const alphabet = '0123456789abcdefghijklmnopqrstuvwxyz';

function randomPart(length: number): string {
  let out = '';
  for (let index = 0; index < length; index += 1) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

/** Short, collision-resistant ids without a dependency. */
export function createId(prefix = 'b'): string {
  counter = (counter + 1) % 1296;
  return `${prefix}${Date.now().toString(36).slice(-5)}${counter.toString(36).padStart(2, '0')}${randomPart(4)}`;
}

export const createDocId = (): string => createId('d');
