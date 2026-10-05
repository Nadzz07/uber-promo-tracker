#!/usr/bin/env node
import { getAccounts, openPrivateDb } from "../private-db.js";

const dbPath = process.argv[2] || "./uber-tracker.local.db";
const db = openPrivateDb(dbPath);

try {
  console.log("Private tracker DB ready: " + dbPath);
  console.log("Known accounts: " + getAccounts(db).length);
} finally {
  db.close();
}
