package terraform

# PG001: no public S3 buckets.

public_acls := {"public-read", "public-read-write", "authenticated-read"}

access_block_flags := {
	"block_public_acls",
	"block_public_policy",
	"ignore_public_acls",
	"restrict_public_buckets",
}

deny contains msg if {
	some type in {"aws_s3_bucket", "aws_s3_bucket_acl"}
	some rc in managed(type)
	rc.change.after.acl in public_acls
	msg := sprintf("PG001: %s has the public ACL %q", [rc.address, rc.change.after.acl])
}

# The AWS default for each flag is off, so a missing flag counts as not blocking.
deny contains msg if {
	some rc in managed("aws_s3_bucket_public_access_block")
	some flag in access_block_flags
	object.get(rc.change.after, flag, false) != true
	msg := sprintf("PG001: %s does not set %s to true", [rc.address, flag])
}
