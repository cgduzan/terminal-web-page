# Source this to scope AWS creds to THIS project only.
# Keeps creds out of ~/.aws so work AWS tooling never sees them.
#   source infra/aws-env.sh
#
# Sensitive / env-specific values (state-bucket URL with account ID, Pulumi
# passphrase) live in infra/.env.local (gitignored). Copy .env.local.example.

# Resolve this script's directory whether sourced from bash or zsh.
if [ -n "${BASH_SOURCE:-}" ]; then _SRC="${BASH_SOURCE[0]}"; else _SRC="${(%):-%x}"; fi
_DIR="$(cd "$(dirname "$_SRC")" && pwd)"

export AWS_SHARED_CREDENTIALS_FILE="$_DIR/.aws/credentials"
export AWS_CONFIG_FILE="$_DIR/.aws/config"
export AWS_PROFILE="cgduzan"
export AWS_REGION="us-east-1"

if [ -f "$_DIR/.env.local" ]; then
    source "$_DIR/.env.local"
else
    echo "WARN: $_DIR/.env.local not found — copy .env.local.example and fill it in" >&2
fi

echo "AWS scoped to cgduzan project (profile=$AWS_PROFILE, region=$AWS_REGION)"
echo "Pulumi backend: ${PULUMI_BACKEND_URL:-<unset>}"
echo "creds: $AWS_SHARED_CREDENTIALS_FILE"
