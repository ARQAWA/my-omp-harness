import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
const frontmatter = file => {
  const block = read(file).match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(block, `${file}: frontmatter`);
  return Object.fromEntries(block[1].split('\n').map(line => line.match(/^([\w-]+):\s*(.*)$/))
    .filter(Boolean).map(([, key, value]) => [key, value.replace(/^"(.*)"$/, '$1')]));
};

const packageText = read('package.json');
assert.doesNotMatch(packageText, /\\u[0-9a-fA-F]{4}/, 'package.json: readable UTF-8');
const manifest = JSON.parse(packageText);
assert.equal(manifest.name, 'my-omp-harness');
assert.deepEqual(manifest.omp.extensions, ['harness.ts', 'subagent-model-policy.ts', 'wrap-and-timer.ts', 'status-bar.ts', 'autocompaction.ts', 'model-arrows.js', 'reasoning-arrows.js', 'diagram.ts', 'rg.ts', 'tospec.ts', 'default-model.ts', 'subagent-reuse.ts', 'cursor-feed.ts', 'lcm/index.ts'].map(name => `./extensions/${name}`));
for (const entry of manifest.omp.extensions) assert.ok(existsSync(path.join(root, entry)), entry);

const policy = read('extensions/subagent-model-policy.ts');
// NAMED rows as [name, gpt, claude]
const named = [...policy.matchAll(/^\t(\w+): \{ gpt: "([^"]+)", claude: "([^"]+)" \},$/gm)]
  .map(([, name, gpt, claude]) => [name, gpt, claude]);
const tiers = [...policy.matchAll(/^\t(subagent_\w+): \{\n\t\tgpt: "([^"]+)",\n\t\tclaude: "([^"]+)",\n\t\},$/gm)];
assert.equal(named.length, 6, 'NAMED routes');
assert.equal(tiers.length, 4, 'ROUTES tiers');
const route = agent => named.find(([name]) => name === agent);
for (const agent of ['codebase_explorer', 'code_writer', 'shell_runner']) {
  const [, gpt, claude] = route(agent);
  assert.equal(gpt, 'anthropic/claude-haiku-5-5:high', `${agent}: gpt model`);
  assert.equal(claude, 'anthropic/claude-haiku-5-5:high', `${agent}: claude model`);
}

const agents = readdirSync(path.join(root, 'agents')).filter(file => file.endsWith('.md')).map(file => file.slice(0, -3)).sort();
assert.deepEqual(agents, named.map(([name]) => name).sort());
for (const name of agents) {
  const meta = frontmatter(`agents/${name}.md`);
  assert.equal(meta.name, name);
  assert.ok(meta.description, `${name}: description`);
  assert.equal(meta.model, undefined, `${name}: model comes from routing`);
}
for (const name of ['spotty', 'smarty', 'bossy', 'codebase_explorer', 'shell_runner']) {
  assert.equal(frontmatter(`agents/${name}.md`).tools, { codebase_explorer: 'bash, read, glob, grep', shell_runner: 'bash, read, grep' }[name] ?? 'read, glob, grep', name);
}

const hidden = ['blind-review-cycle', 'clear-communication', 'gold-standard', 'high-review-cycle', 'light-review-cycle', 'main-workflow', 'omp-tools'];
const visible = ['subagent-brief'];
const skills = readdirSync(path.join(root, 'skills'), { withFileTypes: true })
  .filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
assert.deepEqual(skills, [...hidden, ...visible].sort());
for (const skill of skills) {
  const meta = frontmatter(`skills/${skill}/SKILL.md`);
  assert.equal(meta.name, skill);
  assert.ok(meta.description, `${skill}: description`);
  assert.equal(meta.hide === 'true', hidden.includes(skill), `${skill}: hide`);
}
assert.deepEqual(readdirSync(path.join(root, 'extensions/tospec')).sort(),
  ['01-research.md', '02-spec.md', '03-approve.md', '04-execute.md', 'basis.md', 'review.md', 'spec-template.md']);
for (const step of ['03-approve.md']) assert.ok(read(`extensions/tospec/${step}`).includes('`ask`'), `${step}: ask`);

const codexLeftovers = /Goal|Notebook|notebook|agent_type|get_goal|create_goal|\$[a-z]|capture_cli|context_cli|fork|hook /;
for (const dir of ['skills', 'agents', 'extensions']) {
  for (const file of readdirSync(path.join(root, dir), { recursive: true })) {
    const relative = path.join(dir, file);
    if (!statSync(path.join(root, relative)).isFile()) continue;
    if (relative.split(path.sep).slice(0, 2).join('/') === 'extensions/lcm') continue;
    const text = read(relative);
    assert.doesNotMatch(text, codexLeftovers, relative);
    // skill://<name>[/<file>] must point to a bundled skill and an existing file
    for (const [, skill, sub] of text.matchAll(/skill:\/\/([\w-]+)(?:\/([\w./-]*\w))?/g)) {
      assert.ok(skills.includes(skill) && (!sub || existsSync(path.join(root, 'skills', skill, sub))), `${relative}: skill://${skill}/${sub ?? ''}`);
    }
  }
}

const harnessDoc = read('install-instructions/harness.md');
const system = read('SYSTEM.md');
assert.ok(system.includes('# Subagent model routing'));
for (const [name, gpt, claude] of named) {
  assert.ok(harnessDoc.includes(`| \`${name}\` | \`${gpt}\` | \`${claude}\` |`), `harness.md: ${name}`);
  assert.ok(system.includes(`\`${name}\``), `SYSTEM.md: ${name}`);
}
for (const [, name, gpt, claude] of tiers) {
  assert.ok(harnessDoc.includes(`| \`@${name}\` | \`${gpt}\` | \`${claude}\` |`), `harness.md: @${name}`);
  assert.ok(harnessDoc.includes(`"${name}": "${gpt}"`), `harness.md modelRoles: ${name}`);
  assert.ok(system.includes(`\`@${name}\``), `SYSTEM.md: @${name}`);
}
// MODELS from model-arrows.js, contextWindow ids from settings/models.yml
const modelsBlock = read('extensions/model-arrows.js').match(/MODELS = \[([^\]]*)\]/)?.[1] ?? '';
const models = [...modelsBlock.matchAll(/"([^"]+)"/g)].map(([, id]) => id);
assert.ok(models.length > 0, 'model-arrows.js: MODELS');
const windowed = new Set();
let provider = '', model = '';
for (const line of read('settings/models.yml').split('\n')) {
  const key = line.match(/^( {2}| {6})([\w.-]+):$/);
  if (key?.[1].length === 2) provider = key[2];
  else if (key) model = key[2];
  if (/^ {8}contextWindow:/.test(line)) windowed.add(`${provider}/${model}`);
}
const routed = [...named.map(([, gpt, claude]) => [gpt, claude]), ...tiers.map(([, , gpt, claude]) => [gpt, claude])]
  .flat().map(id => id.replace(/:\w+$/, ''));
for (const id of new Set(routed)) assert.ok(models.includes(id), `model-arrows.js: ${id}`);
for (const id of models) assert.ok(windowed.has(id), `settings/models.yml: ${id}`);

const installDocs = ['omp', 'harness', 'system-prompt', 'herdr'].map(name => `install-instructions/${name}.md`);
const headings = ['## Состав', '## Требования', '## Первая установка', '## Проверка после установки', '## Обновление'];
for (const doc of installDocs) {
  const text = read(doc);
  let previous = -1;
  for (const heading of headings) {
    const index = text.indexOf(`\n${heading}\n`);
    assert.ok(index > previous, `${doc}: ${heading}`);
    previous = index;
  }
  assert.ok(read('INSTALL_FOR_AGENTS.md').includes(`](${doc})`), `INSTALL_FOR_AGENTS.md: ${doc}`);
}
assert.ok(read('AGENTS.md').includes('node tests/run.mjs'));

const docs = ['README.md', 'AGENTS.md', 'INSTALL_FOR_AGENTS.md', 'SCOPE-FOCUS-DESIGN.md',
  ...installDocs, '.agents/skills/release/SKILL.md', '.agents/skills/finalize-work/SKILL.md'];
for (const doc of docs) {
  for (const [, target] of read(doc).matchAll(/\]\(([^)\s]+)\)/g)) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#')) continue;
    assert.ok(existsSync(path.resolve(root, path.dirname(doc), target.split('#')[0])), `${doc}: ${target}`);
  }
}

console.log('PASS: package, routing, models, agents, skills, install docs and links.');
