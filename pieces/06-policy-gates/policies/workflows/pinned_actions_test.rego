package workflows

test_pg004_tag_ref_fails if {
	input_ := wf({"b": job([{"uses": "actions/checkout@v4"}])})
	rule_ids(deny) == {"PG004"} with input as input_
}

test_pg004_branch_ref_fails if {
	input_ := wf({"b": job([{"uses": "actions/checkout@main"}])})
	rule_ids(deny) == {"PG004"} with input as input_
}

test_pg004_no_ref_fails if {
	input_ := wf({"b": job([{"uses": "actions/checkout"}])})
	rule_ids(deny) == {"PG004"} with input as input_
}

test_pg004_short_sha_fails if {
	input_ := wf({"b": job([{"uses": "actions/checkout@0123456"}])})
	rule_ids(deny) == {"PG004"} with input as input_
}

test_pg004_full_sha_passes if {
	input_ := wf({"b": job([{"uses": concat("", ["actions/checkout@", sha])}])})
	count(deny) == 0 with input as input_
}

test_pg004_local_action_passes if {
	input_ := wf({"b": job([{"uses": "./.github/actions/local"}])})
	count(deny) == 0 with input as input_
}

test_pg004_docker_tag_fails if {
	input_ := wf({"b": job([{"uses": "docker://alpine:3.20"}])})
	rule_ids(deny) == {"PG004"} with input as input_
}

test_pg004_docker_digest_passes if {
	digest := concat("", ["docker://alpine@sha256:", "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"])
	input_ := wf({"b": job([{"uses": digest}])})
	count(deny) == 0 with input as input_
}

test_pg004_reusable_workflow_tag_fails if {
	input_ := wf({"call": {"uses": "org/repo/.github/workflows/x.yml@v1"}})
	rule_ids(deny) == {"PG004"} with input as input_
}

test_pg004_reusable_workflow_sha_passes if {
	input_ := wf({"call": {"uses": concat("", ["org/repo/.github/workflows/x.yml@", sha])}})
	count(deny) == 0 with input as input_
}

test_pg004_message_names_the_location if {
	input_ := wf({"build": job([{"run": "echo hi"}, {"uses": "actions/checkout@v4"}])})
	denials := deny with input as input_
	some msg in denials
	contains(msg, "jobs.build.steps[1]")
}

test_pg004_non_workflow_yaml_passes if {
	count(deny) == 0 with input as {"apiVersion": "v1", "kind": "ConfigMap"}
}
