package terraform

# PG002: encryption at rest.

# Buckets are matched to their encryption resource by literal bucket name. A name that is unknown
# until apply is not in the plan, so that bucket is skipped.
encrypted_buckets contains name if {
	some rc in managed("aws_s3_bucket_server_side_encryption_configuration")
	name := rc.change.after.bucket
}

deny contains msg if {
	some rc in managed("aws_s3_bucket")
	name := rc.change.after.bucket
	not name in encrypted_buckets
	msg := sprintf(
		"PG002: %s has no aws_s3_bucket_server_side_encryption_configuration for bucket %q",
		[rc.address, name],
	)
}

deny contains msg if {
	some rc in managed("aws_ebs_volume")
	object.get(rc.change.after, "encrypted", false) != true
	msg := sprintf("PG002: %s is not encrypted (set encrypted = true)", [rc.address])
}

deny contains msg if {
	some rc in managed("aws_db_instance")
	object.get(rc.change.after, "storage_encrypted", false) != true
	msg := sprintf("PG002: %s is not encrypted (set storage_encrypted = true)", [rc.address])
}
