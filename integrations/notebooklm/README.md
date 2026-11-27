# CaeLum → Google Docs → NotebookLM

One-way automatic mirror of the active website database `data/world.json` on `main`.
No existing website files or workflows are changed. No credentials are stored in GitHub.

## Setup once (owner's Google account)
1. Open https://script.google.com/ and create a standalone project named CaeLum Knowledge Sync.
2. Copy the entire contents of [Code.gs](./Code.gs) into the default editor file. Save.
3. Select `setupCaeLumSync` and Run. Approve Google permissions for Drive, Docs, external requests and triggers. The script creates six private Google Docs in a Drive folder, performs the first sync, then installs a one-minute trigger. If the run errors, inspect Executions and run setup again after fixing it.
4. Open the Drive folder **CaeLum - NotebookLM Sources** or run `showCaeLumDocs` to see links.
5. In NotebookLM, add all six sources using Google Drive (not downloaded copies). Keep these same sources as updates occur. Do not add legacy source documents. Keep the notebook private if it includes author-only material.
6. Check the version and SHA-256 in the Project Index and all other documents before asking important questions. Refresh/re-sync Drive sources if NotebookLM has not picked up changes.

## Operation
- GPT Browser / Author Mode updates GitHub as before.
- Apps Script checks the current public raw file approximately every minute (not a guaranteed real-time event or per-commit history). It only rewrites Docs when the content hash changes; multiple quick commits may collapse to the latest snapshot. NotebookLM has its own source-refresh latency.
- Stable document IDs, full replacement instead of append, all active entry fields, section metadata, and current narrative if present. Drafts/author-only are labeled and separated. Historical part files and revision files are never imported; if any separate old process puts them back into the active world.json they become current source data again, so do not re-run the legacy novel merge on retired content.
- Images and linked external pages are not copied; their source metadata/links are retained. New sections are automatically routed into existing documents. Unknown root fields are included in the index.
- Index updated last; if a run fails, the last-success hash is unchanged and the next check retries. Compare hashes for mixed-version detection. Document limit guard prevents oversized writes before changing any documents; split the affected source if required.
- Do not edit these generated Docs manually. Changes belong in GitHub. Do not publish the folder or NotebookLM if they contain private author-only entries.
- Manual refresh: run `syncCaeLum`. Stop: run `stopCaeLumSync`. Inspect Apps Script Executions for errors. If a generated Doc is deleted, restore it from Trash; do not change its ID unless you also replace the corresponding NotebookLM source.
- Google quotas, GitHub availability and NotebookLM source refresh may delay updates. This is not a live API connection.

The integration requires the owner to authorize Apps Script once; committing these files alone does not create Google Docs or activate the trigger.
