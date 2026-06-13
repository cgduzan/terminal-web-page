import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

// --- Constants -------------------------------------------------------------
const domain = "cgduzan.com";
const zoneId = "Z10261411FI9LG0EU7FYU"; // existing public hosted zone (apex)

// AWS managed cache policy "CachingOptimized".
const CACHING_OPTIMIZED = "658327ea-f89d-4fab-a63d-7e88639e58f6";

// --- Private S3 bucket (origin) -------------------------------------------
// Auto-named to avoid global-namespace collisions; CloudFront reaches it via OAC.
const bucket = new aws.s3.BucketV2("site", {});

new aws.s3.BucketPublicAccessBlock("site-pab", {
    bucket: bucket.id,
    blockPublicAcls: true,
    blockPublicPolicy: true,
    ignorePublicAcls: true,
    restrictPublicBuckets: true,
});

// --- ACM certificate (us-east-1, required by CloudFront) -------------------
// The default provider is us-east-1 (AWS_REGION / aws:region), so no alias needed.
const cert = new aws.acm.Certificate("cert", {
    domainName: domain,
    validationMethod: "DNS",
});

const certValidationRecord = new aws.route53.Record("cert-validation-record", {
    zoneId: zoneId,
    name: cert.domainValidationOptions[0].resourceRecordName,
    type: cert.domainValidationOptions[0].resourceRecordType,
    records: [cert.domainValidationOptions[0].resourceRecordValue],
    ttl: 300,
    allowOverwrite: true,
});

const certValidation = new aws.acm.CertificateValidation("cert-validation", {
    certificateArn: cert.arn,
    validationRecordFqdns: [certValidationRecord.fqdn],
});

// --- Origin Access Control -------------------------------------------------
const oac = new aws.cloudfront.OriginAccessControl("oac", {
    originAccessControlOriginType: "s3",
    signingBehavior: "always",
    signingProtocol: "sigv4",
});

// --- CloudFront distribution ----------------------------------------------
const cdn = new aws.cloudfront.Distribution("cdn", {
    enabled: true,
    isIpv6Enabled: true,
    defaultRootObject: "index.html",
    aliases: [domain],
    priceClass: "PriceClass_100", // cheapest: NA + EU edge locations
    origins: [{
        originId: "s3",
        domainName: bucket.bucketRegionalDomainName,
        originAccessControlId: oac.id,
    }],
    defaultCacheBehavior: {
        targetOriginId: "s3",
        viewerProtocolPolicy: "redirect-to-https",
        allowedMethods: ["GET", "HEAD", "OPTIONS"],
        cachedMethods: ["GET", "HEAD"],
        cachePolicyId: CACHING_OPTIMIZED,
        compress: true,
    },
    restrictions: {
        geoRestriction: { restrictionType: "none" },
    },
    // Unknown paths: a private OAC bucket returns 403 for a missing key (404 if
    // ever exposed). Serve the single root object instead so a typo'd URL lands
    // on the terminal rather than raw S3 XML. Short TTL so it isn't cached long.
    customErrorResponses: [
        { errorCode: 403, responseCode: 200, responsePagePath: "/index.html", errorCachingMinTtl: 10 },
        { errorCode: 404, responseCode: 200, responsePagePath: "/index.html", errorCachingMinTtl: 10 },
    ],
    viewerCertificate: {
        acmCertificateArn: certValidation.certificateArn,
        sslSupportMethod: "sni-only",
        minimumProtocolVersion: "TLSv1.2_2021",
    },
});

// --- Bucket policy: only this CloudFront distribution may read -------------
new aws.s3.BucketPolicy("site-policy", {
    bucket: bucket.id,
    policy: pulumi.all([bucket.arn, cdn.arn]).apply(([bucketArn, distArn]) =>
        JSON.stringify({
            Version: "2012-10-17",
            Statement: [{
                Sid: "AllowCloudFrontServicePrincipalReadOnly",
                Effect: "Allow",
                Principal: { Service: "cloudfront.amazonaws.com" },
                Action: "s3:GetObject",
                Resource: `${bucketArn}/*`,
                Condition: { StringEquals: { "AWS:SourceArn": distArn } },
            }],
        }),
    ),
});

// --- Route53 apex ALIAS records -> CloudFront ------------------------------
const aliasTarget = {
    name: cdn.domainName,
    zoneId: cdn.hostedZoneId,
    evaluateTargetHealth: false,
};

new aws.route53.Record("apex-a", {
    zoneId: zoneId,
    name: domain,
    type: "A",
    aliases: [aliasTarget],
});

new aws.route53.Record("apex-aaaa", {
    zoneId: zoneId,
    name: domain,
    type: "AAAA",
    aliases: [aliasTarget],
});

// --- Outputs ---------------------------------------------------------------
export const bucketName = bucket.bucket;
export const distributionId = cdn.id;
export const distributionDomain = cdn.domainName;
export const url = `https://${domain}`;
