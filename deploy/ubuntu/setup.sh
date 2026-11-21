#!/bin/sh
set -eu
cd "$(dirname "$0")"
exec python3 - "$@" <<'PY'
from pathlib import Path
import os
import re
import secrets
import sys
from urllib.parse import urlsplit

if len(sys.argv) > 4:
    sys.exit('Usage: bash setup.sh [NETLIFY_HTTPS_ORIGIN [UBUNTU_HTTPS_ORIGIN [ADMIN_EMAIL]]]')

def https_host(value):
    try:
        url = urlsplit(value)
        host = url.hostname or ''
    except ValueError:
        sys.exit('Enter a valid HTTPS origin with a public DNS hostname.')
    label = r'[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?'
    if (value.rstrip('/').lower() != 'https://' + host or url.path not in ('', '/')
            or len(host) > 253 or not re.fullmatch(rf'{label}(?:\.{label})+', host)):
        sys.exit('Enter a full HTTPS origin with a public DNS hostname, for example https://releasegate.example.com.')
    return host

args = sys.argv[1:]
site = https_host(args[0] if args else 'https://releasegate.example.com')
api = https_host(args[1] if len(args) > 1 else 'https://api.releasegate.example.com')
if site == api:
    sys.exit('The Netlify site and Ubuntu API need distinct hostnames.')
admin = args[2] if len(args) > 2 else 'admin@releasegate.local'
if (len(admin) > 254 or not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', admin)
        or any(ord(char) < 32 or ord(char) == 127 for char in admin)):
    sys.exit('Enter a valid administrator email address.')
values = {
    'PUBLIC_ORIGIN': 'https://' + site,
    'API_HOST': api,
    'DEMO_ADMIN_EMAIL': "'" + admin.replace('\\', '\\\\').replace("'", "\\'") + "'",
    'DEMO_ADMIN_PASSWORD': secrets.token_hex(32),
}
template = Path('.env.example').read_text(encoding='utf-8').splitlines()
output = []
for line in template:
    key, _, value = line.partition('=')
    output.append(key + '=' + values[key] if key in values else line)
try:
    descriptor = os.open('.env', os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
except FileExistsError:
    sys.exit('A private .env already exists. Edit it to change settings, or continue with docker compose up -d --build.')
with os.fdopen(descriptor, 'w', encoding='utf-8') as private_file:
    private_file.write('\n'.join(output) + '\n')
print('Created the private Ubuntu .env. The initial sign-in is stored there.')
print('Frontend: https://' + site)
print('API: https://' + api)
PY
