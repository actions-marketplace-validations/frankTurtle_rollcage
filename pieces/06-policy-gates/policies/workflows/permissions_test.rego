package workflows

no_perms(jobs) := {"name": "t", "on": "push", "jobs": jobs}

test_pg005_no_permissions_anywhere_fails if {
	input_ := no_perms({"b": job([{"run": "echo hi"}])})
	rule_ids(deny) == {"PG005"} with input as input_
}

test_pg005_one_finding_per_job_without_permissions if {
	input_ := no_perms({"a": job([{"run": "x"}]), "b": job([{"run": "y"}])})
	count(deny) == 2 with input as input_
}

test_pg005_top_level_permissions_pass if {
	input_ := wf({"b": job([{"run": "echo hi"}])})
	count(deny) == 0 with input as input_
}

test_pg005_job_level_permissions_pass if {
	j := object.union(job([{"run": "echo hi"}]), {"permissions": {"contents": "read"}})
	input_ := no_perms({"b": j})
	count(deny) == 0 with input as input_
}

test_pg005_empty_permissions_object_passes if {
	j := object.union(job([{"run": "echo hi"}]), {"permissions": {}})
	input_ := no_perms({"b": j})
	count(deny) == 0 with input as input_
}

test_pg005_top_level_write_all_fails if {
	input_ := object.union(wf({"b": job([{"run": "x"}])}), {"permissions": "write-all"})
	rule_ids(deny) == {"PG005"} with input as input_
}

test_pg005_job_level_write_all_fails if {
	j := object.union(job([{"run": "x"}]), {"permissions": "write-all"})
	input_ := wf({"b": j})
	rule_ids(deny) == {"PG005"} with input as input_
}

test_pg005_read_all_passes if {
	input_ := object.union(wf({"b": job([{"run": "x"}])}), {"permissions": "read-all"})
	count(deny) == 0 with input as input_
}

test_pg005_non_workflow_yaml_passes if {
	count(deny) == 0 with input as {"kind": "ConfigMap"}
}
