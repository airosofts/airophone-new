#!/usr/bin/env bash
# End-to-end RLS (Path A) verification against the TEST project only.
# Requires the dev server running on :3000 and the TEST anon key below.
# NEVER point this at production (sebaeihdyfhbkqmmrjbh).
set -uo pipefail
URL="https://sayakmjcwleakvxzuujw.supabase.co"
ANON="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNheWFrbWpjd2xlYWt2eHp1dWp3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM2MTE5ODUsImV4cCI6MjA5OTE4Nzk4NX0.3siTHLKHSxPOJ1qUnWz1Ldq0UCeNBc0UwoOqip3578E"
b=http://localhost:3000

login() { curl -s -c "$2" -X POST "$b/api/auth/login" -H "Content-Type: application/json" -d "$1" >/dev/null; }
tok()   { curl -s -b "$1" "$b/api/auth/supabase-token" | python -c "import sys,json;print(json.load(sys.stdin)['token'])"; }

login '{"email":"omar@airosofts.com","password":"Omar57faiz@"}' /tmp/acme.jar
login '{"email":"bob@globex.test","password":"x"}'             /tmp/globex.jar
ACME=$(tok /tmp/acme.jar); GLOBEX=$(tok /tmp/globex.jar)

echo "1) anon -> users (expect []):";        curl -s "$URL/rest/v1/users?select=id"        -H "apikey: $ANON" -H "Authorization: Bearer $ANON"
echo "2) anon -> messages (expect []):";     curl -s "$URL/rest/v1/messages?select=id"     -H "apikey: $ANON" -H "Authorization: Bearer $ANON"
echo "3) Acme -> messages (only Acme):";     curl -s "$URL/rest/v1/messages?select=body"   -H "apikey: $ANON" -H "Authorization: Bearer $ACME"
echo "4) Acme -> conversations (only Acme):";curl -s "$URL/rest/v1/conversations?select=name" -H "apikey: $ANON" -H "Authorization: Bearer $ACME"
echo "5) Globex -> messages (only Globex):"; curl -s "$URL/rest/v1/messages?select=body"   -H "apikey: $ANON" -H "Authorization: Bearer $GLOBEX"
echo "6) server route (Acme session) 200:";  curl -s -b /tmp/acme.jar -o /dev/null -w "%{http_code}\n" "$b/api/conversations"
echo "7) server route (no session) 401:";    curl -s -o /dev/null -w "%{http_code}\n" "$b/api/conversations"
