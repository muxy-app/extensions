import test from "node:test";
import assert from "node:assert/strict";
import * as C from "../src/lib/core.js";
import { sample } from "./fixtures.js";

test('sample data normalizes cleanly and has no secrets', () => {
  const s = C.normalize(sample());
  assert.equal(s.groups.length, 5);
  assert.ok(s.snippets.length > 10);
  for (const sn of s.snippets) assert.equal(C.looksSecret(sn.command), null, sn.name);
});

test('parseVars finds unique vars with defaults', () => {
  assert.deepEqual(C.parseVars('ssh {{user:ec2-user}}@{{host}} -p {{port: 22 }} {{host}}'), [
    { name: 'user', def: 'ec2-user' },
    { name: 'host', def: null },
    { name: 'port', def: '22' }
  ]);
  assert.deepEqual(C.parseVars('no vars here'), []);
});

test('fill uses values, then defaults', () => {
  const cmd = 'redis-cli -h {{host}} -p {{port:6379}}';
  assert.equal(C.fill(cmd, { host: 'r1' }), 'redis-cli -h r1 -p 6379');
  assert.equal(C.fill(cmd, { host: 'r1', port: '7000' }), 'redis-cli -h r1 -p 7000');
  assert.deepEqual(C.missingVars(cmd, {}), ['host']);
  assert.deepEqual(C.missingVars(cmd, { host: 'x' }), []);
});

test('initialValues prefers last used values', () => {
  const sn = { command: 'a {{x:1}} {{y}}', lastVars: { y: 'prev' } };
  assert.deepEqual(C.initialValues(sn), { x: '1', y: 'prev' });
});

test('multi-line shaping', () => {
  const cmd = 'cd /data/logs\n\n  tail -f app.log  \n';
  assert.deepEqual(C.splitLines(cmd), ['cd /data/logs', '  tail -f app.log']);
  assert.equal(C.toInsertText(cmd), 'cd /data/logs &&   tail -f app.log');
});

test('looksSecret flags common secrets but not variables', () => {
  assert.ok(C.looksSecret('mysql -h db -u root -pS3cret!'));
  assert.ok(C.looksSecret('curl -H "Authorization: Bearer abcdefghijkl123"'));
  assert.ok(C.looksSecret('git clone https://user:hunter2@github.com/x/y'));
  assert.ok(C.looksSecret('export API_KEY=abcd1234efgh'));
  assert.equal(C.looksSecret('mysql -h db -u root -p'), null);
  assert.equal(C.looksSecret('mysql -h db -u root -p{{password}}'), null);
  assert.equal(C.looksSecret('redis-cli -h r -p 6379'), null);
  assert.equal(C.looksSecret('export TOKEN={{token}}'), null);
});

test('isSensitiveVar matches secret-like names', () => {
  for (const n of ['password', 'db_pass', 'PWD', 'api_key', 'token', 'client_secret']) assert.ok(C.isSensitiveVar(n), n);
  for (const n of ['host', 'port', 'namespace', 'user']) assert.ok(!C.isSensitiveVar(n), n);
});

test('recordUse never remembers sensitive variable values', () => {
  const s = C.normalize({ groups: [], snippets: [{ id: 's1', command: 'x {{host}} {{db_password}}' }] });
  const next = C.recordUse(s, 's1', { host: 'h1', db_password: 'nope' });
  assert.deepEqual(next.snippets[0].lastVars, { host: 'h1' });
  assert.ok(next.snippets[0].updatedAt > 0);
});

test('search ranks name matches first and filters groups', () => {
  const s = C.normalize(sample());
  const ranked = C.rank(s, 'pod');
  assert.ok(ranked.length >= 1);
  assert.equal(ranked[0].snippet.name, 'Pods in namespace');
  assert.equal(ranked[0].group.name, 'Kubernetes');
  const secs = C.sections(s, '', 'g_db');
  assert.equal(secs.length, 1);
  assert.equal(secs[0].group.id, 'g_db');
  assert.equal(C.sections(s, 'definitely-not-there', 'all').length, 0);
});

test('normalize drops junk and fixes references', () => {
  const s = C.normalize({
    groups: [{ id: 'a', name: 'A' }, { id: 'a', name: 'dup id' }, { name: '' }, null],
    snippets: [{ command: '' }, { id: 'x', command: 'ls', groupId: 'missing', action: 'weird' }, 'junk']
  });
  assert.equal(s.groups.length, 2);
  assert.notEqual(s.groups[0].id, s.groups[1].id);
  assert.equal(s.snippets.length, 1);
  assert.equal(s.snippets[0].groupId, null);
  assert.equal(s.snippets[0].action, 'run');
  assert.equal(s.snippets[0].name, 'ls');
});

test('upsert, duplicate, delete', () => {
  let s = C.emptyState();
  const r = C.upsertSnippet(s, { id: undefined, name: 'one', command: 'echo 1' });
  assert.ok(r.snippet && r.snippet.id, 'new snippet gets an id even when id: undefined is passed');
  s = r.state;
  assert.equal(s.snippets.length, 1);
  s = C.upsertSnippet(s, { id: r.snippet.id, command: 'echo 2' }).state;
  assert.equal(s.snippets[0].command, 'echo 2');
  assert.equal(s.snippets[0].name, 'one');
  const d = C.duplicateSnippet(s, r.snippet.id);
  assert.equal(d.state.snippets.length, 2);
  assert.equal(d.snippet.name, 'one copy');
  assert.equal(C.deleteSnippet(d.state, r.snippet.id).snippets.length, 1);
});

test('groups: add, rename, move, delete moves snippets to ungrouped', () => {
  let s = C.emptyState();
  const a = C.addGroup(s, 'A'); s = a.state;
  const b = C.addGroup(s, 'B'); s = b.state;
  s = C.upsertSnippet(s, { command: 'ls', groupId: a.group.id }).state;
  s = C.updateGroup(s, a.group.id, { name: 'Alpha' });
  assert.equal(s.groups[0].name, 'Alpha');
  s = C.moveGroup(s, b.group.id, -1);
  assert.equal(s.groups[0].id, b.group.id);
  s = C.deleteGroup(s, a.group.id, null);
  assert.equal(s.groups.length, 1);
  assert.equal(s.snippets[0].groupId, null);
  assert.equal(C.counts(s)[C.UNGROUPED], 1);
});

test('export → import merge round-trips and matches groups by name', () => {
  const s = C.normalize(sample());
  const json = C.exportJSON(s);
  const parsed = JSON.parse(json);
  assert.equal(parsed.app, 'snippets');
  assert.ok(!('lastVars' in parsed.snippets[0]));

  const merged = C.importJSON(json, s, 'merge');
  assert.equal(merged.added, 0);
  assert.equal(merged.updated, s.snippets.length);
  assert.equal(merged.groupsAdded, 0);

  const other = C.normalize({ groups: [{ id: 'zz', name: 'databases' }, { id: 'nn', name: 'New One' }], snippets: [
    { id: 'n1', command: 'psql', groupId: 'zz' }, { id: 'n2', command: 'htop', groupId: 'nn' }] });
  const m2 = C.importJSON(JSON.stringify(other), s, 'merge');
  assert.equal(m2.added, 2);
  assert.equal(m2.groupsAdded, 1);
  assert.equal(m2.state.snippets.find((x) => x.id === 'n1').groupId, 'g_db');

  const rep = C.importJSON(JSON.stringify(other), s, 'replace');
  assert.equal(rep.state.snippets.length, 2);
  assert.throws(() => C.importJSON('{"nope":1}', s, 'merge'), /snippets/);
  assert.throws(() => C.importJSON('not json', s, 'merge'));
});
