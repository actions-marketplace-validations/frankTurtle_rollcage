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
