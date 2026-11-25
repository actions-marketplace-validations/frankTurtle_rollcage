package workflows

test_pg006_static_aws_keys_in_step_env_fail if {
	step := {"run": "aws s3 ls", "env": {
		"AWS_ACCESS_KEY_ID": "${{ secrets.AWS_ACCESS_KEY_ID }}",
		"AWS_SECRET_ACCESS_KEY": "${{ secrets.AWS_SECRET_ACCESS_KEY }}",
	}}
	input_ := wf({"b": job([step])})
	denials := deny with input as input_
	rule_ids(denials) == {"PG006"}
	count(denials) == 2
}

test_pg006_static_keys_in_action_inputs_fail if {
	step := {"uses": "aws-actions/configure-aws-credentials@x", "with": {
		"aws-access-key-id": "${{ secrets.K }}",
		"aws-secret-access-key": "${{ secrets.S }}",
		"aws-region": "us-east-1",
	}}
	input_ := wf({"b": job([step])})
	count({m | some m in deny; startswith(m, "PG006")}) == 2 with input as input_
}

test_pg006_workflow_level_env_fails if {
	input_ := object.union(wf({"b": job([{"run": "x"}])}), {"env": {"AWS_SECRET_ACCESS_KEY": "x"}})
	rule_ids(deny) == {"PG006"} with input as input_
}

test_pg006_job_level_env_fails if {
	j := object.union(job([{"run": "x"}]), {"env": {"AZURE_CLIENT_SECRET": "x"}})
	input_ := wf({"b": j})
	rule_ids(deny) == {"PG006"} with input as input_
}

test_pg006_gcp_credentials_fail if {
	step := {"uses": concat("", ["google-github-actions/auth@", sha]), "with": {"credentials_json": "${{ secrets.GCP }}"}}
	input_ := wf({"b": job([step])})
	rule_ids(deny) == {"PG006"} with input as input_
}

test_pg006_message_names_the_location if {
	step := {"run": "x", "env": {"AWS_ACCESS_KEY_ID": "x"}}
	input_ := wf({"deploy": job([step])})
	denials := deny with input as input_
	some msg in denials
	contains(msg, "jobs.deploy.steps.0.env.AWS_ACCESS_KEY_ID")
}

test_pg006_oidc_role_passes if {
	step := {"uses": concat("", ["aws-actions/configure-aws-credentials@", sha]), "with": {
		"role-to-assume": "arn:aws:iam::123456789012:role/deploy",
		"aws-region": "us-east-1",
	}}
	input_ := object.union(wf({"b": job([step])}), {"permissions": {"id-token": "write", "contents": "read"}})
	count(deny) == 0 with input as input_
}

test_pg006_steps_without_credentials_pass if {
	input_ := wf({"b": job([{"run": "one"}, {"run": "two"}])})
	count(deny) == 0 with input as input_
}
