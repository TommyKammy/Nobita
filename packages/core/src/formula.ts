// Expressions are parsed as data; only the operators and functions below are executable.
type Scalar = number | string | boolean | null;
export type FormulaValue = Scalar | FormulaValue[];
type Node = {
  op: string;
  args: Node[];
  value?: Scalar;
  start: number;
  end: number;
  depth: number;
};
const compiled = new Map<string, Node>();
const precedence = ['||', '&&', '== !=', '< <= > >=', '+ -', '* / %'];
const levels = new Map(
  precedence.flatMap((group, i) =>
    group.split(' ').map((op) => [op, i + 1] as const)
  )
);

function fail(code: string): never {
  throw new Error('#' + code);
}

function compile(source: string): Node {
  const cached = compiled.get(source);
  if (cached) return cached;
  if (source.length > 2000) fail('LIMIT');
  const tokens =
    /\s+|"(?:\\.|[^"\\])*"|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|[a-zA-Z_]\w*|&&|\|\||[!=<>]=|./gy;
  let token = '',
    start = 0,
    end = 0;
  const advance = () => {
    let match: RegExpExecArray | null;
    do {
      match = tokens.exec(source);
    } while (match && /^\s/.test(match[0]));
    token = match?.[0] ?? '';
    start = match?.index ?? source.length;
    end = start + token.length;
  };
  const take = (expected: string) => {
    if (token !== expected) return false;
    advance();
    return true;
  };
  const parse = (min: number, nesting: number): Node => {
    if (nesting > 32) fail('LIMIT');
    const begin = start;
    const node = (
      op: string,
      args: Node[],
      value?: Scalar,
      stop = start
    ): Node => {
      const depth = 1 + args.reduce((n, arg) => Math.max(n, arg.depth), 0);
      if (depth > 32) fail('LIMIT');
      return {
        op,
        args,
        start: begin,
        end: stop,
        depth,
        ...(value !== undefined ? { value } : {}),
      };
    };
    let left: Node;
    if (take('(')) {
      left = parse(0, nesting + 1);
      if (!take(')')) fail('SYNTAX');
    } else {
      const word = token,
        stop = end;
      advance();
      if (['!', '-', '+'].includes(word))
        left = node('unary' + word, [parse(7, nesting + 1)]);
      else if (word.startsWith('"'))
        left = node('literal', [], JSON.parse(word) as string, stop);
      else if (/^(?:\d|\.\d)/.test(word))
        left = node('literal', [], Number(word), stop);
      else if (['true', 'false', 'null'].includes(word))
        left = node(
          'literal',
          [],
          word === 'null' ? null : word === 'true',
          stop
        );
      else if (/^[a-zA-Z_]/.test(word) && take('(')) {
        const args: Node[] = [];
        if (!take(')')) {
          do {
            args.push(parse(0, nesting + 1));
          } while (take(','));
          if (!take(')')) fail('SYNTAX');
        }
        if (word === 'literal' || word.startsWith('unary')) fail('SYNTAX');
        if (
          word === 'prop' &&
          (args.length !== 1 || typeof args[0]?.value !== 'string')
        )
          fail('SYNTAX');
        if (
          word === 'pluck' &&
          (args.length !== 2 ||
            args[0]?.op !== 'prop' ||
            typeof args[1]?.value !== 'string')
        )
          fail('SYNTAX');
        left = node(word, args);
      } else return fail('SYNTAX');
    }
    while ((levels.get(token) ?? -1) >= min) {
      const op = token;
      advance();
      left = node(op, [left, parse(levels.get(op)! + 1, nesting + 1)]);
    }
    if (min === 0 && take('?')) {
      const yes = parse(0, nesting + 1);
      if (!take(':')) fail('SYNTAX');
      left = node('if', [left, yes, parse(0, nesting + 1)]);
    }
    return left;
  };
  advance();
  const root = parse(0, 0);
  if (token) fail('SYNTAX');
  if (compiled.size >= 256) compiled.delete(compiled.keys().next().value!);
  compiled.set(source, root);
  return root;
}

/** Rewrite only parsed property-reference literals, retaining spelling and whitespace elsewhere. */
export function mapFormulaReferences(
  source: string,
  map: (key: string, relation?: string) => string
): string {
  const edits: { start: number; end: number; value: string }[] = [];
  const visit = (node: Node) => {
    const prop = node.args[0];
    const literal =
      node.op === 'prop'
        ? prop
        : node.op === 'pluck' && prop?.op === 'prop'
          ? node.args[1]
          : undefined;
    if (literal?.op === 'literal' && typeof literal.value === 'string') {
      const value = map(
        literal.value,
        node.op === 'pluck' ? String(prop?.args[0]?.value) : undefined
      );
      if (value !== literal.value)
        edits.push({ ...literal, value: JSON.stringify(value) });
    }
    node.args.forEach(visit);
  };
  try {
    visit(compile(source));
  } catch {
    return source;
  }
  for (const edit of edits.sort((a, b) => b.start - a.start))
    source = source.slice(0, edit.start) + edit.value + source.slice(edit.end);
  return source;
}

const num = (v: FormulaValue | undefined) => {
  if (v === undefined || Array.isArray(v) || !Number.isFinite(Number(v)))
    fail('TYPE');
  return Number(v);
};
const str = (v: FormulaValue | undefined) => (v == null ? '' : String(v));
function isoDate(value: number) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) fail('TYPE');
  return date.toISOString();
}
const day = 86400000;
function unit(v: FormulaValue | undefined) {
  switch (v ?? 'days') {
    case 'days':
      return day;
    case 'hours':
      return 3600000;
    case 'minutes':
      return 60000;
    case 'seconds':
      return 1000;
    default:
      return fail('TYPE');
  }
}
function apply(op: string, args: FormulaValue[], now: number): FormulaValue {
  const [a, b, c] = args;
  switch (op) {
    case 'unary!':
    case 'not':
      return !a;
    case 'unary-':
      return -num(a);
    case 'unary+':
    case 'toNumber':
      return num(a);
    case '+':
      return typeof a === 'string' || typeof b === 'string'
        ? str(a) + str(b)
        : num(a) + num(b);
    case '-':
      return num(a) - num(b);
    case '*':
      return num(a) * num(b);
    case '/':
    case '%':
      if (num(b) === 0) fail('DIV0');
      return op === '/' ? num(a) / num(b) : num(a) % num(b);
    case '==':
      return a === b;
    case '!=':
      return a !== b;
    case '>':
    case '<':
    case '>=':
    case '<=': {
      const x = typeof a === 'number' ? a : str(a),
        y = typeof b === 'number' ? b : str(b);
      return op === '>'
        ? x > y
        : op === '<'
          ? x < y
          : op === '>='
            ? x >= y
            : x <= y;
    }
    case 'empty':
      return a == null || a === '' || (Array.isArray(a) && !a.length);
    case 'round':
      return Math.round(num(a));
    case 'floor':
      return Math.floor(num(a));
    case 'ceil':
      return Math.ceil(num(a));
    case 'abs':
      return Math.abs(num(a));
    case 'min':
    case 'max':
    case 'sum':
    case 'avg': {
      const values = args
        .flat(1)
        .filter((v) => v !== null && v !== '')
        .map(num);
      if (!values.length) return op === 'sum' ? 0 : null;
      if (op === 'min') return Math.min(...values);
      if (op === 'max') return Math.max(...values);
      const sum = values.reduce((x, y) => x + y, 0);
      return op === 'avg' ? sum / values.length : sum;
    }
    case 'format':
      return str(a);
    case 'concat':
      return args.map(str).join('');
    case 'length':
    case 'count':
      return Array.isArray(a) ? a.length : str(a).length;
    case 'lower':
      return str(a).toLowerCase();
    case 'upper':
      return str(a).toUpperCase();
    case 'trim':
      return str(a).trim();
    case 'contains':
      return Array.isArray(a) ? a.includes(b ?? null) : str(a).includes(str(b));
    case 'replace':
      return str(a).replace(str(b), () => str(c));
    case 'slice':
      return str(a).slice(num(b), c === undefined ? undefined : num(c));
    case 'join':
      return (Array.isArray(a) ? a : args).join(str(b));
    case 'unique':
      return [...new Set(Array.isArray(a) ? a : args)];
    case 'now':
      return new Date(now).toISOString();
    case 'today':
      return new Date(now).toISOString().slice(0, 10);
    case 'dateBetween':
      return Math.trunc((Date.parse(str(a)) - Date.parse(str(b))) / unit(c));
    case 'dateAdd':
      return isoDate(Date.parse(str(a)) + num(b) * unit(c));
    case 'formatDate': {
      const iso = isoDate(Date.parse(str(a)));
      return (str(b) || 'YYYY-MM-DD').replace(/YYYY|MM|DD/g, (part) =>
        part === 'YYYY'
          ? iso.slice(0, 4)
          : part === 'MM'
            ? iso.slice(5, 7)
            : iso.slice(8, 10)
      );
    }
    default:
      return fail('SYNTAX');
  }
}

export function runFormula(
  source: string,
  prop: (id: string) => FormulaValue,
  pluck: (relation: string, column: string) => FormulaValue[],
  step: () => void,
  now: number
): FormulaValue {
  const evaluate = (node: Node): FormulaValue => {
    step();
    const { op, args } = node;
    const arg = (i: number) => (args[i] ? evaluate(args[i]!) : fail('SYNTAX'));
    if (op === 'literal') return node.value ?? null;
    if (op === 'prop') return prop(str(arg(0)));
    if (op === 'pluck') {
      return pluck(args[0]!.args[0]!.value as string, str(arg(1)));
    }
    if (op === 'if') return arg(0) ? arg(1) : arg(2);
    if (op === '&&' || op === 'and')
      return args.every((x) => Boolean(evaluate(x)));
    if (op === '||' || op === 'or')
      return args.some((x) => Boolean(evaluate(x)));
    const result = apply(op, args.map(evaluate), now);
    if (typeof result === 'number' && !Number.isFinite(result)) fail('TYPE');
    if (typeof result === 'string' && result.length > 32000) fail('LIMIT');
    return result;
  };
  return evaluate(compile(source));
}
