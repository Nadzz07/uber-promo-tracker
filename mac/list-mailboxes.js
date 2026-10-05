#!/usr/bin/osascript -l JavaScript

function childMailboxes(container) {
  try {
    return container.mailboxes() || [];
  } catch (_) {
    return [];
  }
}

function collect(boxes, prefix, output) {
  for (let i = 0; i < boxes.length; i++) {
    const box = boxes[i];
    let name = "";

    try { name = String(box.name() || ""); } catch (_) {}
    if (!name) continue;

    const path = prefix ? prefix + " / " + name : name;
    output.push(path);
    collect(childMailboxes(box), path, output);
  }
}

function run() {
  const Mail = Application("Mail");
  Mail.includeStandardAdditions = false;

  const output = [];

  try {
    const accounts = Mail.accounts();

    for (let i = 0; i < accounts.length; i++) {
      let accountName = "Account " + (i + 1);
      try { accountName = String(accounts[i].name() || accountName); } catch (_) {}

      collect(childMailboxes(accounts[i]), accountName, output);
    }
  } catch (_) {}

  return output.sort().join("\n");
}
