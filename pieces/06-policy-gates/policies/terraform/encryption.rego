package terraform

# PG002: encryption at rest.

# Buckets are matched to their encryption resource two ways. By literal bucket name, when the plan
# knows it. By reference, when the encryption resource points at the bucket resource
# (`bucket = aws_s3_bucket.x.id`): Terraform leaves `after.bucket` unknown until apply, but the
# plan's `configuration` still records the reference. Only root-module references are followed. A
# bucket in a child module is matched by name only.
encrypted_buckets contains name if {
	some rc in managed("aws_s3_bucket_server_side_encryption_configuration")
	name := rc.change.after.bucket
}

encrypted_addresses contains address if {
	some res in input.configuration.root_module.resources
	res.type == "aws_s3_bucket_server_side_encryption_configuration"
	some address in res.expressions.bucket.references
}

deny contains msg if {
	some rc in managed("aws_s3_bucket")
	name := rc.change.after.bucket
	not name in encrypted_buckets
	not rc.address in encrypted_addresses
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
