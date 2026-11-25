package terraform

policy_res(type, doc) := res(type, "p", {"name": "p", "policy": json.marshal(doc)})

allow(action, resource) := {"Version": "2012-10-17", "Statement": [{"Effect": "Allow", "Action": action, "Resource": resource}]}

test_pg003_star_action_fails if {
	input_ := plan([policy_res("aws_iam_policy", allow("*", "arn:aws:s3:::b/*"))])
	rule_ids(deny) == {"PG003"} with input as input_
}

test_pg003_service_star_action_fails if {
	input_ := plan([policy_res("aws_iam_role_policy", allow(["s3:GetObject", "iam:*"], "arn:aws:s3:::b/*"))])
	denials := deny with input as input_
	count(denials) == 1
	some msg in denials
	contains(msg, "iam:*")
}

test_pg003_star_resource_fails if {
	input_ := plan([policy_res("aws_iam_user_policy", allow("s3:GetObject", "*"))])
	rule_ids(deny) == {"PG003"} with input as input_
}

test_pg003_star_resource_in_list_fails if {
	input_ := plan([policy_res("aws_iam_group_policy", allow("s3:GetObject", ["arn:aws:s3:::b/*", "*"]))])
	rule_ids(deny) == {"PG003"} with input as input_
}

test_pg003_single_statement_object_is_read if {
	doc := {"Version": "2012-10-17", "Statement": {"Effect": "Allow", "Action": "*", "Resource": "*"}}
	input_ := plan([policy_res("aws_iam_policy", doc)])
	count(deny) == 2 with input as input_
}

test_pg003_scoped_policy_passes if {
	input_ := plan([policy_res("aws_iam_policy", allow(["s3:GetObject", "s3:PutObject"], "arn:aws:s3:::b/*"))])
	count(deny) == 0 with input as input_
}

test_pg003_deny_statement_with_wildcard_passes if {
	doc := {"Version": "2012-10-17", "Statement": [{"Effect": "Deny", "Action": "*", "Resource": "*"}]}
	input_ := plan([policy_res("aws_iam_policy", doc)])
	count(deny) == 0 with input as input_
}

test_pg003_invalid_policy_json_is_ignored if {
	input_ := plan([res("aws_iam_policy", "p", {"name": "p", "policy": "not json"})])
	count(deny) == 0 with input as input_
}

test_pg003_other_resource_types_are_ignored if {
	input_ := plan([res("aws_sqs_queue", "q", {"name": "q", "policy": json.marshal(allow("*", "*"))})])
	count(deny) == 0 with input as input_
}
