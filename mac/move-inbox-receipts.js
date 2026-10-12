#!/usr/bin/osascript -l JavaScript
// Message-ID-only plans cannot authorise a state-changing operation.
// Use the separately approved original-qualified filing workflow.
function run() {
  throw new Error('Legacy Message-ID-only receipt filing is disabled. Use a separately approved original-qualified plan.');
}
