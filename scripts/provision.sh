#!/usr/bin/env bash
# Creates the Cloudflare resources, applies migrations and pushes secrets. Safe to re-run.
set -euo pipefail
cd "$(dirname "$0")/.."
W="npx wrangler"

echo "== D1"
if ! $W d1 list --json | grep -q '"name": "hyperlearn"'; then $W d1 create hyperlearn >/dev/null; fi
DB_ID=$($W d1 list --json | node -e 'const l=JSON.parse(require("fs").readFileSync(0,"utf8"));console.log(l.find(d=>d.name==="hyperlearn").uuid)')
sed -i.bak "s/\"database_id\": \"[^\"]*\"/\"database_id\": \"$DB_ID\"/" wrangler.jsonc && rm -f wrangler.jsonc.bak
echo "database_id=$DB_ID"

echo "== R2"
$W r2 bucket create hyperlearn-files 2>/dev/null || echo "bucket exists"

echo "== Vectorize"
$W vectorize create hyperlearn-chunks --dimensions=768 --metric=cosine 2>/dev/null || echo "index exists"
$W vectorize create-metadata-index hyperlearn-chunks --property-name=sourceId --type=string 2>/dev/null || echo "metadata index exists"

echo "== Migrations"
$W d1 migrations apply hyperlearn --remote

echo "== Deploy (creates the Worker so secrets can attach)"
npm run build
$W deploy

echo "== Secrets"
node -e '
const fs=require("fs");
const keys=["CLERK_SECRET_KEY","CLERK_PUBLISHABLE_KEY","META_API_KEY","OPEN_MODEL_BASE_URL","OPEN_MODEL_ID","OPEN_MODEL_API_KEY","KEY_ENCRYPTION_KEY","LANGSMITH_API_KEY","SEED_TOKEN"];
const vars=Object.fromEntries(fs.readFileSync(".dev.vars","utf8").split("\n").filter(l=>l.includes("=")).map(l=>[l.slice(0,l.indexOf("=")).trim(),l.slice(l.indexOf("=")+1).trim()]));
const out={};for(const k of keys) if(vars[k]) out[k]=vars[k];
fs.writeFileSync(".secrets.json",JSON.stringify(out));
console.log("pushing",Object.keys(out).join(", "));'
$W secret bulk .secrets.json
rm -f .secrets.json

echo "== Widget sandbox"
$W deploy -c widgets/wrangler.jsonc

echo "== Health"
sleep 5
curl -s https://hyperlearn.radesh-govind.com/api/health; echo
