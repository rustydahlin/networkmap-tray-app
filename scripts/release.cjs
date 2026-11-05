const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const semver = require('semver');

const root = path.join(__dirname, '..');

function unreleasedSection(changelog) {
  const sections = [...changelog.matchAll(/^## \[([^\]]+)\][^\r\n]*\r?\n/gm)];
  if (sections[0]?.[1] !== 'Unreleased' || sections.filter(section => section[1] === 'Unreleased').length !== 1) {
    throw new Error('CHANGELOG.md must start with exactly one ## [Unreleased] section.');
  }
  const start = sections[0].index;
  const end = sections[1]?.index ?? changelog.length;
  return { start, end, body: changelog.slice(start + sections[0][0].length, end).trim() };
}

function inferBump(body, commits = '') {
  if (/BREAKING[ -]CHANGE|^### (Breaking Changes|Removed)\b/im.test(body) || /^[a-z]+(?:\([^\n]*\))?!:/m.test(commits) || /BREAKING CHANGE/.test(commits)) {
    return 'major';
  }
  if (/^### Added\b/m.test(body) || /^feat(?:\([^\n]*\))?:/m.test(commits)) return 'minor';
  return 'patch';
}

function prepareChangelog(changelog, version, date) {
  if (!semver.valid(version)) throw new Error('Invalid release version.');
  const section = unreleasedSection(changelog);
  if (!/^- \S/m.test(section.body)) throw new Error('Unreleased has no changes to release.');
  if (changelog.includes(`## [${version}]`)) throw new Error(`Version ${version} already exists in CHANGELOG.md.`);
  const remaining = changelog.slice(section.end);
  return changelog.slice(0, section.start) +
    `## [Unreleased]\n\n## [${version}] - ${date}\n\n${section.body}\n` +
    (remaining ? `\n${remaining}` : '');
}

function releaseNotes(changelog, version) {
  const sections = [...changelog.matchAll(/^## \[([^\]]+)\](?: - (\d{4}-\d{2}-\d{2}))?\r?\n/gm)];
  const index = sections.findIndex(section => section[1] === version);
  if (index < 0 || !sections[index][2]) throw new Error(`Missing dated changelog entry for ${version}.`);
  const section = sections[index];
  const notes = changelog.slice(section.index + section[0].length, sections[index + 1]?.index ?? changelog.length).trim();
  if (!/^- \S/m.test(notes)) throw new Error('Release notes must include at least one changelog entry.');
  return `${notes}\n`;
}

function verifyRelease(directory, tag) {
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(directory, 'package-lock.json'), 'utf8'));
  const changelog = fs.readFileSync(path.join(directory, 'CHANGELOG.md'), 'utf8');
  if (!semver.valid(manifest.version)) throw new Error('Invalid application version.');
  if (manifest.version !== lock.version || manifest.version !== lock.packages?.['']?.version) {
    throw new Error('package.json and package-lock.json versions must match.');
  }
  if (tag && tag !== `v${manifest.version}`) throw new Error('Release tag does not match the application version.');
  const section = unreleasedSection(changelog);
  if (/^- \S/m.test(section.body)) throw new Error('Move all Unreleased entries into the versioned release before publishing.');
  if (!changelog.slice(section.end).startsWith(`## [${manifest.version}] - `)) {
    throw new Error('The newest changelog release must match the application version.');
  }
  releaseNotes(changelog, manifest.version);
  return manifest.version;
}

function commitMessages() {
  let latestTag;
  try {
    latestTag = execFileSync('git', ['describe', '--tags', '--abbrev=0'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    latestTag = null;
  }
  return execFileSync('git', ['log', '--format=%B', ...(latestTag ? [`${latestTag}..HEAD`] : [])], { cwd: root, encoding: 'utf8' });
}

function main() {
  const [command, argument] = process.argv.slice(2);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const changelogPath = path.join(root, 'CHANGELOG.md');
  const changelog = fs.readFileSync(changelogPath, 'utf8');
  if (command === 'prepare') {
    const body = unreleasedSection(changelog).body;
    const bump = argument ?? inferBump(body, commitMessages());
    if (!['patch', 'minor', 'major'].includes(bump)) throw new Error('Choose patch, minor, or major.');
    const version = semver.inc(manifest.version, bump);
    const updated = prepareChangelog(changelog, version, new Date().toISOString().slice(0, 10));
    if (!process.env.npm_execpath) throw new Error('Run this command using npm run release:prepare.');
    execFileSync(process.execPath, [process.env.npm_execpath, 'version', version, '--no-git-tag-version', '--ignore-scripts'], { cwd: root, stdio: 'inherit' });
    fs.writeFileSync(changelogPath, updated);
    console.log(`Prepared v${version} (${bump}). No commit, tag, or upload has been made.`);
  } else if (command === 'verify') {
    console.log(`Verified v${verifyRelease(root, process.env.RELEASE_TAG || argument)}.`);
  } else if (command === 'notes') {
    const notes = releaseNotes(changelog, manifest.version);
    if (argument) {
      const output = path.resolve(root, argument);
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.writeFileSync(output, notes);
    } else {
      process.stdout.write(notes);
    }
  } else {
    throw new Error('Use prepare [patch|minor|major], verify [vX.Y.Z], or notes [output-file].');
  }
}

module.exports = { unreleasedSection, inferBump, prepareChangelog, releaseNotes, verifyRelease };

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}