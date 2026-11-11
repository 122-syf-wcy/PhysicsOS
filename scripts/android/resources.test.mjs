import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const main = path.join(repository, 'apps/android/app/src/main');
const resourceRoot = path.join(main, 'res');
const taskKey = /^(?:learning_|chat_|files_)/;
const resourceReference = /\bR\.string\.((?:learning_|chat_|files_)[a-z0-9_]+)/g;
const features = ['learning', 'chat', 'files'];

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(file) : [file];
  }).sort();
}

// Only real production files are inputs. No resource fixtures, generated data, or doctor imports.
const configurations = readdirSync(resourceRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && /^values(?:-|$)/.test(entry.name))
  .map((entry) => entry.name).sort();
const xmlFiles = configurations.flatMap((configuration) => walk(path.join(resourceRoot, configuration))
  .filter((file) => file.endsWith('.xml'))
  .map((file) => ({ file, configuration, source: readFileSync(file, 'utf8') })));
const kotlinFiles = walk(path.join(main, 'java')).filter((file) => file.endsWith('.kt'))
  .map((file) => ({ file, source: readFileSync(file, 'utf8') }));

function xmlCharacter(code) {
  return code === 9 || code === 10 || code === 13 ||
    (code >= 0x20 && code <= 0xd7ff) || (code >= 0xe000 && code <= 0xfffd) ||
    (code >= 0x10000 && code <= 0x10ffff);
}

function decodeEntities(text, label) {
  const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);|&/g, (token, entity) => {
    assert.ok(entity, `${label}: unescaped ampersand or unknown XML entity`);
    if (entity[0] !== '#') return entities[entity];
    const code = entity.startsWith('#x') ? Number.parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    assert.ok(xmlCharacter(code), `${label}: invalid XML character reference ${token}`);
    return String.fromCodePoint(code);
  });
}

// Node has no built-in XML DOM. Parse the XML subset used by Android values files strictly:
// balanced tags, quoted/unique attributes, entities, comments, CDATA, and XML 1.0 characters.
// DTDs and custom entities are intentionally not accepted in application resources.
function parseXml(source, label) {
  source = source.replace(/^\uFEFF/, '');
  for (const character of source) {
    assert.ok(xmlCharacter(character.codePointAt(0)), `${label}: invalid XML 1.0 character`);
  }
  const document = { name: '#document', attributes: {}, children: [] };
  const stack = [document];
  let position = 0;
  function appendText(value) {
    if (stack.length === 1) assert.ok(!value.trim(), `${label}: text outside the root element`);
    stack.at(-1).children.push(value);
  }
  while (position < source.length) {
    if (source.startsWith('<!--', position)) {
      const end = source.indexOf('-->', position + 4);
      assert.ok(end >= 0, `${label}: unterminated XML comment`);
      const comment = source.slice(position + 4, end);
      assert.ok(!comment.includes('--') && !comment.endsWith('-'), `${label}: invalid XML comment`);
      position = end + 3;
      continue;
    }
    if (source.startsWith('<?', position)) {
      const end = source.indexOf('?>', position + 2);
      assert.ok(end >= 0, `${label}: unterminated XML declaration`);
      assert.ok(position === 0 && /^<\?xml\s+version=(['"])1\.0\1(?:\s+encoding=(['"])utf-8\2)?(?:\s+standalone=(['"])(?:yes|no)\3)?\s*\?>$/i
        .test(source.slice(position, end + 2)), `${label}: unsupported or misplaced XML declaration`);
      position = end + 2;
      continue;
    }
    if (source.startsWith('<![CDATA[', position)) {
      assert.ok(stack.length > 1, `${label}: CDATA outside the root`);
      const end = source.indexOf(']]>', position + 9);
      assert.ok(end >= 0, `${label}: unterminated CDATA`);
      appendText(source.slice(position + 9, end));
      position = end + 3;
      continue;
    }
    if (source[position] !== '<') {
      const next = source.indexOf('<', position);
      const end = next < 0 ? source.length : next;
      const text = source.slice(position, end);
      assert.ok(!text.includes(']]>'), `${label}: CDATA terminator in plain text`);
      appendText(decodeEntities(text, label));
      position = end;
      continue;
    }
    let end = position + 1;
    let quote = null;
    for (; end < source.length; end++) {
      const character = source[end];
      if (quote) {
        if (character === quote) quote = null;
      } else if (character === '"' || character === "'") quote = character;
      else if (character === '>') break;
    }
    assert.ok(end < source.length && !quote, `${label}: unterminated XML tag`);
    let body = source.slice(position + 1, end);
    if (body.startsWith('/')) {
      const closing = /^\/([A-Za-z_][\w:.-]*)\s*$/.exec(body);
      assert.ok(closing && stack.length > 1, `${label}: invalid closing tag`);
      assert.equal(stack.at(-1).name, closing[1], `${label}: mismatched closing tag`);
      stack.pop();
    } else {
      const selfClosing = body.endsWith('/');
      if (selfClosing) body = body.slice(0, -1);
      const opening = /^([A-Za-z_][\w:.-]*)/.exec(body);
      assert.ok(opening, `${label}: invalid tag or unsupported declaration`);
      const node = { name: opening[1], attributes: {}, children: [] };
      let offset = opening[0].length;
      const attribute = /\s+([A-Za-z_][\w:.-]*)\s*=\s*("[^"<]*"|'[^'<]*')/y;
      while (body.slice(offset).trim()) {
        attribute.lastIndex = offset;
        const match = attribute.exec(body);
        assert.ok(match, `${label}: malformed or unquoted attribute in ${node.name}`);
        assert.ok(!Object.hasOwn(node.attributes, match[1]), `${label}: duplicate attribute ${match[1]}`);
        node.attributes[match[1]] = decodeEntities(match[2].slice(1, -1), label);
        offset = attribute.lastIndex;
      }
      stack.at(-1).children.push(node);
      if (!selfClosing) stack.push(node);
    }
    position = end + 1;
  }
  assert.equal(stack.length, 1, `${label}: unclosed XML tag`);
  const roots = document.children.filter((child) => typeof child !== 'string');
  assert.equal(roots.length, 1, `${label}: XML must have exactly one root`);
  assert.equal(roots[0].name, 'resources', `${label}: expected an Android resources root`);
  return roots[0];
}

function textOf(node) {
  return node.children.map((child) => typeof child === 'string' ? child : textOf(child)).join('');
}

let catalog;
function resources() {
  if (catalog) return catalog;
  catalog = new Map(configurations.map((configuration) => [configuration, []]));
  for (const input of xmlFiles) {
    const root = parseXml(input.source, input.file);
    for (const node of root.children) {
      if (typeof node === 'string') {
        assert.ok(!node.trim(), `${input.file}: text directly inside resources`);
        continue;
      }
      const kind = node.name === 'item' ? node.attributes.type : node.name;
      if (kind !== 'string' && kind !== 'plurals') continue;
      const name = node.attributes.name;
      assert.match(name ?? '', /^[a-z][a-z0-9_]*$/, `${input.file}: invalid string resource name`);
      catalog.get(input.configuration).push({ ...input, node, kind, name, text: textOf(node) });
    }
  }
  return catalog;
}

function stringMap(configuration) {
  return new Map(resources().get(configuration).filter((entry) => entry.kind === 'string')
    .map((entry) => [entry.name, entry]));
}

function androidEscapes(text, label) {
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (character === '\\') {
      const escaped = text[++index];
      assert.ok(escaped, `${label}: trailing Android escape`);
      if (escaped === 'u') {
        assert.match(text.slice(index + 1, index + 5), /^[0-9a-fA-F]{4}$/, `${label}: malformed Unicode escape`);
        index += 4;
      } else assert.ok("nrt\\'\"@?".includes(escaped), `${label}: unsupported Android escape`);
    } else if (character === '"') quoted = !quoted;
    else if (character === "'") assert.ok(quoted, `${label}: apostrophes must be escaped or inside Android quotes`);
  }
  assert.ok(!quoted, `${label}: unbalanced Android string quotes`);
}

function formatSignature(entry) {
  if (entry.node.attributes.formatted === 'false') return [];
  const signature = [];
  const text = entry.text;
  for (let index = 0; index < text.length; index++) {
    if (text[index] !== '%') continue;
    const token = /^%(?:(\d+)\$)?([-#+ 0,(<]*)(\d+)?(?:\.(\d+))?([tT])?([a-zA-Z%])/.exec(text.slice(index));
    const label = `${entry.file}: ${entry.name}`;
    assert.ok(token, `${label}: malformed format token; use %% for a literal percent`);
    index += token[0].length - 1;
    const [, argument, flags, , , date, conversion] = token;
    if (!date && (conversion === '%' || conversion === 'n')) {
      assert.ok(!argument && !flags.includes('<'), `${label}: a literal format token cannot use an argument`);
      continue;
    }
    assert.ok(date ? 'HIklMSLNpzZsQBbhAaCYyjmdeRTrDFc'.includes(conversion) : 'bBhHsScCdoxXeEfgGaA'.includes(conversion),
      `${label}: invalid format conversion`);
    assert.ok(argument && Number(argument) > 0 && !flags.includes('<'), `${label}: use explicit format indexes such as %1$s`);
    signature.push(`${Number(argument)}:${date ?? ''}${conversion}`);
  }
  const indexes = [...new Set(signature.map((value) => Number(value.split(':')[0])))].sort((a, b) => a - b);
  assert.deepEqual(indexes, indexes.map((_, index) => index + 1), `${entry.name}: format indexes must be contiguous`);
  return signature.sort((a, b) => Number(a.split(':')[0]) - Number(b.split(':')[0]) || a.localeCompare(b));
}

// These are reviewed Java Formatter types, not mock resource values. They are checked against
// the real XML AND actual Kotlin calls below. Scores/revisions converted by toString() are s;
// Int/Long counts, page numbers, image limits, rotation, and the scene revision are d.
const reviewedFormatTypes = new Map(Object.entries({
  learning_auth_challenge_expiry: ['s'], // displayDate()
  learning_auth_pending_message: ['s', 's'], // AuthUiState.pendingSchool / pendingEmail: String
  learning_home_welcome_name: ['s'], // HomeUiState.displayName: String
  learning_library_more: ['s'], // libraryKindLabel(): String
  learning_library_source: ['s'], // LibraryEntry.source: String?
  learning_assignment_due: ['s'], // displayDate()
  learning_assignment_question_number: ['d'], // PaperQuestion.number: Int
  learning_assignment_question_score: ['s'], // Double.toString()
  learning_assignment_reviewed_at: ['s'], // displayDate()
  learning_assignment_score: ['s'], // Double.toString()
  learning_assignment_submitted_at: ['s'], // displayDate()
  learning_record_knowledge: ['s'], // joinToString()
  learning_sync_base_revision: ['s'], // Long?.toString() ?: stringResource(learning_unknown)
  learning_sync_current_revision: ['s'], // Long?.toString() ?: stringResource(learning_unknown)
  chat_attachment_count: ['d'], // List.size: Int
  chat_intake_limits: ['d', 'd', 'd'], // Long / Int / Long; MiB values use integer division
  chat_queue_count: ['d'], // List.size: Int
  chat_scene_revision: ['d'], // ChatRow.Scene.revision: Long
  chat_verification_status: ['s'], // JsonObject.string(): String?
  files_pdf_full_document: ['d'], // OpenedFile.pageCount / PreparedAttachment.pageCount: Int?
  files_pdf_page: ['d', 'd'], // page + 1 / count: Int
  files_remove_local_body: ['s'], // DownloadRecord.name: String
  files_rotate_on_save: ['d'], // turns * 90: Int
  files_transfer_bytes: ['s', 's'], // sizeLabel(): String, already localized
}));

// Mask comments/literals while keeping offsets, so examples and quoted resource names do not
// count as production references, and commas/parentheses in string literals do not split calls.
function kotlinCode(source) {
  return source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\r\n]*|"""[\s\S]*?"""|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])'/g,
    (literal) => literal.replace(/[^\r\n]/g, ' '));
}

const kotlin = kotlinFiles.map((input) => ({ ...input, code: kotlinCode(input.source) }));
const references = kotlin.flatMap((input) => [...input.code.matchAll(resourceReference)]
  .map((match) => ({ name: match[1], file: input.file, offset: match.index })));

function resourceCalls(code, file) {
  const calls = [];
  for (const match of code.matchAll(/\b(?:stringResource|getString)\s*\(/g)) {
    const start = match.index + match[0].lastIndexOf('(');
    const stack = ['('];
    const arguments_ = [];
    let argumentStart = start + 1;
    let index = start + 1;
    for (; index < code.length && stack.length; index++) {
      const character = code[index];
      if ('([{'.includes(character)) stack.push(character);
      else if (')]}'.includes(character)) {
        assert.equal(stack.pop(), { ')': '(', ']': '[', '}': '{' }[character], `${file}: unbalanced Kotlin resource call`);
        if (!stack.length) {
          if (code.slice(argumentStart, index).trim()) arguments_.push(code.slice(argumentStart, index));
        }
      } else if (character === ',' && stack.length === 1) {
        arguments_.push(code.slice(argumentStart, index));
        argumentStart = index + 1;
      }
    }
    assert.equal(stack.length, 0, `${file}: unterminated Kotlin resource call`);
    calls.push({ arguments: arguments_, offset: start });
  }
  return calls;
}

test('production values XML is well-formed and uses valid Android string escaping', (t) => {
  for (const input of xmlFiles) parseXml(input.source, input.file);
  for (const configuration of ['values', 'values-en']) {
    for (const entry of resources().get(configuration).filter((entry) => taskKey.test(entry.name))) {
      assert.equal(entry.kind, 'string', `${entry.name}: R.string callers need a string, not plurals`);
      assert.ok(entry.text.trim(), `${entry.name}: empty text`);
      androidEscapes(entry.text, `${entry.file}: ${entry.name}`);
      formatSignature(entry);
    }
  }
  t.diagnostic(`Parsed ${xmlFiles.length} production values XML files without external packages.`);
});

test('string and plural names are unique within each Android configuration', () => {
  for (const [configuration, entries] of resources()) {
    const seen = new Map();
    for (const entry of entries) {
      const key = `${entry.kind}/${entry.name}`;
      assert.ok(!seen.has(key), `${configuration}: duplicate ${key} in ${seen.get(key)} and ${entry.file}`);
      seen.set(key, entry.file);
    }
  }
});

test('feature files contain only their assigned, actually referenced keys and have bilingual parity', (t) => {
  const actualReferences = new Set(references.map((reference) => reference.name));
  for (const feature of features) {
    const localized = ['values', 'values-en'].map((configuration) => {
      const file = path.join(resourceRoot, configuration, `strings_feature_${feature}.xml`);
      const input = xmlFiles.find((candidate) => candidate.file === file);
      assert.ok(input, `${file}: missing production resource file`);
      const entries = resources().get(configuration).filter((entry) => entry.file === file);
      assert.ok(entries.length > 0, `${file}: no resources`);
      for (const entry of entries) {
        assert.equal(entry.kind, 'string');
        assert.ok(entry.name.startsWith(`${feature}_`), `${file}: out-of-scope resource ${entry.name}`);
        assert.ok(actualReferences.has(entry.name), `${file}: unused or invented resource ${entry.name}`);
      }
      return entries.map((entry) => entry.name).sort();
    });
    assert.deepEqual(localized[0], localized[1], `${feature}: Chinese/English keys differ`);
    t.diagnostic(`${feature}: ${localized[0].length} new keys per language.`);
  }
});

test('all task-prefix strings have identical Chinese/English keys and indexed format types', () => {
  const chinese = stringMap('values');
  const english = stringMap('values-en');
  const keys = (entries) => [...entries.keys()].filter((name) => taskKey.test(name)).sort();
  assert.deepEqual(keys(chinese), keys(english), 'Task-prefix keys differ between Chinese and English');
  for (const name of keys(chinese)) {
    assert.deepEqual(formatSignature(chinese.get(name)), formatSignature(english.get(name)), `${name}: format arguments differ`);
  }
});

test('every task-prefix reference in real production Kotlin resolves in both languages', (t) => {
  assert.ok(references.length > 0, 'No production resource references found');
  for (const configuration of ['values', 'values-en']) {
    const strings = stringMap(configuration);
    for (const reference of references) {
      assert.ok(strings.has(reference.name), `${reference.file}: missing ${configuration}/${reference.name}`);
    }
  }
  t.diagnostic(`Resolved ${new Set(references.map((reference) => reference.name)).size} unique keys across ${references.length} Kotlin references.`);
});

test('formatted resources match reviewed Kotlin argument types and all real call arities', (t) => {
  const chinese = stringMap('values');
  const formatted = [...chinese.values()].filter((entry) => taskKey.test(entry.name) && formatSignature(entry).length > 0);
  assert.deepEqual(formatted.map((entry) => entry.name).sort(), [...reviewedFormatTypes.keys()].sort(),
    'New or removed formatted strings require a call-context review');
  for (const entry of formatted) {
    const expected = reviewedFormatTypes.get(entry.name).map((type, index) => `${index + 1}:${type}`);
    assert.deepEqual(formatSignature(entry), expected, `${entry.name}: wrong conversion for the reviewed Kotlin argument type`);
  }
  const formattedCalls = new Map();
  let checkedCalls = 0;
  for (const input of kotlin) {
    for (const call of resourceCalls(input.code, input.file)) {
      const first = call.arguments[0] ?? '';
      for (const match of first.matchAll(resourceReference)) {
        const name = match[1];
        const entry = chinese.get(name);
        assert.ok(entry, `${input.file}: missing ${name}`);
        const signature = formatSignature(entry);
        const count = Math.max(0, ...signature.map((argument) => Number(argument.split(':')[0])));
        assert.equal(call.arguments.length - 1, count, `${input.file}: ${name} receives the wrong number of format arguments`);
        checkedCalls++;
        if (count > 0) formattedCalls.set(name, (formattedCalls.get(name) ?? 0) + 1);
      }
    }
  }
  assert.deepEqual([...formattedCalls.keys()].sort(), [...reviewedFormatTypes.keys()].sort(),
    'Every formatted string must have an inspected, real Kotlin call');
  t.diagnostic(`Checked ${checkedCalls} resource selections; ${[...formattedCalls.values()].reduce((sum, count) => sum + count, 0)} formatted call sites use ${formatted.length} reviewed format contracts.`);
});
