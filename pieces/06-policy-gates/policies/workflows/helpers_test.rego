package workflows

# Test helpers shared by the rule tests in this package.

sha := "0123456789abcdef0123456789abcdef01234567"

wf(jobs) := {"name": "t", "on": "push", "permissions": {"contents": "read"}, "jobs": jobs}

job(steps) := {"runs-on": "ubuntu-latest", "steps": steps}

rule_ids(denials) := {id |
	some msg in denials
	id := split(msg, ":")[0]
}
