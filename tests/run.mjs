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
assert.deepEqual(manifest.omp.extensions, ['harness.ts', 'subagent-model-policy.ts', 'wrap-and-timer.ts', 'status-bar.ts', 'compact-at-231k.ts', 'model-arrows.js', 'reasoning-arrows.js', 'diagram.ts', 'rg.ts', 'tospec.ts'].map(name => `./extensions/${name}`));
for (const entry of manifest.omp.extensions) assert.ok(existsSync(path.join(root, entry)), entry);

const policy = read('extensions/subagent-model-policy.ts');
// NAMED rows as [name, gptModels, claudeModels]; a list is the start order, a single model becomes a one-item list.
const named = [...policy.matchAll(/^\t(\w+): \{ gpt: ("[^"]+"|\[[^\]]+\]), claude: ("[^"]+"|\[[^\]]+\]) \},$/gm)]
  .map(([, name, gpt, claude]) => [name, [JSON.parse(gpt)].flat(), [JSON.parse(claude)].flat()]);
const tiers = [...policy.matchAll(/^\t(subagent_\w+): \{\n\t\tgpt: "([^"]+)",\n\t\tclaude: "([^"]+)",\n\t\},$/gm)];
assert.equal(named.length, 10, 'NAMED routes');
assert.equal(tiers.length, 4, 'ROUTES tiers');
const route = agent => named.find(([name]) => name === agent);
// 'openai-codex/gpt-6-sol:medium' -> ['gpt-6-sol', 'medium']; 'cursor/composer-2.5' -> ['composer-2.5']
const split = model => model.split('/')[1].split(':');
const short = model => split(model).join('/');

for (const [skill, agent] of [['light-review-cycle', 'spotty'], ['blind-review-cycle', 'smarty'], ['high-review-cycle', 'bossy']]) {
  const [, [gpt], [claude]] = route(agent);
  const [[gptId, gptEffort], [claudeId, claudeEffort]] = [split(gpt), split(claude)];
  assert.ok(read(`skills/${skill}/SKILL.md`).includes(`GPT parent: \`${gptId}\`, reasoning \`${gptEffort}\`; Claude parent: \`${claudeId}\`, reasoning \`${claudeEffort}\``), `${skill}: ${agent} models`);
}
const [, [smartyGpt], [smartyClaude]] = route('smarty');
for (const file of ['extensions/tospec/review.md', '.agents/skills/finalize-work/SKILL.md']) {
  assert.ok(read(file).includes(`GPT parent: ${split(smartyGpt).join(' / ')}; Claude parent: ${split(smartyClaude).join(' / ')}`), `${file}: smarty models`);
}
const harness = read('extensions/harness.ts');
for (const agent of ['lunatik', 'lunatron_luna_high', 'enot']) {
  const [, gpt, claude] = route(agent);
  assert.ok(gpt.length === 2 && claude.length === 2 && gpt[0] === claude[0] && gpt[0].startsWith('cursor/composer-'), `${agent}: Composer first`);
  assert.ok(harness.includes(`- ${agent} (${short(gpt[0])}; ${short(gpt[1])}; ${short(claude[1])})`), `harness.ts: ${agent} models`);
}
const sol = ['low', 'medium', 'high'].map(effort => [effort, ...route(`lunatron_sol_${effort}`).slice(1).map(([model]) => split(model))]);
for (const [effort, [gpt, gptEffort]] of sol) assert.ok(gpt === sol[0][1][0] && gptEffort === effort, `lunatron_sol_${effort}: GPT model`);
assert.ok(harness.includes(`(${sol[0][1][0]} at that\n  effort; ${sol.map(([, , [claude, effort]]) => `${claude}/${effort}`).join(', ')})`), 'harness.ts: Sol models');

const agents = readdirSync(path.join(root, 'agents')).filter(file => file.endsWith('.md')).map(file => file.slice(0, -3)).sort();
assert.deepEqual(agents, named.map(([name]) => name).sort());
for (const name of agents) {
  const meta = frontmatter(`agents/${name}.md`);
  assert.equal(meta.name, name);
  assert.ok(meta.description, `${name}: description`);
  assert.equal(meta.model, undefined, `${name}: model comes from routing`);
}
for (const name of ['spotty', 'smarty', 'bossy', 'enot']) {
  assert.equal(frontmatter(`agents/${name}.md`).tools, 'read, grep, glob, rg', name);
}

const hidden = ['blind-review-cycle', 'cleanup-task', 'clear-communication', 'context-gathering', 'gold-standard', 'high-review-cycle', 'light-review-cycle', 'omp-tools'];
const skills = readdirSync(path.join(root, 'skills'), { withFileTypes: true })
  .filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
assert.deepEqual(skills, [...hidden, 'lunatron-delegation'].sort());
for (const skill of skills) {
  const meta = frontmatter(`skills/${skill}/SKILL.md`);
  assert.equal(meta.name, skill);
  assert.ok(meta.description, `${skill}: description`);
  assert.equal(meta.hide === 'true', hidden.includes(skill), `${skill}: hide`);
}
assert.deepEqual(readdirSync(path.join(root, 'extensions/tospec')).sort(),
  ['01-research.md', '02-spec.md', '03-approve.md', '04-plan.md', '05-plan-check.md', '06-execute.md', 'basis.md', 'plan-template.md', 'review.md', 'spec-template.md']);
for (const step of ['03-approve.md', '05-plan-check.md']) assert.ok(read(`extensions/tospec/${step}`).includes('`ask`'), `${step}: ask`);

const codexLeftovers = /Goal|Notebook|notebook|agent_type|get_goal|create_goal|\$[a-z]|capture_cli|context_cli|fork|hook /;
for (const dir of ['skills', 'agents', 'extensions']) {
  for (const file of readdirSync(path.join(root, dir), { recursive: true })) {
    const relative = path.join(dir, file);
    if (!statSync(path.join(root, relative)).isFile()) continue;
    const text = read(relative);
    assert.doesNotMatch(text, codexLeftovers, relative);
    if (relative.startsWith(path.join('extensions', 'tospec'))) assert.doesNotMatch(text, /[Ss]potty|[Ll]ight[ -][Rr]eview/, `${relative}: one Smarty check`);
    // skill://<name>[/<file>] must point to a bundled skill and an existing file
    for (const [, skill, sub] of text.matchAll(/skill:\/\/([\w-]+)(?:\/([\w./-]*\w))?/g)) {
      assert.ok(skills.includes(skill) && (!sub || existsSync(path.join(root, 'skills', skill, sub))), `${relative}: skill://${skill}/${sub ?? ''}`);
    }
  }
}

const harnessDoc = read('install-instructions/harness.md');
const system = read('SYSTEM.md');
assert.ok(system.includes('# Subagent model routing'));
assert.ok(!system.includes('`luntik`'), 'SYSTEM.md: luntik removed');
const cell = models => models.map(model => `\`${model}\``).join(' → ');
for (const [name, gpt, claude] of named) {
  assert.ok(harnessDoc.includes(`| \`${name}\` | ${cell(gpt)} | ${cell(claude)} |`), `harness.md: ${name}`);
  assert.ok(system.includes(`\`${name}\``), `SYSTEM.md: ${name}`);
}
for (const [, name, gpt, claude] of tiers) {
  assert.ok(harnessDoc.includes(`| \`@${name}\` | \`${gpt}\` | \`${claude}\` |`), `harness.md: @${name}`);
  assert.ok(harnessDoc.includes(`"${name}": "${gpt}"`), `harness.md modelRoles: ${name}`);
  assert.ok(system.includes(`\`@${name}\``), `SYSTEM.md: @${name}`);
}

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

const docs = ['README.md', 'AGENTS.md', 'INSTALL_FOR_AGENTS.md', 'SCOPE-FOCUS-DESIGN.md', 'LUNATRON-DESIGN.md',
  ...installDocs, '.agents/skills/release/SKILL.md', '.agents/skills/finalize-work/SKILL.md'];
for (const doc of docs) {
  for (const [, target] of read(doc).matchAll(/\]\(([^)\s]+)\)/g)) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#')) continue;
    assert.ok(existsSync(path.resolve(root, path.dirname(doc), target.split('#')[0])), `${doc}: ${target}`);
  }
}

console.log('PASS: package, routing, models, agents, skills, install docs and links.');
