package terraform

test_pg001_public_read_acl_fails if {
	input_ := plan([res("aws_s3_bucket", "assets", {"bucket": "assets", "acl": "public-read"})])
	denials := deny with input as input_
	count({m | some m in denials; startswith(m, "PG001")}) == 1
}

test_pg001_public_read_write_acl_fails if {
	input_ := plan([res("aws_s3_bucket", "assets", {"bucket": "assets", "acl": "public-read-write"})])
	"PG001" in rule_ids(deny) with input as input_
}

test_pg001_authenticated_read_acl_fails if {
	input_ := plan([res("aws_s3_bucket_acl", "assets", {"bucket": "assets", "acl": "authenticated-read"})])
	rule_ids(deny) == {"PG001"} with input as input_
}

test_pg001_private_acl_passes if {
	input_ := plan([
		res("aws_s3_bucket", "assets", {"bucket": "assets", "acl": "private"}),
		res("aws_s3_bucket_server_side_encryption_configuration", "assets", {"bucket": "assets"}),
	])
	count(deny) == 0 with input as input_
}

test_pg001_access_block_with_a_false_flag_fails if {
	input_ := plan([res("aws_s3_bucket_public_access_block", "assets", {
		"bucket": "assets",
		"block_public_acls": true,
		"block_public_policy": false,
		"ignore_public_acls": true,
		"restrict_public_buckets": true,
	})])
	denials := deny with input as input_
	count(denials) == 1
	some msg in denials
	contains(msg, "block_public_policy")
}

test_pg001_access_block_with_a_missing_flag_fails if {
	input_ := plan([res("aws_s3_bucket_public_access_block", "assets", {
		"bucket": "assets",
		"block_public_acls": true,
		"ignore_public_acls": true,
		"restrict_public_buckets": true,
	})])
	rule_ids(deny) == {"PG001"} with input as input_
}

test_pg001_full_access_block_passes if {
	input_ := plan([res("aws_s3_bucket_public_access_block", "assets", {
		"bucket": "assets",
		"block_public_acls": true,
		"block_public_policy": true,
		"ignore_public_acls": true,
		"restrict_public_buckets": true,
	})])
	count(deny) == 0 with input as input_
}

test_pg001_destroyed_public_bucket_passes if {
	input_ := plan([destroyed("aws_s3_bucket", "assets", {"bucket": "assets", "acl": "public-read"})])
	count(deny) == 0 with input as input_
}

test_pg001_no_resource_changes_passes if {
	count(deny) == 0 with input as {"format_version": "1.2"}
}
