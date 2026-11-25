package terraform

# Resource changes of one type that Terraform will create or update. Destroyed resources are
# skipped: a policy violation in something being deleted is not a finding.
managed(type) := {rc |
	some rc in input.resource_changes
	rc.type == type
	rc.change.actions != ["delete"]
}
