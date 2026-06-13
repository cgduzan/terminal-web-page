# infra — hosting for cgduzan.com

Static site hosted on AWS: private **S3** + **OAC** → **CloudFront** (HTTPS, apex,
`403/404 → /index.html`) → **ACM** cert (us-east-1) → **Route53** apex A/AAAA alias.
Provisioned with **Pulumi** (TypeScript); state in a self-managed **S3 backend**.
Content is deployed **one-shot** (not CI), because the easter-egg media is gitignored.

## Deploy the latest changes

```bash
# Content (HTML / CSS / JS / assets) — the common case:
./infra/deploy-content.sh          # syncs working tree to S3 + invalidates CloudFront

# Infrastructure (changes to infra/index.ts):
cd infra && source aws-env.sh && pulumi up
```

`deploy-content.sh` reads the **filesystem** (not git), so the gitignored egg media
(`assets/nedry.gif` / `.mp3`) is included. It self-sources credentials — no setup
needed once the two local files below exist.

## First-time / fresh-clone setup

AWS creds are scoped to this project (kept out of `~/.aws`). Two **gitignored**
files must be recreated:

1. **`infra/.env.local`** — copy the example and keep the values:
   ```bash
   cp infra/.env.local.example infra/.env.local
   # PULUMI_BACKEND_URL=s3://cgduzan-pulumi-state-<account-id>
   # PULUMI_CONFIG_PASSPHRASE=""        # stack stores no encrypted secrets
   ```
2. **`infra/.aws/credentials`** — access key for IAM user `cgduzan-deploy`
   (personal AWS account), in the format:
   ```ini
   [cgduzan]
   aws_access_key_id = ...
   aws_secret_access_key = ...
   ```

Then `source infra/aws-env.sh` (sets the profile, region us-east-1, and the Pulumi
backend) and the `aws` / `pulumi` CLIs are scoped to this project.

## Cost

~$0.50/mo (Route53 hosted zone; CloudFront free tier covers personal traffic).
