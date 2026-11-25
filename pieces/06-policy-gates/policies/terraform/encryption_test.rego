package terraform

sse(bucket) := res("aws_s3_bucket_server_side_encryption_configuration", bucket, {"bucket": bucket})

test_pg002_bucket_without_encryption_fails if {
	input_ := plan([res("aws_s3_bucket", "logs", {"bucket": "logs"})])
	rule_ids(deny) == {"PG002"} with input as input_
}

test_pg002_bucket_with_encryption_passes if {
	input_ := plan([res("aws_s3_bucket", "logs", {"bucket": "logs"}), sse("logs")])
	count(deny) == 0 with input as input_
}

test_pg002_encryption_for_another_bucket_does_not_count if {
	input_ := plan([res("aws_s3_bucket", "logs", {"bucket": "logs"}), sse("other")])
	rule_ids(deny) == {"PG002"} with input as input_
}

test_pg002_bucket_with_unknown_name_is_skipped if {
	input_ := plan([res("aws_s3_bucket", "logs", {"bucket_prefix": "logs-"})])
	count(deny) == 0 with input as input_
}

test_pg002_unencrypted_ebs_volume_fails if {
	input_ := plan([res("aws_ebs_volume", "data", {"size": 10, "encrypted": false})])
	rule_ids(deny) == {"PG002"} with input as input_
}

test_pg002_ebs_volume_without_flag_fails if {
	input_ := plan([res("aws_ebs_volume", "data", {"size": 10})])
	rule_ids(deny) == {"PG002"} with input as input_
}

test_pg002_encrypted_ebs_volume_passes if {
	input_ := plan([res("aws_ebs_volume", "data", {"size": 10, "encrypted": true})])
	count(deny) == 0 with input as input_
}

test_pg002_unencrypted_rds_instance_fails if {
	input_ := plan([res("aws_db_instance", "main", {"engine": "postgres", "storage_encrypted": false})])
	rule_ids(deny) == {"PG002"} with input as input_
}

test_pg002_encrypted_rds_instance_passes if {
	input_ := plan([res("aws_db_instance", "main", {"engine": "postgres", "storage_encrypted": true})])
	count(deny) == 0 with input as input_
}

test_pg002_destroyed_unencrypted_volume_passes if {
	input_ := plan([destroyed("aws_ebs_volume", "data", {"size": 10})])
	count(deny) == 0 with input as input_
}

# What Terraform really emits for `bucket = aws_s3_bucket.logs.id`: no `after.bucket`, a reference
# in the configuration block.
with_reference(address) := {"expressions": {"bucket": {"references": [concat(".", [address, "id"]), address]}}}

sse_by_reference(name, address) := {
	"address": sprintf("aws_s3_bucket_server_side_encryption_configuration.%s", [name]),
	"type": "aws_s3_bucket_server_side_encryption_configuration",
	"name": name,
	"change": {"actions": ["create"], "after": {}},
}

config(resources) := {"root_module": {"resources": resources}}

test_pg002_encryption_found_by_reference_passes if {
	input_ := object.union(
		plan([res("aws_s3_bucket", "logs", {"bucket": "logs"}), sse_by_reference("logs", "aws_s3_bucket.logs")]),
		{"configuration": config([object.union({"type": "aws_s3_bucket_server_side_encryption_configuration"}, with_reference("aws_s3_bucket.logs"))])},
	)
	count(deny) == 0 with input as input_
}

test_pg002_encryption_referencing_another_bucket_does_not_count if {
	input_ := object.union(
		plan([res("aws_s3_bucket", "logs", {"bucket": "logs"}), sse_by_reference("other", "aws_s3_bucket.other")]),
		{"configuration": config([object.union({"type": "aws_s3_bucket_server_side_encryption_configuration"}, with_reference("aws_s3_bucket.other"))])},
	)
	rule_ids(deny) == {"PG002"} with input as input_
}
