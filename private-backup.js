import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { createGzip, createGunzip } from 'node:zlib';
import { Writable } from 'node:stream';

// VACUUM INTO creates a consistent snapshot including committed WAL data.
// The source opens read-only; no checkpoint, deletion or schema change occurs.
export function backupPrivateDb(source) {
  if (source === ':memory:' || !fs.existsSync(source)) return null;
  const destination = source + '.backup-' + new Date().toISOString().replace(/[:.]/g, '-') + '-' + process.pid;
  const db = new DatabaseSync(source, { readOnly: true });
  try {
    const escaped = destination.replaceAll("'", "''");
    db.exec("VACUUM INTO '" + escaped + "'");
    fs.chmodSync(destination, 0o600);
  } finally { db.close(); }
  return destination;
}

// Optional lossless compression for new import backups on a space-limited Mac.
// The source database is never compressed or removed. The backup is replaced
// only after its decompressed bytes match the original snapshot exactly.
export async function compressPrivateBackup(backup) {
  if (!backup || !/\.backup-\d{4}-/.test(backup)) throw new Error('Only a generated backup can be compressed.');
  const destination=backup+'.gz',temporary=destination+'.tmp';
  if (fs.existsSync(destination)) throw new Error('Compressed backup already exists; original backup retained.');
  const digest=async (stream,...transforms)=>{
    const hash=createHash('sha256');
    await pipeline(stream,...transforms,new Writable({write(chunk,_encoding,callback){hash.update(chunk);callback();}}));
    return hash.digest('hex');
  };
  const originalHash=await digest(fs.createReadStream(backup));
  await pipeline(fs.createReadStream(backup),createGzip(),fs.createWriteStream(temporary,{flags:'wx',mode:0o600}));
  if(await digest(fs.createReadStream(temporary),createGunzip())!==originalHash) throw new Error('Compressed backup verification failed; original backup retained.');
  fs.renameSync(temporary,destination);
  fs.unlinkSync(backup);
  return destination;
}
