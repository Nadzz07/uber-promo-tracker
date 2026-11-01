import assert from 'node:assert/strict';
import {prepareAccountImport,accountWithDeviceMetadata} from './account-import.js';
const accounts=[{accountRef:'A1',accountMasked:'te…st@example.invalid',canLogin:false,loginMethod:'iCloud',note:'existing note'}],row={accountRef:'A1',accountMasked:'te…st@example.invalid',email:'tezzst@example.invalid'},file=rows=>({kind:'uber-tracker-device-accounts',schemaVersion:1,accounts:rows});
const added=prepareAccountImport(file([row,row]),accounts,{});assert.deepEqual(added.counts,{added:1,updated:0,unchanged:0,rejected:0});assert.equal(added.changes,1);
const repeated=prepareAccountImport(file([row]),accounts,added.mapping);assert.equal(repeated.counts.unchanged,1);assert.equal(repeated.changes,0);
const change=prepareAccountImport(file([{...row,canLogin:true,loginMethod:'Both',note:''}]),accounts,added.mapping);assert.equal(change.counts.updated,1);assert.match(change.review[0].fields.join(' '),/Can’t log in → Can log in/);assert.match(change.review[0].fields.join(' '),/Clear note/);assert.equal(change.notes.A1,'');const projected=accountWithDeviceMetadata(change.mapping,accounts[0]);assert.equal(projected.canLogin,true);assert.deepEqual(projected.loginMethods,['Google','iCloud']);
const missing=prepareAccountImport(file([row]),accounts,added.mapping);assert.deepEqual(missing.notes,{});assert.equal(missing.changes,0);
assert.throws(()=>prepareAccountImport(file([row,{...row,canLogin:true}]),accounts,{}),/Conflicting duplicate/);
const invalid=prepareAccountImport(file([row,{email:'bad'}]),accounts,{});assert.equal(invalid.counts.added,1);assert.equal(invalid.counts.rejected,1);
const blank=prepareAccountImport(file([{...row,canLogin:'',loginMethod:''}]),accounts,added.mapping);assert.equal(blank.changes,0);
console.log('✓ Account import: normalized identity, unique mutually exclusive counts, duplicate conflicts, missing/blank fields, reviewed access/provider/note clearing, both providers and safe device-only projection.');

assert.throws(()=>prepareAccountImport(file([row,{...row,email:'teotherst@example.invalid'}]),accounts,{}),/Conflicting duplicate/);
assert.throws(()=>prepareAccountImport(file([row,{...row,email:''}]),accounts,{}),/Conflicting duplicate/);
assert.equal(prepareAccountImport(file([row,{...row,email:row.email.toUpperCase()}]),accounts,{}).counts.added,1);
